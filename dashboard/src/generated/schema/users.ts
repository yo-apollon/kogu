// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Discord user ID
  username: text("username").notNull(),
  avatar: text("avatar"),
  globalName: text("global_name"),
  preferredLanguage: text("preferred_language").notNull().default("pt-BR"),
  rollResets: integer("roll_resets").notNull().default(0),
  isVip: boolean("is_vip").notNull().default(false),
  vipTier: integer("vip_tier").notNull().default(0),
  dailyImportsCount: integer("daily_imports_count").notNull().default(0),
  lastImportReset: timestamp("last_import_reset", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
