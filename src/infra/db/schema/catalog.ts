import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  catalogSourceEnum,
  entityStatusEnum,
  entityTierEnum,
  entityTypeEnum,
  genderEnum,
  mediaTypeEnum,
  universeEnum,
} from "./enums.js";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const franchises = pgTable(
  "franchises",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugUq: uniqueIndex("uq_franchises_slug").on(t.slug),
  })
);

export const series = pgTable(
  "series",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    franchiseId: bigint("franchise_id", { mode: "number" }).references(() => franchises.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    titleNative: text("title_native"),
    mediaType: mediaTypeEnum("media_type").notNull().default("OTHER"),
    universe: universeEnum("universe").notNull(),
    isAdult: boolean("is_adult").notNull().default(false),
    releasedAt: date("released_at", { mode: "date" }),
    coverUrl: text("cover_url"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugUq: uniqueIndex("uq_series_slug").on(t.slug),
    franchiseIdx: index("idx_series_franchise").on(t.franchiseId),
    universeIdx: index("idx_series_universe").on(t.universe),
  })
);

export const seriesExternalIds = pgTable(
  "series_external_ids",
  {
    source: catalogSourceEnum("source").notNull(),
    externalId: text("external_id").notNull(),
    seriesId: bigint("series_id", { mode: "number" })
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.externalId], name: "series_external_ids_pk" }),
    seriesIdx: index("idx_series_external_series").on(t.seriesId),
  })
);

export const entities = pgTable(
  "entities",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // ID de texto do SQLite antigo; usado so pelo migrateFromSqlite.
    legacyId: text("legacy_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    nameNative: text("name_native"),
    // NFKD, sem acento, tokens ordenados: chave de dedupe entre fontes.
    nameNormalized: text("name_normalized").notNull(),
    universe: universeEnum("universe").notNull(),
    type: entityTypeEnum("type").notNull().default("CHARACTER"),
    gender: genderEnum("gender").notNull().default("UNKNOWN"),
    franchiseId: bigint("franchise_id", { mode: "number" }).references(() => franchises.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    status: entityStatusEnum("status").notNull().default("PENDING_REVIEW"),
    isAdult: boolean("is_adult").notNull().default(false),
    // Favoritos brutos da fonte de maior prioridade; base do scoring.
    sourceFavorites: integer("source_favorites").notNull().default(0),
    popularityScore: real("popularity_score").notNull().default(0),
    // Unico entre ativas via constraint DEFERRABLE (migration custom); NULL = sem rank.
    popularityRank: integer("popularity_rank"),
    likeRank: integer("like_rank"),
    claimRank: integer("claim_rank"),
    tier: entityTierEnum("tier").notNull().default("COMMON"),
    baseAether: integer("base_aether").notNull().default(100),
    rollWeight: real("roll_weight").notNull().default(1),
    likesCount: integer("likes_count").notNull().default(0),
    claimsCount: integer("claims_count").notNull().default(0),
    baseAtk: integer("base_atk").notNull().default(50),
    baseDef: integer("base_def").notNull().default(50),
    baseSpd: integer("base_spd").notNull().default(50),
    baseHp: integer("base_hp").notNull().default(100),
    // Semente do PRNG que distribui os stats do tier; estavel entre reranks.
    statsSeed: integer("stats_seed")
      .notNull()
      .default(sql`floor(random() * 2147483647)::int`),
    mergedIntoId: bigint("merged_into_id", { mode: "number" }).references(
      (): AnyPgColumn => entities.id,
      {
        onDelete: "set null",
      }
    ),
    lastSyncedAt: tz("last_synced_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    slugUq: uniqueIndex("uq_entities_slug").on(t.slug),
    legacyIdUq: uniqueIndex("uq_entities_legacy_id")
      .on(t.legacyId)
      .where(sql`${t.legacyId} IS NOT NULL`),
    franchiseIdx: index("idx_entities_franchise").on(t.franchiseId),
    statusIdx: index("idx_entities_status").on(t.status),
    normalizedIdx: index("idx_entities_name_normalized").on(t.nameNormalized),
    // Carga do pool de roll: so entidades ativas, agrupadas por bucket.
    activePoolIdx: index("idx_entities_active_pool")
      .on(t.universe, t.gender, t.type)
      .where(sql`${t.status} = 'ACTIVE'`),
    activeScoreIdx: index("idx_entities_active_score")
      .on(t.popularityScore.desc())
      .where(sql`${t.status} = 'ACTIVE'`),
    activeLikeRankIdx: index("idx_entities_active_like_rank")
      .on(t.likeRank)
      .where(sql`${t.status} = 'ACTIVE'`),
  })
);

export const entitySeries = pgTable(
  "entity_series",
  {
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    seriesId: bigint("series_id", { mode: "number" })
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    role: text("role"), // MAIN, SUPPORTING, BACKGROUND (texto livre da fonte)
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.entityId, t.seriesId], name: "entity_series_pk" }),
    seriesIdx: index("idx_entity_series_series").on(t.seriesId),
    primaryUq: uniqueIndex("uq_entity_series_primary")
      .on(t.entityId)
      .where(sql`${t.isPrimary}`),
  })
);

export const entityExternalIds = pgTable(
  "entity_external_ids",
  {
    source: catalogSourceEnum("source").notNull(),
    externalId: text("external_id").notNull(),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.externalId], name: "entity_external_ids_pk" }),
    entityIdx: index("idx_entity_external_entity").on(t.entityId),
  })
);

export const entityImages = pgTable(
  "entity_images",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    source: catalogSourceEnum("source").notNull().default("MANUAL"),
    status: text("status").notNull().default("ACTIVE"),
    isPrimary: boolean("is_primary").notNull().default(false),
    contentHash: text("content_hash"),
    width: integer("width"),
    height: integer("height"),
    failCount: integer("fail_count").notNull().default(0),
    lastVerifiedAt: tz("last_verified_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    entityUrlUq: uniqueIndex("uq_entity_images_entity_url").on(t.entityId, t.url),
    // No maximo uma imagem primaria por entidade.
    primaryUq: uniqueIndex("uq_entity_images_primary")
      .on(t.entityId)
      .where(sql`${t.isPrimary}`),
    verifyIdx: index("idx_entity_images_verify")
      .on(t.lastVerifiedAt)
      .where(sql`${t.isPrimary}`),
    // Imagem primaria precisa estar ativa.
  })
);

export const releaseWindows = pgTable(
  "release_windows",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    seriesId: bigint("series_id", { mode: "number" })
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    source: catalogSourceEnum("source").notNull(),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    // Boost inicial; decai linearmente ate 1 no fim da janela.
    boost: real("boost").notNull().default(2),
    closedAt: tz("closed_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    openUq: uniqueIndex("uq_release_windows_open_series")
      .on(t.seriesId)
      .where(sql`${t.closedAt} IS NULL`),
    openEndsIdx: index("idx_release_windows_open_ends")
      .on(t.endsAt)
      .where(sql`${t.closedAt} IS NULL`),
  })
);

export type Franchise = typeof franchises.$inferSelect;
export type NewFranchise = typeof franchises.$inferInsert;
export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;
export type SeriesExternalId = typeof seriesExternalIds.$inferSelect;
export type NewSeriesExternalId = typeof seriesExternalIds.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type EntitySeries = typeof entitySeries.$inferSelect;
export type NewEntitySeries = typeof entitySeries.$inferInsert;
export type EntityExternalId = typeof entityExternalIds.$inferSelect;
export type NewEntityExternalId = typeof entityExternalIds.$inferInsert;
export type EntityImage = typeof entityImages.$inferSelect;
export type NewEntityImage = typeof entityImages.$inferInsert;
export type ReleaseWindow = typeof releaseWindows.$inferSelect;
export type NewReleaseWindow = typeof releaseWindows.$inferInsert;
