import { sql } from "drizzle-orm";
import type { DbExecutor } from "../executor.js";
import { newCounters } from "../upsert.js";
import type { JobDef } from "./context.js";

const DAY_MS = 86_400_000;
const BATCH = 20_000;

function affected(res: unknown): number {
  const r = res as { count?: number; length: number };
  return typeof r.count === "number" ? r.count : r.length;
}

async function deleteInBatches(db: DbExecutor, stmt: (limit: number) => ReturnType<typeof sql>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = affected(await db.execute(stmt(BATCH)));
    total += n;
    if (n < BATCH) return total;
  }
}

export interface PruneReport {
  rollLog: number;
  syncRuns: number;
  revisions: number;
}

/**
 * roll_log > 30d; sync_runs e entity_revisions > 90d. O ultimo snapshot de favoritos por
 * (entidade, fonte) (reason='favourites') e preservado: o rerank o usa.
 */
export async function pruneOld(db: DbExecutor, now: Date): Promise<PruneReport> {
  const d30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const d90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const rollLog = await deleteInBatches(
    db,
    (n) => sql`DELETE FROM roll_log WHERE id IN (SELECT id FROM roll_log WHERE rolled_at < ${d30}::timestamptz LIMIT ${n})`
  );
  const syncRuns = await deleteInBatches(
    db,
    (n) => sql`DELETE FROM sync_runs WHERE id IN (
      SELECT id FROM sync_runs WHERE started_at < ${d90}::timestamptz AND status <> 'RUNNING' LIMIT ${n})`
  );
  const revisions = await deleteInBatches(
    db,
    (n) => sql`DELETE FROM entity_revisions WHERE id IN (
      SELECT r.id FROM entity_revisions r
      WHERE r.created_at < ${d90}::timestamptz
        AND NOT (r.reason = 'favourites' AND r.id = (
          SELECT r2.id FROM entity_revisions r2
          WHERE r2.entity_id = r.entity_id AND r2.source = r.source AND r2.reason = 'favourites'
          ORDER BY r2.created_at DESC, r2.id DESC LIMIT 1))
      LIMIT ${n})`
  );
  return { rollLog, syncRuns, revisions };
}

export const maintenancePrune: JobDef = {
  name: "maintenance.prune",
  queue: "maintenance",
  source: "MANUAL",
  schedule: { pattern: "30 4 * * *" },
  async run(ctx) {
    const r = await pruneOld(ctx.db, ctx.now());
    const total = r.rollLog + r.syncRuns + r.revisions;
    return { counters: { ...newCounters(), seen: total, updated: total }, meta: { ...r } };
  },
};
