import { and, eq, sql } from "drizzle-orm";
import { catalogSources, syncRuns } from "../../infra/db/schema/index.js";
import type { SourceCursor } from "../types.js";
import { newCounters } from "../upsert.js";
import type { JobContext, JobDef, JobHandle, JobInput, JobResult } from "./context.js";

export type JobStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface JobReport {
  job: string;
  status: JobStatus;
  runId?: number;
  seen: number;
  created: number;
  updated: number;
  quarantined: number;
  skipped: number;
  errors: number;
  durationMs: number;
  error?: string;
  reason?: string;
  meta?: Record<string, unknown>;
}

function lockKey(job: string): string {
  return `arqon:job:${job}`;
}

async function loadCursor(ctx: JobContext, def: JobDef): Promise<{ cursor: SourceCursor; enabled: boolean }> {
  const rows = await ctx.db
    .select({ cursor: catalogSources.cursor, enabled: catalogSources.enabled })
    .from(catalogSources)
    .where(and(eq(catalogSources.source, def.source), eq(catalogSources.job, def.name)))
    .limit(1);
  return { cursor: (rows[0]?.cursor as SourceCursor | undefined) ?? {}, enabled: rows[0]?.enabled ?? true };
}

async function storeCursor(
  ctx: JobContext,
  def: JobDef,
  cursor: SourceCursor | undefined,
  opts: { success?: boolean } = {}
): Promise<void> {
  const now = ctx.now();
  await ctx.db
    .insert(catalogSources)
    .values({
      source: def.source,
      job: def.name,
      ...(cursor ? { cursor } : {}),
      lastRunAt: now,
      lastSuccessAt: opts.success ? now : null,
    })
    .onConflictDoUpdate({
      target: [catalogSources.source, catalogSources.job],
      set: {
        ...(cursor ? { cursor } : {}),
        lastRunAt: now,
        ...(opts.success ? { lastSuccessAt: now } : {}),
        updatedAt: now,
      },
    });
}

/** Liga/desliga (catalog_sources.enabled) todos os jobs de uma fonte. */
export async function setJobsEnabled(
  ctx: JobContext,
  defs: readonly JobDef[],
  enabled: boolean
): Promise<void> {
  for (const d of defs) {
    await ctx.db
      .insert(catalogSources)
      .values({ source: d.source, job: d.name, enabled })
      .onConflictDoUpdate({
        target: [catalogSources.source, catalogSources.job],
        set: { enabled, updatedAt: ctx.now() },
      });
  }
}

async function execute(ctx: JobContext, def: JobDef, input: JobInput): Promise<JobReport> {
  const started = Date.now();
  const empty = newCounters();
  const base = { job: def.name, ...empty };

  if (def.sourceId && !ctx.sources[def.sourceId]) {
    return { ...base, status: "SKIPPED", reason: `fonte ${def.sourceId} indisponivel`, durationMs: 0 };
  }
  const stored = await loadCursor(ctx, def);
  if (!stored.enabled) {
    return { ...base, status: "SKIPPED", reason: "job desabilitado em catalog_sources", durationMs: 0 };
  }

  const [run] = await ctx.db
    .insert(syncRuns)
    .values({ source: def.source, job: def.name, status: "RUNNING", startedAt: ctx.now() })
    .returning({ id: syncRuns.id });

  const handle: JobHandle = {
    runId: run.id,
    cursor: stored.cursor,
    saveCursor: (cursor) => storeCursor(ctx, def, cursor),
  };

  let result: JobResult;
  let thrown: string | undefined;
  try {
    result = await def.run(ctx, input, handle);
  } catch (err) {
    thrown = err instanceof Error ? err.message : String(err);
    result = { counters: newCounters() };
    ctx.log.error({ job: def.name, err: thrown }, "job falhou");
  }

  const c = result.counters;
  const fatal = thrown ?? result.fatal;
  const worked = c.created + c.updated + Math.max(0, c.seen - c.errors - c.skipped) > 0;
  let status: JobStatus;
  if (fatal) status = worked && !thrown ? "PARTIAL" : "FAILED";
  else if (c.errors > 0) status = worked ? "PARTIAL" : "FAILED";
  else status = "SUCCESS";

  await ctx.db
    .update(syncRuns)
    .set({
      status: status as "SUCCESS" | "PARTIAL" | "FAILED",
      finishedAt: ctx.now(),
      itemsSeen: c.seen,
      itemsCreated: c.created,
      itemsUpdated: c.updated,
      itemsQuarantined: c.quarantined,
      error: fatal ?? null,
      meta: { ...(result.meta ?? {}), skipped: c.skipped, errors: c.errors, cursor: result.cursor ?? null },
    })
    .where(eq(syncRuns.id, run.id));
  await storeCursor(ctx, def, result.cursor, { success: status === "SUCCESS" || status === "PARTIAL" });

  return {
    job: def.name,
    status,
    runId: run.id,
    ...c,
    durationMs: Date.now() - started,
    ...(fatal ? { error: fatal } : {}),
    ...(result.meta ? { meta: result.meta } : {}),
  };
}

/**
 * Executa um job: advisory lock por job, linha em sync_runs (RUNNING -> SUCCESS/PARTIAL/FAILED
 * com contagens e cursor) e cursor em catalog_sources. Nunca lanca: falha vira relatorio FAILED,
 * entao a queda de uma fonte nao derruba as outras.
 *
 * O lock e `pg_try_advisory_xact_lock` numa transacao que fica aberta durante o job. O lock de
 * sessao (`pg_try_advisory_lock`) vaza num pool de conexoes se o unlock cair em outra conexao;
 * o de transacao e liberado sozinho no commit ou se o processo morrer.
 */
export async function runJob(
  ctx: JobContext,
  def: JobDef,
  input: JobInput = {}
): Promise<JobReport> {
  try {
    return await ctx.db.transaction(async (lockTx) => {
      const rows = (await lockTx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey(def.name)}, 0)) AS ok`
      )) as unknown as Array<{ ok: boolean }>;
      if (!rows[0]?.ok) {
        return {
          job: def.name,
          status: "SKIPPED" as const,
          reason: "outra instancia esta executando este job",
          ...newCounters(),
          durationMs: 0,
        };
      }
      return execute(ctx, def, input);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error({ job: def.name, err: message }, "runner falhou");
    return { job: def.name, status: "FAILED", error: message, ...newCounters(), durationMs: 0 };
  }
}
