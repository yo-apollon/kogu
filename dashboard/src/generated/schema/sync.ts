// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
import {
  bigint,
  index,
  integer,
  jsonb,
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { catalogSourceEnum, syncStatusEnum } from "./enums";
import { entities } from "./catalog";

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** Cursor de paginacao por (fonte, job) para as rotacoes diarias. */
export const catalogSources = pgTable(
  "catalog_sources",
  {
    source: catalogSourceEnum("source").notNull(),
    job: text("job").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    cursor: jsonb("cursor")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastRunAt: tz("last_run_at"),
    lastSuccessAt: tz("last_success_at"),
    updatedAt: tz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.source, t.job], name: "catalog_sources_pk" }),
  })
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    source: catalogSourceEnum("source").notNull(),
    job: text("job").notNull(),
    status: syncStatusEnum("status").notNull().default("RUNNING"),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsCreated: integer("items_created").notNull().default(0),
    itemsUpdated: integer("items_updated").notNull().default(0),
    itemsQuarantined: integer("items_quarantined").notNull().default(0),
    error: text("error"),
    meta: jsonb("meta")
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => ({
    jobIdx: index("idx_sync_runs_job").on(t.source, t.job, t.startedAt.desc()),
  })
);

/** Historico de alteracoes de uma entidade (sync, merge, moderacao). */
export const entityRevisions = pgTable(
  "entity_revisions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint("entity_id", { mode: "number" })
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    source: catalogSourceEnum("source").notNull(),
    changedBy: text("changed_by"), // ID Discord do moderador; nulo = automatico
    reason: text("reason"),
    diff: jsonb("diff")
      .notNull()
      .default(sql`'{}'::jsonb`),
    syncRunId: bigint("sync_run_id", { mode: "number" }).references(() => syncRuns.id, {
      onDelete: "set null",
    }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("idx_entity_revisions_entity").on(t.entityId, t.createdAt.desc()),
  })
);

export type CatalogSourceRow = typeof catalogSources.$inferSelect;
export type NewCatalogSourceRow = typeof catalogSources.$inferInsert;
export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
export type EntityRevision = typeof entityRevisions.$inferSelect;
export type NewEntityRevision = typeof entityRevisions.$inferInsert;
