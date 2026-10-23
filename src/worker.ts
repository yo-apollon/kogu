import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker } from "bullmq";
import { sql as rawSql } from "drizzle-orm";
import { getEnv } from "./config/env.js";
import { childLogger } from "./lib/logger.js";
import { createJobContext } from "./catalog/jobs/context.js";
import { JOBS, toScheduleSpecs } from "./catalog/jobs/index.js";
import { runJob, setJobsEnabled } from "./catalog/jobs/runner.js";
import { createSources } from "./catalog/sources/index.js";
import { closeDb, db } from "./infra/db/client.js";
import { closeQueues, createQueueWorker, getQueue, type QueueKey } from "./infra/queue/queues.js";
import { registerSchedules } from "./infra/queue/schedules.js";
import { closeKV, getKV } from "./infra/redis/client.js";

const log = childLogger("worker");
const DRAIN_MS = 10_000;
const RERANK_DEBOUNCE_MS = 10 * 60 * 1000;

async function main(): Promise<void> {
  const env = getEnv();
  if (!env.REDIS_URL) {
    if (env.NODE_ENV === "production") {
      log.fatal("REDIS_URL e obrigatoria em production");
      process.exitCode = 1;
      return;
    }
    log.warn(
      "BullMQ precisa de Redis real e REDIS_URL esta ausente: o worker nao inicia. " +
        "Em dev/teste rode os jobs com `npm run sync:once -- --source=anilist` ou `--job=rerank`."
    );
    return;
  }

  const kv = await getKV();
  const { sources, disabled } = await createSources({ kv });
  const ctx = createJobContext({
    db,
    kv,
    log,
    sources,
    requestRerank: async () => {
      await getQueue("maintenance").add(
        "catalog.rerank",
        {},
        { jobId: "catalog.rerank.on-demand", delay: RERANK_DEBOUNCE_MS, removeOnComplete: true, removeOnFail: true }
      );
    },
  });

  const active = JOBS.filter((j) => !j.sourceId || sources[j.sourceId]);
  const inactive = JOBS.filter((j) => j.sourceId && !sources[j.sourceId]);
  for (const d of disabled) log.warn({ source: d.source, reason: d.reason }, "fonte desativada");
  await setJobsEnabled(ctx, active, true);
  await setJobsEnabled(ctx, inactive, false);

  const byName = new Map(JOBS.map((j) => [j.name, j]));
  const workers: Worker[] = [];
  for (const key of new Set<QueueKey>(active.map((j) => j.queue))) {
    workers.push(
      createQueueWorker(key, async (job) => {
        const def = byName.get(job.name);
        if (!def) throw new Error(`job desconhecido: ${job.name}`);
        const limit = typeof job.data?.limit === "number" ? (job.data.limit as number) : undefined;
        const report = await runJob(ctx, def, limit ? { limit } : {});
        log.info({ ...report }, "job concluido");
        return { status: report.status, created: report.created, updated: report.updated };
      })
    );
  }
  for (const w of workers) w.on("error", (err) => log.error({ err: err.message }, "erro no worker BullMQ"));

  await registerSchedules(toScheduleSpecs(active));
  log.info({ jobs: active.map((j) => j.name) }, "worker pronto");

  let healthServer: http.Server | undefined;
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
  if (healthPort > 0) {
    healthServer = http.createServer((req, res) => {
      void (async () => {
        if (req.url === "/healthz") {
          res.writeHead(200).end("ok");
          return;
        }
        if (req.url === "/readyz") {
          try {
            await db.execute(rawSql`select 1`);
            const ok = await kv.ping();
            res.writeHead(ok ? 200 : 503).end(ok ? "ready" : "redis");
          } catch {
            res.writeHead(503).end("db");
          }
          return;
        }
        res.writeHead(404).end();
      })();
    });
    healthServer.listen(healthPort, "127.0.0.1");
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "encerrando worker");
    const force = setTimeout(() => process.exit(1), DRAIN_MS + 5_000);
    force.unref();
    healthServer?.close();
    await Promise.all(
      workers.map((w) =>
        Promise.race([w.close(), new Promise<void>((r) => setTimeout(r, DRAIN_MS))]).then(() => w.close(true))
      )
    ).catch(() => undefined);
    await closeQueues();
    await closeKV();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason instanceof Error ? reason.message : String(reason) }, "unhandledRejection");
  process.exit(1);
});

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((err: unknown) => {
    log.fatal({ err: err instanceof Error ? err.message : String(err) }, "worker falhou ao iniciar");
    process.exit(1);
  });
}
