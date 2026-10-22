import { bigint, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { moderationReasonEnum, reviewStatusEnum } from "./enums.js";
import { guilds } from "./guilds.js";
import { users } from "./users.js";
import { entities } from "./catalog.js";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const moderationQueue = pgTable(
  "moderation_queue",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // Nulo quando nao ha entidade correspondente (ex.: disabled_series legado sem match).
    entityId: bigint("entity_id", { mode: "number" }).references(() => entities.id, {
      onDelete: "cascade",
    }),
    otherEntityId: bigint("other_entity_id", { mode: "number" }).references(() => entities.id, {
      onDelete: "cascade",
    }),
    reason: moderationReasonEnum("reason").notNull(),
    status: reviewStatusEnum("status").notNull().default("PENDING"),
    details: jsonb("details")
      .notNull()
      .default(sql`'{}'::jsonb`),
    reviewedBy: text("reviewed_by"),
    reviewedAt: tz("reviewed_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pendingIdx: index("idx_moderation_pending")
      .on(t.reason, t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    entityIdx: index("idx_moderation_entity").on(t.entityId),
  })
);

export const characterSuggestions = pgTable(
  "character_suggestions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterName: text("character_name").notNull(),
    status: reviewStatusEnum("status").notNull().default("PENDING"),
    anilistId: integer("anilist_id"),
    resolvedEntityId: bigint("resolved_entity_id", { mode: "number" }).references(
      () => entities.id,
      {
        onDelete: "set null",
      }
    ),
    reviewedBy: text("reviewed_by"),
    reviewedAt: tz("reviewed_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    guildStatusIdx: index("idx_character_suggestions_guild").on(t.guildId, t.status),
  })
);

/** Usuarios (alem de OWNER_IDS) autorizados a revisar o catalogo. */
export const catalogModerators = pgTable("catalog_moderators", {
  userId: text("user_id").primaryKey(),
  addedBy: text("added_by"),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export type ModerationItem = typeof moderationQueue.$inferSelect;
export type NewModerationItem = typeof moderationQueue.$inferInsert;
export type CharacterSuggestion = typeof characterSuggestions.$inferSelect;
export type NewCharacterSuggestion = typeof characterSuggestions.$inferInsert;
export type CatalogModerator = typeof catalogModerators.$inferSelect;
export type NewCatalogModerator = typeof catalogModerators.$inferInsert;
