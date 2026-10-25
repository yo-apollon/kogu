import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getRwDb, type Db } from "./db";

export interface AuditEntry {
  guildId: string;
  /** Sempre o userId da SESSAO. */
  actorUserId: string;
  /** Ex.: "config.update", "series.disable". */
  action: string;
  before?: unknown;
  after?: unknown;
}

const ACTION_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

function validate(e: AuditEntry) {
  if (!ACTION_RE.test(e.action)) throw new Error("audit: action invalida");
  if (!e.guildId || !e.actorUserId) throw new Error("audit: guildId/actorUserId obrigatorios");
}

function json(value: unknown): SQL {
  // Nunca interpola: o valor vai como parametro e o cast `::jsonb` acontece no banco.
  return value === undefined || value === null
    ? sql`NULL::jsonb`
    : sql`${JSON.stringify(value)}::jsonb`;
}

/**
 * Fragmento `INSERT INTO dashboard_audit_log ...` (source 'dashboard') para compor numa CTE junto
 * da escrita que ele audita, no MESMO statement (atomico: sem mudanca sem auditoria e vice-versa):
 *
 *   WITH upd AS (UPDATE guilds SET ... RETURNING ...),
 *        aud AS (${auditInsertSql({...})})
 *   SELECT ...
 */
export function auditInsertSql(entry: AuditEntry): SQL {
  validate(entry);
  return sql`INSERT INTO dashboard_audit_log (guild_id, actor_user_id, source, action, before, after)
    VALUES (${entry.guildId}, ${entry.actorUserId}, 'dashboard', ${entry.action},
            ${json(entry.before)}, ${json(entry.after)})`;
}

/** Grava uma entrada isolada (uso fora de CTE). Papel `dashboard_rw`. */
export async function writeAudit(entry: AuditEntry, db: Db = getRwDb()): Promise<void> {
  await db.execute(auditInsertSql(entry));
}
