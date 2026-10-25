import "server-only";
import { sql } from "drizzle-orm";
import { getRwDb, type Db } from "./db";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: Date;
}

export interface RateLimitParams {
  key: string;
  limit: number;
  windowSec: number;
  db?: Db;
  /** Relogio de teste; em producao usa o `now()` do banco (uma unica fonte de tempo). */
  now?: Date;
}

/** Politica das escritas: 10 por minuto por usuario + guilda. */
export const WRITE_LIMIT = 10;
export const WRITE_WINDOW_SEC = 60;

export function writeRateLimitKey(userId: string, guildId: string): string {
  return `write:${userId}:${guildId}`;
}

type Row = { count: number; window_start: Date };

/**
 * Rate limit por janela fixa em UM unico statement atomico (`INSERT ... ON CONFLICT DO UPDATE`):
 * sem corrida entre instancias serverless. Se a janela venceu, reinicia em 1; senao incrementa
 * (com teto em limit+1 para o contador nao crescer sem limite sob ataque).
 * Usa o papel `dashboard_rw` (INSERT/UPDATE em dashboard_rate_limit).
 */
export async function rateLimit(params: RateLimitParams): Promise<RateLimitResult> {
  const { key, limit, windowSec } = params;
  if (!key || key.length > 200) throw new Error("rateLimit: chave invalida");
  if (!Number.isInteger(limit) || limit < 1) throw new Error("rateLimit: limit invalido");
  if (!Number.isInteger(windowSec) || windowSec < 1) throw new Error("rateLimit: windowSec invalido");

  const db = params.db ?? getRwDb();
  const nowExpr = params.now ? sql`${params.now.toISOString()}::timestamptz` : sql`now()`;
  const expired = sql`dashboard_rate_limit.window_start <= ${nowExpr} - make_interval(secs => ${windowSec})`;

  const rows = await db.execute<Row>(sql`
    INSERT INTO dashboard_rate_limit (key, window_start, count)
    VALUES (${key}, ${nowExpr}, 1)
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE WHEN ${expired} THEN ${nowExpr} ELSE dashboard_rate_limit.window_start END,
      count = CASE WHEN ${expired} THEN 1
                   ELSE LEAST(dashboard_rate_limit.count + 1, ${limit + 1}) END
    RETURNING count, window_start
  `);
  const row = rows[0];
  if (!row) throw new Error("rateLimit: sem retorno do banco");
  const windowStart = new Date(row.window_start);
  return {
    ok: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: new Date(windowStart.getTime() + windowSec * 1000),
  };
}

/** Atalho para escritas da dashboard (10/min por usuario+guilda). */
export function rateLimitWrite(userId: string, guildId: string, db?: Db): Promise<RateLimitResult> {
  return rateLimit({
    key: writeRateLimitKey(userId, guildId),
    limit: WRITE_LIMIT,
    windowSec: WRITE_WINDOW_SEC,
    db,
  });
}
