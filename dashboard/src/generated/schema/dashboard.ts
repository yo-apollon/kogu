// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { guilds } from "./guilds";

/** Auditoria das alteracoes de configuracao (dashboard e bot; CHECK de `source` na migration 0003). Retencao de 180 dias via maintenance.prune. */
export const dashboardAuditLog = pgTable(
  "dashboard_audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    source: text("source").notNull().default("dashboard"),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    guildCreatedIdx: index("idx_dashboard_audit_guild_created").on(t.guildId, t.createdAt.desc()),
  })
);

/** Rate limit das escritas da dashboard (janela fixa por chave). Poda: window_start > 1 dia. */
export const dashboardRateLimit = pgTable("dashboard_rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});

export type DashboardAuditEntry = typeof dashboardAuditLog.$inferSelect;
export type NewDashboardAuditEntry = typeof dashboardAuditLog.$inferInsert;
