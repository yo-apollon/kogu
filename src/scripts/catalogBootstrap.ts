import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { JobContext, JobDef, JobResult } from "../catalog/jobs/context.js";
import { createJobContext } from "../catalog/jobs/context.js";
import { ingest } from "../catalog/jobs/ingest.js";
import { runJob, type JobReport } from "../catalog/jobs/runner.js";
import { catalogRerank } from "../catalog/jobs/rerank.js";
import { formatReport } from "./syncOnce.js";
import type { SourceCursor, SourceId } from "../catalog/types.js";
import { addCounters, newCounters } from "../catalog/upsert.js";

/** Cotas da carga inicial (entidades por fonte/universo). */
export const BOOTSTRAP_QUOTAS = { ANILIST: 5000, IGDB: 1500, TMDB: 500 } as const;
const BATCH_SERIES = 20;

interface Stage {
  name: string;
  sourceId: SourceId;
  quota: number;
  /** Limite de series para nao rodar sem fim se a cota nunca fechar (ex.: personagens sem imagem). */
  maxSeries: number;
  discover: Record<string, unknown>;
  /** Estados que contam para a cota. */
  countStatuses: readonly string[];
  /** Cursor da proxima passada a partir do avancado e do cursor do adapter. */
  next(totalSeen: number, adapter: SourceCursor | undefined): SourceCursor;
  charactersFor?: (s: { isAnimation?: boolean }) => number;
}

const STAGES: Stage[] = [
  {
    name: "bootstrap.anilist",
    sourceId: "ANILIST",
    quota: BOOTSTRAP_QUOTAS.ANILIST,
    maxSeries: 1500,
    discover: { mode: "popular", perPage: 50, maxPages: 400 },
    countStatuses: ["ACTIVE"],
    next: (seen, a) => ({ ...(a ?? {}), seen }),
  },
  {
    name: "bootstrap.igdb",
    sourceId: "IGDB",
    quota: BOOTSTRAP_QUOTAS.IGDB,
    maxSeries: 600,
    discover: { mode: "popular" },
    countStatuses: ["ACTIVE"],
    next: (seen) => ({ offset: seen, seen }),
  },
  {
    name: "bootstrap.tmdb",
    sourceId: "TMDB",
    quota: BOOTSTRAP_QUOTAS.TMDB,
    maxSeries: 400,
    discover: { mode: "trending" },
    countStatuses: ["ACTIVE", "QUARANTINED", "PENDING_REVIEW"],
    next: (seen) => ({ page: Math.floor(seen / 40) + 1, seen }),
    charactersFor: (s) => (s.isAnimation ? 25 : 0),
  },
];

async function countEntities(ctx: JobContext, source: SourceId, statuses: readonly string[]): Promise<number> {
  const list = sql.join(statuses.map((s) => sql`${s}`), sql`, `);
  const rows = (await ctx.db.execute(sql`
    SELECT count(DISTINCT e.id)::int AS n
    FROM entities e JOIN entity_external_ids x ON x.entity_id = e.id
    WHERE x.source = ${source} AND e.status::text IN (${list})`)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Estagio retomavel: o cursor (`seen` + posicao do adapter) e salvo a cada lote. */
function stageJob(stage: Stage): JobDef {
  return {
    name: stage.name,
    queue: "maintenance",
    source: stage.sourceId,
    sourceId: stage.sourceId,
    schedule: {},
    async run(ctx, input, handle): Promise<JobResult> {
      const counters = newCounters();
      let totalSeen = Number(handle.cursor.seen ?? 0) || 0;
      let cursor: SourceCursor = handle.cursor;
      const maxSeries = input.limit ?? stage.maxSeries;
      let count = await countEntities(ctx, stage.sourceId, stage.countStatuses);
      let fatal: string | undefined;
      let exhausted = false;

      while (count < stage.quota && totalSeen < maxSeries && !fatal) {
        let adapter: SourceCursor | undefined;
        const r = await ingest(ctx, {
          source: ctx.sources[stage.sourceId]!,
          discover: { ...stage.discover, onCursor: (c: SourceCursor) => (adapter = c) },
          cursor,
          maxSeries: Math.min(BATCH_SERIES, maxSeries - totalSeen),
          charactersPerSeries: 25,
          ...(stage.charactersFor ? { charactersFor: stage.charactersFor } : {}),
          syncRunId: handle.runId,
        });
        addCounters(counters, r.counters);
        totalSeen += r.seriesSeen;
        cursor = stage.next(totalSeen, adapter);
        await handle.saveCursor(cursor);
        if (r.fatal) fatal = r.fatal;
        if (r.seriesSeen === 0 || (adapter as SourceCursor | undefined)?.done === true) exhausted = true;
        if (exhausted) break;
        count = await countEntities(ctx, stage.sourceId, stage.countStatuses);
      }
      return {
        counters,
        cursor: exhausted ? {} : cursor,
        ...(fatal ? { fatal } : {}),
        meta: { quota: stage.quota, count, series: totalSeen, exhausted },
      };
    },
  };
}

export interface BootstrapOptions {
  only?: readonly string[];
  limit?: number;
}

/** Carga inicial: AniList, IGDB e TMDB animacao ate as cotas, depois rerank. */
export async function runBootstrap(ctx: JobContext, opts: BootstrapOptions = {}): Promise<JobReport[]> {
  const reports: JobReport[] = [];
  for (const stage of STAGES) {
    if (opts.only && !opts.only.includes(stage.sourceId.toLowerCase())) continue;
    reports.push(await runJob(ctx, stageJob(stage), opts.limit ? { limit: opts.limit } : {}));
  }
  reports.push(await runJob(ctx, catalogRerank));
  return reports;
}

async function main(): Promise<void> {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase().split(",");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const { db, closeDb } = await import("../infra/db/client.js");
  const { closeKV, getKV } = await import("../infra/redis/client.js");
  const { createSources } = await import("../catalog/sources/index.js");
  const { childLogger } = await import("../lib/logger.js");
  const kv = await getKV();
  try {
    const { sources } = await createSources({ kv });
    const ctx = createJobContext({ db, kv, sources, log: childLogger("bootstrap") });
    const reports = await runBootstrap(ctx, {
      ...(only ? { only } : {}),
      ...(limitArg ? { limit: Number(limitArg.slice(8)) } : {}),
    });
    for (const r of reports) console.log(`${formatReport(r)}\n`);
    if (reports.some((r) => r.status === "FAILED")) process.exitCode = 1;
  } finally {
    await closeKV();
    await closeDb();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
