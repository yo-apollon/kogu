// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { bigint, index, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { entities } from "./catalog";

/** Historico de mudancas de prestigio (importacao curada, override manual). `source` tem CHECK na migration 0005. */
export const prestigeAudit = pgTable(
  "prestige_audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    previous: real("previous"),
    next: real("next").notNull(),
    source: text("source").notNull(),
    reason: text("reason"),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    entityCreatedIdx: index("idx_prestige_audit_entity").on(t.entityId, t.createdAt.desc()),
  })
);

export type PrestigeAuditEntry = typeof prestigeAudit.$inferSelect;
export type NewPrestigeAuditEntry = typeof prestigeAudit.$inferInsert;
