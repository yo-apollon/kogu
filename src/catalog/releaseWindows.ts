import { and, eq, isNull, lte } from "drizzle-orm";
import { RELEASE_BOOST_DEFAULT, RELEASE_BOOST_MAX, RELEASE_BOOST_MIN } from "../config/gacha.js";
import { releaseWindows } from "../infra/db/schema/index.js";
import type { DbExecutor } from "./executor.js";

export const RELEASE_WINDOW_DAYS = 30;
/** Jogos ainda nao lancados entram na janela se saem em ate N dias (igdb.releases: +7d). */
export const RELEASE_LOOKAHEAD_DAYS = 7;
const DAY_MS = 86_400_000;

export interface BoostWindow {
  startsAt: Date;
  endsAt: Date;
  boost: number;
  closedAt?: Date | null;
}

/**
 * Boost atual (puro): `boost` no inicio da janela, decai linearmente ate 1 em `endsAt`.
 * Antes do inicio vale o boost cheio; depois do fim ou com a janela fechada vale 1.
 */
export function currentBoost(w: BoostWindow, now: Date): number {
  if (w.closedAt) return 1;
  const t = now.getTime();
  const s = w.startsAt.getTime();
  const e = w.endsAt.getTime();
  if (t >= e) return 1;
  if (t <= s) return w.boost;
  return 1 + (w.boost - 1) * ((e - t) / (e - s));
}

/** Serie lancada/estreando nos ultimos 30 dias (ou nos proximos `lookaheadDays`)? */
export function shouldOpenWindow(
  s: { startDate?: Date | null; status?: string },
  now: Date,
  lookaheadDays = RELEASE_LOOKAHEAD_DAYS
): boolean {
  if (!s.startDate) return false;
  const t = s.startDate.getTime();
  return (
    t >= now.getTime() - RELEASE_WINDOW_DAYS * DAY_MS && t <= now.getTime() + lookaheadDays * DAY_MS
  );
}

/** Abre a janela da serie (uma so por serie, mesmo depois de fechada). Retorna true se abriu. */
export async function openReleaseWindow(
  db: DbExecutor,
  p: { seriesId: number; source: string; startDate: Date; boost?: number }
): Promise<boolean> {
  const existing = await db
    .select({ id: releaseWindows.id })
    .from(releaseWindows)
    .where(eq(releaseWindows.seriesId, p.seriesId))
    .limit(1);
  if (existing.length > 0) return false;
  const boost = Math.min(
    RELEASE_BOOST_MAX,
    Math.max(RELEASE_BOOST_MIN, p.boost ?? RELEASE_BOOST_DEFAULT)
  );
  const rows = await db
    .insert(releaseWindows)
    .values({
      seriesId: p.seriesId,
      source: p.source as never,
      startsAt: p.startDate,
      endsAt: new Date(p.startDate.getTime() + RELEASE_WINDOW_DAYS * DAY_MS),
      boost,
    })
    .onConflictDoNothing()
    .returning({ id: releaseWindows.id });
  return rows.length > 0;
}

/** Fecha as janelas vencidas (closed_at = now). Retorna quantas fechou. */
export async function expireReleaseWindows(db: DbExecutor, now: Date): Promise<number> {
  const rows = await db
    .update(releaseWindows)
    .set({ closedAt: now })
    .where(and(isNull(releaseWindows.closedAt), lte(releaseWindows.endsAt, now)))
    .returning({ id: releaseWindows.id });
  return rows.length;
}
