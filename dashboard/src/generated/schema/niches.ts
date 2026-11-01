// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { bigint, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Nichos de prestigio (docs/raridade-por-nicho.md). `family` (CHECK na migration 0005):
 * fiction | people_sport | people_music | people_creator. `profile` guarda, opcionalmente,
 * limiares e pesos proprios do nicho; sem perfil valem os padroes de `src/config/gacha.ts`.
 */
export const niches = pgTable(
  "niches",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    key: text("key").notNull(),
    labelPt: text("label_pt").notNull(),
    labelEn: text("label_en").notNull(),
    family: text("family").notNull(),
    profile: jsonb("profile"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUq: uniqueIndex("uq_niches_key").on(t.key),
  })
);

export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;
