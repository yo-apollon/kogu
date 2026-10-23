import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_JOB_BY_SOURCE, findJob } from "../catalog/jobs/index.js";
import { createJobContext, type JobContext } from "../catalog/jobs/context.js";
import { runJob, type JobReport } from "../catalog/jobs/runner.js";

export interface SyncOnceArgs {
  source?: string;
  job?: string;
  limit?: number;
}

export function parseArgs(argv: readonly string[]): SyncOnceArgs {
  const out: SyncOnceArgs = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) continue;
    if (m[1] === "source") out.source = m[2].toLowerCase();
    else if (m[1] === "job") out.job = m[2];
    else if (m[1] === "limit") {
      const n = Number(m[2]);
      if (Number.isInteger(n) && n > 0) out.limit = n;
    }
  }
  return out;
}

export function formatReport(r: JobReport): string {
  const lines = [
    `job: ${r.job}`,
    `status: ${r.status}${r.reason ? ` (${r.reason})` : ""}`,
    `seen: ${r.seen}  created: ${r.created}  updated: ${r.updated}  quarantined: ${r.quarantined}  skipped: ${r.skipped}  errors: ${r.errors}`,
    `duration: ${(r.durationMs / 1000).toFixed(1)}s${r.runId ? `  sync_run: ${r.runId}` : ""}`,
  ];
  if (r.error) lines.push(`error: ${r.error}`);
  if (r.meta) lines.push(`meta: ${JSON.stringify(r.meta)}`);
  return lines.join("\n");
}

/** Executa um job direto, sem fila. Retorna o relatorio (exit code != 0 se FAILED). */
export async function runSyncOnce(args: SyncOnceArgs, ctx: JobContext): Promise<JobReport> {
  const name = args.job ?? (args.source ? DEFAULT_JOB_BY_SOURCE[args.source] : undefined);
  if (!name) throw new Error("uso: sync:once -- --source=anilist|jikan|igdb|tmdb [--limit=N] | --job=<nome>");
  const def = findJob(name);
  if (!def) throw new Error(`job desconhecido: ${name}`);
  return runJob(ctx, def, args.limit ? { limit: args.limit } : {});
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { db, closeDb } = await import("../infra/db/client.js");
  const { closeKV, getKV } = await import("../infra/redis/client.js");
  const { createSources } = await import("../catalog/sources/index.js");
  const { childLogger } = await import("../lib/logger.js");
  const kv = await getKV();
  try {
    const { sources } = await createSources({ kv });
    const ctx = createJobContext({ db, kv, sources, log: childLogger("sync-once") });
    const report = await runSyncOnce(args, ctx);
    console.log(formatReport(report));
    if (report.status === "FAILED") process.exitCode = 1;
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
