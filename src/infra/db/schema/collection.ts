import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { cardVariantEnum } from "./enums.js";
import { guilds } from "./guilds.js";
import { users } from "./users.js";
import { guildMembers } from "./members.js";
import { entities, franchises, series } from "./catalog.js";

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Pactos firmados. Absorve custom_aliases do legado (alias, alias2, note). */
export const pacts = pgTable(
  "pacts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    // restrict: entidade com pacto nunca e apagada; vira MERGED/DISABLED.
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    variant: cardVariantEnum("variant").notNull().default("STANDARD"),
    awakeningKeys: integer("awakening_keys").notNull().default(0),
    isSoulmate: boolean("is_soulmate").notNull().default(false),
    customImage: text("custom_image"),
    alias: text("alias"),
    alias2: text("alias2"),
    note: text("note"),
    embedColor: text("embed_color"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Eter no momento do pacto; o rerank nunca reduz abaixo disso (max(atual, aether_at_bind)).
    aetherAtBind: integer("aether_at_bind").notNull().default(0),
    boundAt: tz("bound_at").notNull().defaultNow(),
  },
  (t) => ({
    memberFk: foreignKey({
      name: "pacts_member_fk",
      columns: [t.guildId, t.userId],
      foreignColumns: [guildMembers.guildId, guildMembers.userId],
    }).onDelete("cascade"),
    // Fonte da verdade contra pacto duplo: uma entidade por servidor.
    guildEntityUq: uniqueIndex("uq_pacts_guild_entity").on(t.guildId, t.entityId),
    guildUserIdx: index("idx_pacts_guild_user").on(t.guildId, t.userId, t.sortOrder),
    entityIdx: index("idx_pacts_entity").on(t.entityId),
  })
);

export const wishes = pgTable(
  "wishes",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    isStarwish: boolean("is_starwish").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.guildId, t.userId, t.entityId], name: "wishes_pk" }),
    memberFk: foreignKey({
      name: "wishes_member_fk",
      columns: [t.guildId, t.userId],
      foreignColumns: [guildMembers.guildId, guildMembers.userId],
    }).onDelete("cascade"),
    // Quem deseja esta entidade neste servidor (mencao ao sortear).
    guildEntityIdx: index("idx_wishes_guild_entity").on(t.guildId, t.entityId),
  })
);

/** Series/franquias desativadas por usuario ou pelo servidor inteiro. */
export const disabledSeries = pgTable(
  "disabled_series",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isServerWide: boolean("is_server_wide").notNull().default(false),
    seriesId: bigint("series_id", { mode: "number" }).references(() => series.id, {
      onDelete: "cascade",
    }),
    franchiseId: bigint("franchise_id", { mode: "number" }).references(() => franchises.id, {
      onDelete: "cascade",
    }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // Exatamente um alvo: serie OU franquia.
    seriesUq: uniqueIndex("uq_disabled_series_series")
      .on(t.guildId, t.userId, t.isServerWide, t.seriesId)
      .where(sql`${t.seriesId} IS NOT NULL`),
    franchiseUq: uniqueIndex("uq_disabled_series_franchise")
      .on(t.guildId, t.userId, t.isServerWide, t.franchiseId)
      .where(sql`${t.franchiseId} IS NOT NULL`),
    guildIdx: index("idx_disabled_series_guild").on(t.guildId),
    seriesIdx: index("idx_disabled_series_series").on(t.seriesId),
    franchiseIdx: index("idx_disabled_series_franchise").on(t.franchiseId),
  })
);

/** Like global (por usuario) em uma entidade. */
export const entityLikes = pgTable(
  "entity_likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.entityId], name: "entity_likes_pk" }),
    entityIdx: index("idx_entity_likes_entity").on(t.entityId),
  })
);

export type Pact = typeof pacts.$inferSelect;
export type NewPact = typeof pacts.$inferInsert;
export type Wish = typeof wishes.$inferSelect;
export type NewWish = typeof wishes.$inferInsert;
export type DisabledSeries = typeof disabledSeries.$inferSelect;
export type NewDisabledSeries = typeof disabledSeries.$inferInsert;
export type EntityLike = typeof entityLikes.$inferSelect;
export type NewEntityLike = typeof entityLikes.$inferInsert;
