import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * 1. TABELA DE SERVIDORES (GUILDS)
 */
export const guilds = sqliteTable("guilds", {
  id: text("id").primaryKey(), // Discord Guild ID
  prefix: text("prefix").default("$").notNull(),
  language: text("language").default("pt-BR").notNull(),
  gamemode: integer("gamemode").default(1).notNull(),
  baseRolls: integer("base_rolls").default(10).notNull(),
  claimCooldownMinutes: integer("claim_cooldown_minutes").default(180).notNull(),
  claimWindowSeconds: integer("claim_window_seconds").default(45).notNull(),
  snipeProtectionLevel: integer("snipe_protection_level").default(0).notNull(),
  snipeProtectionSeconds: integer("snipe_protection_seconds").default(8).notNull(),
  aetherSnipeProtectionLevel: integer("aether_snipe_protection_level").default(0).notNull(),
  aetherSnipeProtectionSeconds: integer("aether_snipe_protection_seconds").default(8).notNull(),
  pactLimit: integer("pact_limit").default(8100).notNull(),
  serverAetherScrap: integer("server_aether_scrap").default(0).notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 2. TABELA DE USUÁRIOS
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Discord User ID
  username: text("username").notNull(),
  preferredLanguage: text("preferred_language").default("pt-BR").notNull(),
  rollResets: integer("roll_resets").default(0).notNull(),
  isVip: integer("is_vip", { mode: "boolean" }).default(false).notNull(),
  vipTier: integer("vip_tier").default(0).notNull(),
  dailyImportsCount: integer("daily_imports_count").default(0).notNull(),
  lastImportReset: text("last_import_reset").default("CURRENT_TIMESTAMP").notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 3. PERFIL DO JOGADOR NO SERVIDOR
 */
export const guildProfiles = sqliteTable("guild_profiles", {
  id: text("id").primaryKey(), // composite: guildId:userId
  userId: text("user_id").notNull(),
  guildId: text("guild_id").notNull(),
  aetherBalance: integer("aether_balance").default(0).notNull(),
  astralShards: integer("astral_shards").default(0).notNull(),
  rollsRemaining: integer("rolls_remaining").default(10).notNull(),
  stackedRolls: integer("stacked_rolls").default(0).notNull(),
  pactsAvailable: integer("pacts_available").default(1).notNull(),
  embedColor: text("embed_color").default("#5865F2"),
  relicBronze: integer("relic_bronze").default(0).notNull(),
  relicSilver: integer("relic_silver").default(0).notNull(),
  relicGold: integer("relic_gold").default(0).notNull(),
  relicSapphire: integer("relic_sapphire").default(0).notNull(),
  relicRuby: integer("relic_ruby").default(0).notNull(),
  relicEmerald: integer("relic_emerald").default(0).notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 4. ENTIDADES DIMENSIONAIS
 */
export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    originalName: text("original_name"),
    universe: text("universe").notNull(),
    type: text("type").default("CHARACTER").notNull(),
    gender: text("gender").default("FEMALE").notNull(),
    franchise: text("franchise").notNull(),
    description: text("description"),
    imagesJson: text("images_json").default("[]").notNull(),
    baseAether: integer("base_aether").default(100).notNull(),
    popularityRank: integer("popularity_rank").default(99999).notNull(),
    likesCount: integer("likes_count").default(0).notNull(),
    claimsCount: integer("claims_count").default(0).notNull(),
    baseAtk: integer("base_atk").default(50).notNull(),
    baseDef: integer("base_def").default(50).notNull(),
    baseSpd: integer("base_spd").default(50).notNull(),
    baseHp: integer("base_hp").default(100).notNull(),
    createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
  },
  (table) => ({
    franchiseIdx: index("idx_entities_franchise").on(table.franchise),
    universeIdx: index("idx_entities_universe").on(table.universe),
    genderIdx: index("idx_entities_gender").on(table.gender),
  })
);

/**
 * 5. PACTOS FIRMADOS (PANTEÃO)
 */
export const pacts = sqliteTable(
  "pacts",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    entityId: text("entity_id").notNull(),
    variant: text("variant").default("STANDARD").notNull(),
    awakeningKeys: integer("awakening_keys").default(0).notNull(),
    isSoulmate: integer("is_soulmate", { mode: "boolean" }).default(false).notNull(),
    customImage: text("custom_image"),
    alias2: text("alias2"),
    note: text("note"),
    embedColor: text("embed_color"),
    sortOrder: integer("sort_order").default(0).notNull(),
    boundAt: text("bound_at").default("CURRENT_TIMESTAMP").notNull(),
  },
  (table) => ({
    guildUserIdx: index("idx_pacts_guild_user").on(table.guildId, table.userId),
    entityGuildUnique: uniqueIndex("idx_pacts_entity_guild").on(table.guildId, table.entityId),
  })
);

/**
 * 6. LISTA DE DESEJOS ($wish / $wl)
 */
export const wishes = sqliteTable("wishes", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  entityId: text("entity_id").notNull(),
  isStarwish: integer("is_starwish", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 7. LISTA DE DESATIVAÇÃO ($disable / $antidisable)
 */
export const disabledSeries = sqliteTable("disabled_series", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  seriesName: text("series_name").notNull(),
  isServerWide: integer("is_server_wide", { mode: "boolean" }).default(false).notNull(),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 8. NOTAS E APELIDOS ($note, $alias, $alias2)
 */
export const customAliases = sqliteTable("custom_aliases", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  entityId: text("entity_id").notNull(),
  alias1: text("alias1"),
  alias2: text("alias2"),
  customNote: text("custom_note"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

/**
 * 9. FILA DE SUGESTÕES DE PERSONAGENS ($suggest / $approvesuggest)
 */
export const characterSuggestions = sqliteTable("character_suggestions", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  characterName: text("character_name").notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING, APPROVED, REJECTED
  anilistId: integer("anilist_id"),
  createdAt: text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});


