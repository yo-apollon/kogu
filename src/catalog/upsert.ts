import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  entities,
  entityExternalIds,
  entityImages,
  entityRevisions,
  entitySeries,
  franchises,
  series,
  seriesExternalIds,
} from "../infra/db/schema/index.js";
import type { Entity } from "../infra/db/schema/index.js";
import { findCrossSourceMatch, findEntityByExternalId, findSimilarInFranchise } from "./dedupe.js";
import type { DbExecutor } from "./executor.js";
import {
  deriveFranchiseName,
  normalizeImageUrl,
  primarySourceOf,
  slugCandidates,
  sourcePriority,
  toEntityFields,
  toSeriesFields,
  type Universe,
} from "./normalize.js";
import {
  DEFAULT_FAVORITES_FLOOR,
  evaluateEntity,
  loadWaivers,
  reconcileModeration,
  type EntityStatus,
} from "./quarantine.js";
import type { RawCharacter, RawSeries } from "./types.js";

export interface UpsertContext {
  db: DbExecutor;
  now: Date;
  syncRunId?: number | null;
  /** Catalogo aceita adulto (padrao false: ADULT_CONTENT vai para quarentena). */
  allowAdult?: boolean;
  favoritesFloor?: Readonly<Record<string, number>>;
}

export interface Counters {
  seen: number;
  created: number;
  updated: number;
  quarantined: number;
  skipped: number;
  errors: number;
}

export const newCounters = (): Counters => ({
  seen: 0,
  created: 0,
  updated: 0,
  quarantined: 0,
  skipped: 0,
  errors: 0,
});

export function addCounters(a: Counters, b: Partial<Counters>): Counters {
  for (const k of Object.keys(a) as (keyof Counters)[]) a[k] += b[k] ?? 0;
  return a;
}

type Tx = DbExecutor;
type Json = Record<string, unknown>;

const SYNC_TOUCH_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Slugs e franquias                                                  */
/* ------------------------------------------------------------------ */

async function freeSlug(
  tx: Tx,
  table: "series" | "entities" | "franchises",
  candidates: string[]
): Promise<string> {
  const col = table === "series" ? series.slug : table === "entities" ? entities.slug : franchises.slug;
  const t = table === "series" ? series : table === "entities" ? entities : franchises;
  const taken = await tx.select({ slug: col }).from(t).where(inArray(col, candidates));
  const used = new Set(taken.map((r) => r.slug));
  const free = candidates.find((c) => !used.has(c));
  if (free) return free;
  // Todos ocupados (praticamente impossivel): sufixo aleatorio curto.
  return `${candidates[candidates.length - 1]}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Franquia por slug do nome derivado; cria se nao existir. */
export async function ensureFranchise(tx: Tx, name: string): Promise<number> {
  const slug = slugCandidates(name, "franchise", name)[0];
  const rows = await tx
    .insert(franchises)
    .values({ slug, name })
    .onConflictDoUpdate({ target: franchises.slug, set: { slug } })
    .returning({ id: franchises.id });
  return rows[0].id;
}

/* ------------------------------------------------------------------ */
/* Series                                                             */
/* ------------------------------------------------------------------ */

export interface SeriesRef {
  seriesId: number;
  franchiseId: number | null;
  universe: Universe;
  isAdult: boolean;
}

export interface SeriesUpsertResult extends SeriesRef {
  created: boolean;
  updated: boolean;
}

async function findSeriesId(tx: Tx, source: string, externalId: string): Promise<number | null> {
  const rows = await tx
    .select({ id: seriesExternalIds.seriesId })
    .from(seriesExternalIds)
    .where(
      and(eq(seriesExternalIds.source, source as never), eq(seriesExternalIds.externalId, externalId))
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Referencia da serie ja cadastrada (jobs de enriquecimento nao criam series). */
export async function resolveSeriesRef(
  db: DbExecutor,
  source: string,
  externalId: string
): Promise<SeriesRef | null> {
  const id = await findSeriesId(db, source, externalId);
  if (id === null) return null;
  const rows = await db.select().from(series).where(eq(series.id, id)).limit(1);
  const s = rows[0];
  if (!s) return null;
  return { seriesId: s.id, franchiseId: s.franchiseId, universe: s.universe, isAdult: s.isAdult };
}

export async function upsertSeries(
  ctx: UpsertContext,
  raw: RawSeries,
  opts: { createIfMissing?: boolean } = {}
): Promise<SeriesUpsertResult | null> {
  const f = toSeriesFields(raw);
  if (f.title === "") return null;

  return ctx.db.transaction(async (tx) => {
    let seriesId = await findSeriesId(tx, raw.source, raw.externalId);
    if (seriesId === null && raw.crossIds) {
      for (const [src, id] of Object.entries(raw.crossIds)) {
        if (!id) continue;
        seriesId = await findSeriesId(tx, src, String(id));
        if (seriesId !== null) break;
      }
    }

    let created = false;
    let updated = false;
    let row: typeof series.$inferSelect;

    if (seriesId === null) {
      if (opts.createIfMissing === false) return null;
      const franchiseId = await ensureFranchise(tx, deriveFranchiseName(f.title, raw.mediaType));
      const slug = await freeSlug(
        tx,
        "series",
        slugCandidates(f.title, raw.source, raw.externalId)
      );
      [row] = await tx
        .insert(series)
        .values({
          franchiseId,
          slug,
          title: f.title,
          titleNative: f.titleNative,
          mediaType: f.mediaType,
          universe: f.universe,
          isAdult: f.isAdult,
          releasedAt: f.releasedAt,
          coverUrl: f.coverUrl,
        })
        .returning();
      created = true;
    } else {
      [row] = await tx.select().from(series).where(eq(series.id, seriesId));
      const known = await tx
        .select({ source: seriesExternalIds.source })
        .from(seriesExternalIds)
        .where(eq(seriesExternalIds.seriesId, seriesId));
      const best = Math.min(...known.map((k) => sourcePriority(k.source)), 99);
      const fillOnly = sourcePriority(raw.source) > best;

      const patch: Json = {};
      if (!fillOnly) {
        if (row.title !== f.title) patch.title = f.title;
        if (f.titleNative !== null && row.titleNative !== f.titleNative) patch.titleNative = f.titleNative;
        if (row.mediaType !== f.mediaType) patch.mediaType = f.mediaType;
        if (f.isAdult && !row.isAdult) patch.isAdult = true;
        if (
          f.releasedAt &&
          (!row.releasedAt || row.releasedAt.getTime() !== f.releasedAt.getTime())
        ) {
          patch.releasedAt = f.releasedAt;
        }
        if (f.coverUrl && row.coverUrl !== f.coverUrl) patch.coverUrl = f.coverUrl;
      } else {
        if (row.titleNative === null && f.titleNative) patch.titleNative = f.titleNative;
        if (row.releasedAt === null && f.releasedAt) patch.releasedAt = f.releasedAt;
        if (row.coverUrl === null && f.coverUrl) patch.coverUrl = f.coverUrl;
      }
      if (row.franchiseId === null) {
        patch.franchiseId = await ensureFranchise(tx, deriveFranchiseName(f.title, raw.mediaType));
      }
      if (Object.keys(patch).length > 0) {
        [row] = await tx
          .update(series)
          .set({ ...patch, updatedAt: ctx.now } as never)
          .where(eq(series.id, row.id))
          .returning();
        updated = true;
      }
    }

    const links = [{ source: raw.source, externalId: raw.externalId }];
    for (const [src, id] of Object.entries(raw.crossIds ?? {})) {
      if (id) links.push({ source: src as typeof raw.source, externalId: String(id) });
    }
    await tx
      .insert(seriesExternalIds)
      .values(links.map((l) => ({ source: l.source, externalId: l.externalId, seriesId: row.id })))
      .onConflictDoNothing();

    return {
      seriesId: row.id,
      franchiseId: row.franchiseId,
      universe: row.universe,
      isAdult: row.isAdult,
      created,
      updated,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Imagens                                                            */
/* ------------------------------------------------------------------ */

/**
 * Garante a imagem do personagem. Sem primaria ativa, a nova vira primaria; se a mesma fonte
 * trocou a URL, a antiga sai (REMOVED) e a nova assume; imagens de outras fontes entram como
 * alternativas. URL ja conhecida (inclusive BROKEN/REMOVED) nunca e reativada pela fonte.
 */
async function ensureImage(
  tx: Tx,
  entityId: number,
  rawUrl: string | undefined,
  source: string
): Promise<boolean> {
  const url = normalizeImageUrl(rawUrl);
  if (!url) return false;
  const existing = await tx.select().from(entityImages).where(eq(entityImages.entityId, entityId));
  if (existing.some((i) => i.url === url)) return false;

  const primary = existing.find((i) => i.isPrimary);
  let makePrimary = false;
  if (!primary) makePrimary = true;
  else if (primary.source === source) {
    await tx
      .update(entityImages)
      .set({ isPrimary: false, status: "REMOVED" })
      .where(eq(entityImages.id, primary.id));
    makePrimary = true;
  }
  await tx
    .insert(entityImages)
    .values({ entityId, url, source: source as never, status: "ACTIVE", isPrimary: makePrimary })
    .onConflictDoNothing();
  return true;
}

async function hasActivePrimary(tx: Tx, entityId: number): Promise<boolean> {
  const rows = await tx
    .select({ id: entityImages.id })
    .from(entityImages)
    .where(
      and(
        eq(entityImages.entityId, entityId),
        eq(entityImages.isPrimary, true),
        eq(entityImages.status, "ACTIVE")
      )
    )
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Personagens                                                        */
/* ------------------------------------------------------------------ */

export type CharacterOutcome = "created" | "updated" | "unchanged" | "skipped" | "not_found";

export interface CharacterUpsertResult {
  outcome: CharacterOutcome;
  entityId?: number;
  status?: EntityStatus;
  /** Entrou em quarentena/revisao nesta execucao (nova ou vinda de ACTIVE). */
  quarantined: boolean;
}

/** Ultimo snapshot de favoritos de uma fonte secundaria (revisao reason='favourites'). */
async function latestSnapshot(tx: Tx, entityId: number, source: string): Promise<number | null> {
  const rows = await tx
    .select({ diff: entityRevisions.diff })
    .from(entityRevisions)
    .where(
      and(
        eq(entityRevisions.entityId, entityId),
        eq(entityRevisions.source, source as never),
        eq(entityRevisions.reason, "favourites")
      )
    )
    .orderBy(desc(entityRevisions.createdAt), desc(entityRevisions.id))
    .limit(1);
  const v = (rows[0]?.diff as Json | undefined)?.favourites;
  return typeof v === "number" ? v : null;
}

export async function upsertCharacter(
  ctx: UpsertContext,
  raw: RawCharacter,
  seriesRef: SeriesRef,
  opts: { createIfMissing?: boolean } = {}
): Promise<CharacterUpsertResult> {
  const f = toEntityFields(raw, { universe: seriesRef.universe, seriesIsAdult: seriesRef.isAdult });
  if (f.name === "") return { outcome: "skipped", quarantined: false };
  const floor = ctx.favoritesFloor ?? DEFAULT_FAVORITES_FLOOR;
  const allowAdult = ctx.allowAdult ?? false;

  return ctx.db.transaction(async (tx) => {
    const found = await findEntityByExternalId(tx, raw.source, raw.externalId);
    let entityId = found?.id ?? null;
    let suspects: number[] = [];

    if (entityId === null) {
      const match = await findCrossSourceMatch(tx, {
        source: raw.source,
        nameNormalized: f.nameNormalized,
        nameNative: f.nameNative,
        seriesIds: [seriesRef.seriesId],
      });
      if (match.entityId !== null) {
        entityId = match.entityId;
      } else {
        if (opts.createIfMissing === false) return { outcome: "not_found", quarantined: false };
        suspects = (
          await findSimilarInFranchise(tx, {
            franchiseId: seriesRef.franchiseId,
            name: f.name,
            excludeIds: [],
          })
        ).map((c) => c.id);
        for (const a of match.ambiguous) if (!suspects.includes(a.id)) suspects.push(a.id);
      }
    }

    const isNew = entityId === null;
    let cur: Entity | undefined;
    const diff: Record<string, unknown> = {};

    if (isNew) {
      // O mesmo personagem entra por uma fonte nova: avalia antes de inserir.
      const verdict = evaluateEntity(
        {
          name: f.name,
          nameNormalized: f.nameNormalized,
          gender: f.gender,
          hasImage: f.imageUrl !== null,
          isAdult: f.isAdult,
          isRealPerson: raw.isRealPerson === true,
          sourceFavorites: f.sourceFavorites,
          source: raw.source,
          duplicateOf: suspects,
        },
        { allowAdult, favoritesFloor: floor }
      );
      const slug = await freeSlug(tx, "entities", slugCandidates(f.name, raw.source, raw.externalId));
      const [row] = await tx
        .insert(entities)
        .values({
          slug,
          name: f.name,
          nameNative: f.nameNative,
          nameNormalized: f.nameNormalized,
          universe: f.universe,
          gender: f.gender,
          franchiseId: seriesRef.franchiseId,
          description: f.description,
          status: verdict.status,
          isAdult: f.isAdult,
          sourceFavorites: f.sourceFavorites,
          lastSyncedAt: ctx.now,
        })
        .returning();
      cur = row;
      entityId = row.id;
      await tx.insert(entityExternalIds).values({
        source: raw.source,
        externalId: raw.externalId,
        entityId,
      });
      await tx
        .insert(entitySeries)
        .values({ entityId, seriesId: seriesRef.seriesId, role: raw.role ?? null, isPrimary: true });
      await ensureImage(tx, entityId, raw.imageUrl, raw.source);
      await reconcileModeration(tx, entityId, null, verdict, { now: ctx.now });
      await tx.insert(entityRevisions).values({
        entityId,
        source: raw.source,
        reason: "created",
        diff: { created: { name: f.name, gender: f.gender, status: verdict.status } },
        syncRunId: ctx.syncRunId ?? null,
      });
      return {
        outcome: "created",
        entityId,
        status: verdict.status,
        quarantined: verdict.status !== "ACTIVE",
      };
    }

    // ---- entidade existente ----
    const id = entityId as number;
    [cur] = await tx.select().from(entities).where(eq(entities.id, id));
    if (found === null) {
      await tx
        .insert(entityExternalIds)
        .values({ source: raw.source, externalId: raw.externalId, entityId: id })
        .onConflictDoNothing();
      diff.externalId = [null, `${raw.source}:${raw.externalId}`];
    }
    const sources = (
      await tx
        .select({ source: entityExternalIds.source })
        .from(entityExternalIds)
        .where(eq(entityExternalIds.entityId, id))
    ).map((r) => r.source as string);
    const primarySource = primarySourceOf(sources);
    const isPrimary = raw.source === primarySource;

    const patch: Json = {};
    const change = (key: keyof Entity, value: unknown) => {
      if (cur![key] !== value) {
        patch[key] = value;
        diff[key] = [cur![key], value];
      }
    };
    if (isPrimary) {
      change("name", f.name);
      change("nameNormalized", f.nameNormalized);
      if (f.nameNative !== null) change("nameNative", f.nameNative);
      if (f.gender !== "UNKNOWN") change("gender", f.gender);
      if (f.description !== null) change("description", f.description);
      if (f.isAdult && !cur.isAdult) change("isAdult", true);
      if (f.sourceFavorites > 0) change("sourceFavorites", f.sourceFavorites);
    } else {
      if (cur.nameNative === null && f.nameNative !== null) change("nameNative", f.nameNative);
      if (cur.description === null && f.description !== null) change("description", f.description);
      if (cur.gender === "UNKNOWN" && f.gender !== "UNKNOWN") change("gender", f.gender);
      const prev = await latestSnapshot(tx, id, raw.source);
      if (f.sourceFavorites > 0 && prev !== f.sourceFavorites) {
        await tx.insert(entityRevisions).values({
          entityId: id,
          source: raw.source,
          reason: "favourites",
          diff: { favourites: f.sourceFavorites },
          syncRunId: ctx.syncRunId ?? null,
        });
      }
    }
    if (cur.franchiseId === null && seriesRef.franchiseId !== null) {
      change("franchiseId", seriesRef.franchiseId);
    }

    const link = await tx
      .select({ e: entitySeries.entityId })
      .from(entitySeries)
      .where(and(eq(entitySeries.entityId, id), eq(entitySeries.seriesId, seriesRef.seriesId)))
      .limit(1);
    if (link.length === 0) {
      const hasPrimarySeries = await tx
        .select({ e: entitySeries.entityId })
        .from(entitySeries)
        .where(and(eq(entitySeries.entityId, id), eq(entitySeries.isPrimary, true)))
        .limit(1);
      await tx
        .insert(entitySeries)
        .values({
          entityId: id,
          seriesId: seriesRef.seriesId,
          role: raw.role ?? null,
          isPrimary: hasPrimarySeries.length === 0,
        })
        .onConflictDoNothing();
      diff.series = [null, seriesRef.seriesId];
    }

    if (await ensureImage(tx, id, raw.imageUrl, raw.source)) diff.image = [null, f.imageUrl];

    // ---- quarentena ----
    const waivers = await loadWaivers(tx, id);
    const candidateSource = primarySource;
    const effFavourites = (patch.sourceFavorites as number | undefined) ?? cur.sourceFavorites;
    const verdict = evaluateEntity(
      {
        name: (patch.name as string | undefined) ?? cur.name,
        nameNormalized: (patch.nameNormalized as string | undefined) ?? cur.nameNormalized,
        gender: (patch.gender as string | undefined) ?? cur.gender,
        hasImage: await hasActivePrimary(tx, id),
        isAdult: (patch.isAdult as boolean | undefined) ?? cur.isAdult,
        isRealPerson: raw.isRealPerson === true,
        sourceFavorites: effFavourites,
        source: candidateSource,
        duplicateOf: [],
      },
      { allowAdult, favoritesFloor: floor, waivedReasons: waivers.reasons }
    );
    const rec = await reconcileModeration(tx, id, cur.status, verdict, {
      now: ctx.now,
      genderConfirmed: isPrimary && f.gender !== "UNKNOWN",
    });
    if (rec.status !== cur.status) {
      patch.status = rec.status;
      diff.status = [cur.status, rec.status];
    }

    const changed = Object.keys(diff).length > 0;
    const stale = !cur.lastSyncedAt || ctx.now.getTime() - cur.lastSyncedAt.getTime() > SYNC_TOUCH_MS;
    if (changed || stale) {
      await tx
        .update(entities)
        .set({
          ...patch,
          ...(isPrimary ? { lastSyncedAt: ctx.now } : {}),
          updatedAt: sql`now()`,
        } as never)
        .where(eq(entities.id, id));
    }
    if (changed) {
      await tx.insert(entityRevisions).values({
        entityId: id,
        source: raw.source,
        reason: "sync",
        diff,
        syncRunId: ctx.syncRunId ?? null,
      });
    }
    const quarantined = rec.status !== "ACTIVE" && cur.status === "ACTIVE";
    return {
      outcome: changed ? "updated" : "unchanged",
      entityId: id,
      status: rec.status,
      quarantined,
    };
  });
}
