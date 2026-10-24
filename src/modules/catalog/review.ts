/**
 * Fila de moderacao do catalogo (`moderation_queue`): leitura, navegacao e decisoes humanas.
 *
 * Regras de aprovacao do pipeline (ver cabecalhos de catalog/quarantine.ts e catalog/dedupe.ts):
 * - decisao humana = linha fechada com reviewed_by diferente de "system"; `loadWaivers` passa a
 *   dispensar aquele motivo nas proximas sincronizacoes;
 * - a entidade so ativa (QUARANTINED/PENDING_REVIEW -> ACTIVE) quando nao sobra pendencia aberta,
 *   o genero e conhecido e ha imagem primaria ativa. DISABLED e MERGED sao terminais.
 *
 * O significado de Aprovar/Rejeitar depende do tipo do motivo (`reasonKind`):
 * - waive (NO_IMAGE, UNKNOWN_GENDER, LEGACY_GENDER, ADULT_CONTENT, INVALID_NAME, LOW_FAVORITES,
 *   REAL_PERSON): aprovar dispensa o motivo e mantem a entidade; rejeitar a desativa (DISABLED).
 * - duplicate (DUPLICATE_SUSPECT): aprovar = e duplicata, `mergeEntities` (a existente absorve a
 *   nova); rejeitar = "nao e duplicata" (REJECTED, conforme `loadWaivers`), mantem as duas.
 * - report (USER_REPORT, TAKEDOWN): aprovar a denuncia desativa a entidade; rejeitar a descarta.
 * - neutral (UNMATCHED_DISABLED_SERIES, OTHER): so fecha a linha.
 */
import { and, asc, desc, eq, gt, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { MergeError, mergeEntities, type MergeResult } from "../../catalog/dedupe.js";
import type { DbExecutor } from "../../catalog/executor.js";
import { nameKey } from "../../catalog/normalize.js";
import {
  NAME_MAX_CHARS,
  NAME_MIN_CHARS,
  SYSTEM_REVIEWER,
  type EntityStatus,
  type ModerationReason,
} from "../../catalog/quarantine.js";
import { isOwner } from "../../config/env.js";
import {
  catalogModerators,
  entities,
  entityImages,
  entityRevisions,
  entitySeries,
  franchises,
  moderationQueue,
  series,
} from "../../infra/db/schema/index.js";
import { normalizeName } from "../../lib/text/normalize.js";

export const SETTABLE_GENDERS = ["FEMALE", "MALE", "NONBINARY"] as const;
export type SettableGender = (typeof SETTABLE_GENDERS)[number];

export function isSettableGender(value: string): value is SettableGender {
  return (SETTABLE_GENDERS as readonly string[]).includes(value);
}

export type ReasonKind = "waive" | "duplicate" | "report" | "neutral";

const REPORT_REASONS: ReadonlySet<ModerationReason> = new Set(["USER_REPORT", "TAKEDOWN"]);
const NEUTRAL_REASONS: ReadonlySet<ModerationReason> = new Set(["UNMATCHED_DISABLED_SERIES", "OTHER"]);
const GENDER_REASONS: readonly ModerationReason[] = ["UNKNOWN_GENDER", "LEGACY_GENDER"];

export function reasonKind(reason: ModerationReason): ReasonKind {
  if (reason === "DUPLICATE_SUSPECT") return "duplicate";
  if (REPORT_REASONS.has(reason)) return "report";
  if (NEUTRAL_REASONS.has(reason)) return "neutral";
  return "waive";
}

/* ------------------------------------------------------------------ */
/* Permissao                                                          */
/* ------------------------------------------------------------------ */

/** OWNER_IDS ou linha em catalog_moderators. */
export async function isCatalogModerator(
  db: DbExecutor,
  userId: string,
  ownerCheck: (id: string) => boolean = isOwner
): Promise<boolean> {
  if (ownerCheck(userId)) return true;
  const rows = await db
    .select({ id: catalogModerators.userId })
    .from(catalogModerators)
    .where(eq(catalogModerators.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Leitura                                                            */
/* ------------------------------------------------------------------ */

export interface EntitySummary {
  id: number;
  name: string;
  nameNative: string | null;
  gender: string;
  status: EntityStatus;
  isAdult: boolean;
  sourceFavorites: number;
  franchise: string | null;
  seriesTitle: string | null;
  imageUrl: string | null;
}

export interface QueueItem {
  id: number;
  reason: ModerationReason;
  kind: ReasonKind;
  status: "PENDING" | "APPROVED" | "REJECTED";
  details: Record<string, unknown>;
  createdAt: Date;
  entity: EntitySummary | null;
  other: EntitySummary | null;
  /** Outros motivos ainda pendentes na mesma entidade. */
  siblingReasons: ModerationReason[];
}

export async function loadEntitySummary(
  db: DbExecutor,
  entityId: number
): Promise<EntitySummary | null> {
  const [e] = await db
    .select({
      id: entities.id,
      name: entities.name,
      nameNative: entities.nameNative,
      gender: entities.gender,
      status: entities.status,
      isAdult: entities.isAdult,
      sourceFavorites: entities.sourceFavorites,
      franchise: franchises.name,
    })
    .from(entities)
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!e) return null;
  const [s] = await db
    .select({ title: series.title })
    .from(entitySeries)
    .innerJoin(series, eq(series.id, entitySeries.seriesId))
    .where(eq(entitySeries.entityId, entityId))
    .orderBy(desc(entitySeries.isPrimary))
    .limit(1);
  const [img] = await db
    .select({ url: entityImages.url })
    .from(entityImages)
    .where(
      and(
        eq(entityImages.entityId, entityId),
        eq(entityImages.isPrimary, true),
        eq(entityImages.status, "ACTIVE")
      )
    )
    .limit(1);
  return { ...e, seriesTitle: s?.title ?? null, imageUrl: img?.url ?? null };
}

export async function getQueueItem(db: DbExecutor, id: number): Promise<QueueItem | null> {
  const [row] = await db.select().from(moderationQueue).where(eq(moderationQueue.id, id)).limit(1);
  if (!row) return null;
  const entity = row.entityId !== null ? await loadEntitySummary(db, row.entityId) : null;
  const other = row.otherEntityId !== null ? await loadEntitySummary(db, row.otherEntityId) : null;
  const siblings =
    row.entityId !== null
      ? await db
          .select({ reason: moderationQueue.reason })
          .from(moderationQueue)
          .where(
            and(
              eq(moderationQueue.entityId, row.entityId),
              eq(moderationQueue.status, "PENDING"),
              ne(moderationQueue.id, row.id)
            )
          )
          .orderBy(asc(moderationQueue.id))
      : [];
  return {
    id: row.id,
    reason: row.reason,
    kind: reasonKind(row.reason),
    status: row.status,
    details: (row.details ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    entity,
    other,
    siblingReasons: siblings.map((s) => s.reason),
  };
}

/** Quantos itens pendentes ha e a posicao (1-based) de `id` entre eles. */
export async function queueCounts(
  db: DbExecutor,
  id: number
): Promise<{ total: number; position: number }> {
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      position: sql<number>`(count(*) FILTER (WHERE ${moderationQueue.id} <= ${id}))::int`,
    })
    .from(moderationQueue)
    .where(eq(moderationQueue.status, "PENDING"));
  return { total: r?.total ?? 0, position: r?.position ?? 0 };
}

/** Menor id pendente (item mais antigo), ou null com a fila vazia. */
export async function firstPendingId(db: DbExecutor): Promise<number | null> {
  const [r] = await db
    .select({ id: moderationQueue.id })
    .from(moderationQueue)
    .where(eq(moderationQueue.status, "PENDING"))
    .orderBy(asc(moderationQueue.id))
    .limit(1);
  return r?.id ?? null;
}

/**
 * Vizinho pendente de `fromId` (a linha pode ja ter sido fechada). Da a volta: depois do ultimo
 * vem o primeiro e antes do primeiro vem o ultimo. Fila vazia: null.
 */
export async function neighborPendingId(
  db: DbExecutor,
  fromId: number,
  dir: "next" | "prev"
): Promise<number | null> {
  const pending = eq(moderationQueue.status, "PENDING");
  const forward = dir === "next";
  const [near] = await db
    .select({ id: moderationQueue.id })
    .from(moderationQueue)
    .where(and(pending, forward ? gt(moderationQueue.id, fromId) : lt(moderationQueue.id, fromId)))
    .orderBy(forward ? asc(moderationQueue.id) : desc(moderationQueue.id))
    .limit(1);
  if (near) return near.id;
  const [wrap] = await db
    .select({ id: moderationQueue.id })
    .from(moderationQueue)
    .where(pending)
    .orderBy(forward ? asc(moderationQueue.id) : desc(moderationQueue.id))
    .limit(1);
  return wrap?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Escrita (transacional)                                             */
/* ------------------------------------------------------------------ */

type Tx = DbExecutor;

export type ReviewAction =
  | "approved"
  | "rejected"
  | "merged"
  | "not_duplicate"
  | "dismissed"
  | "gender"
  | "renamed";

export type ReviewFailure =
  | "stale"
  | "blocked_gender"
  | "blocked_image"
  | "invalid_name"
  | "invalid_gender"
  | "no_entity"
  | "merge_failed";

export type ReviewOutcome =
  | {
      ok: true;
      action: ReviewAction;
      entityId: number | null;
      entityName: string | null;
      /** Status final da entidade (null sem entidade). */
      status: EntityStatus | null;
      /** A entidade passou a ACTIVE nesta decisao. */
      activated: boolean;
      /** A entidade passou a DISABLED nesta decisao. */
      disabled: boolean;
      gender?: string;
      name?: string;
      merge?: MergeResult;
      winnerName?: string;
    }
  | { ok: false; code: ReviewFailure; reason?: string };

function assertHuman(reviewer: string): void {
  if (!reviewer || reviewer === SYSTEM_REVIEWER) {
    throw new Error("decisao de moderacao exige um revisor humano (reviewed_by != 'system')");
  }
}

async function hasActivePrimaryImage(tx: Tx, entityId: number): Promise<boolean> {
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

async function lockEntity(tx: Tx, entityId: number) {
  const [e] = await tx.select().from(entities).where(eq(entities.id, entityId)).for("update");
  return e;
}

async function revision(
  tx: Tx,
  entityId: number,
  reviewer: string,
  reason: string,
  diff: Record<string, unknown>
): Promise<void> {
  await tx.insert(entityRevisions).values({
    entityId,
    source: "MANUAL",
    changedBy: reviewer,
    reason,
    diff,
  });
}

/** Fecha as linhas PENDING que casam com `where`. Devolve as fechadas. */
export async function closeRows(
  tx: Tx,
  where: SQL | undefined,
  status: "APPROVED" | "REJECTED",
  reviewer: string,
  now: Date,
  note: Record<string, unknown>
): Promise<Array<{ id: number; reason: ModerationReason }>> {
  assertHuman(reviewer);
  return tx
    .update(moderationQueue)
    .set({
      status,
      reviewedBy: reviewer,
      reviewedAt: now,
      details: sql`${moderationQueue.details} || ${JSON.stringify(note)}::jsonb`,
    })
    .where(and(eq(moderationQueue.status, "PENDING"), where))
    .returning({ id: moderationQueue.id, reason: moderationQueue.reason });
}

/**
 * Ativa a entidade quando nada mais a segura: sem pendencia aberta, genero conhecido e imagem
 * primaria ativa. So mexe em QUARANTINED/PENDING_REVIEW. Devolve o status resultante.
 */
export async function settleEntity(
  tx: Tx,
  entityId: number,
  reviewer: string,
  now: Date
): Promise<EntityStatus | null> {
  const e = await lockEntity(tx, entityId);
  if (!e) return null;
  if (e.status !== "QUARANTINED" && e.status !== "PENDING_REVIEW") return e.status;

  const [pending] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(moderationQueue)
    .where(and(eq(moderationQueue.entityId, entityId), eq(moderationQueue.status, "PENDING")));
  if ((pending?.n ?? 0) > 0) return e.status;
  if (e.gender === "UNKNOWN") return e.status;
  if (!(await hasActivePrimaryImage(tx, entityId))) return e.status;

  await tx.update(entities).set({ status: "ACTIVE", updatedAt: now }).where(eq(entities.id, entityId));
  await revision(tx, entityId, reviewer, "moderation", { status: [e.status, "ACTIVE"] });
  return "ACTIVE";
}

async function disableEntity(tx: Tx, entityId: number, reviewer: string, now: Date): Promise<boolean> {
  const e = await lockEntity(tx, entityId);
  if (!e || e.status === "DISABLED" || e.status === "MERGED") return false;
  await tx
    .update(entities)
    .set({ status: "DISABLED", popularityRank: null, likeRank: null, claimRank: null, updatedAt: now })
    .where(eq(entities.id, entityId));
  await revision(tx, entityId, reviewer, "moderation", { status: [e.status, "DISABLED"] });
  return true;
}

async function lockPendingRow(tx: Tx, itemId: number) {
  const [row] = await tx
    .select()
    .from(moderationQueue)
    .where(eq(moderationQueue.id, itemId))
    .for("update");
  return row && row.status === "PENDING" ? row : undefined;
}

export interface ReviewOptions {
  now?: Date;
}

/** Aprovar o item (semantica por tipo de motivo: ver cabecalho). */
export async function approveItem(
  db: DbExecutor,
  itemId: number,
  reviewer: string,
  opts: ReviewOptions = {}
): Promise<ReviewOutcome> {
  assertHuman(reviewer);
  const now = opts.now ?? new Date();

  const probe = await getQueueItem(db, itemId);
  if (!probe || probe.status !== "PENDING") return { ok: false, code: "stale" };

  if (probe.kind === "duplicate" && probe.entity && probe.other) {
    try {
      const merge = await mergeEntities(db, probe.other.id, probe.entity.id, {
        changedBy: reviewer,
        reason: "moderation_merge",
        now,
      });
      return {
        ok: true,
        action: "merged",
        entityId: probe.other.id,
        entityName: probe.other.name,
        status: probe.other.status,
        activated: false,
        disabled: false,
        merge,
        name: probe.entity.name,
        winnerName: probe.other.name,
      };
    } catch (err) {
      if (err instanceof MergeError) return { ok: false, code: "merge_failed", reason: err.message };
      throw err;
    }
  }

  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const row = await lockPendingRow(tx, itemId);
    if (!row) return { ok: false, code: "stale" };
    const kind = reasonKind(row.reason);
    const entity = row.entityId !== null ? await lockEntity(tx, row.entityId) : undefined;

    if (entity && kind === "waive") {
      if (row.reason === "UNKNOWN_GENDER" && entity.gender === "UNKNOWN") {
        return { ok: false, code: "blocked_gender" };
      }
      if (row.reason === "NO_IMAGE" && !(await hasActivePrimaryImage(tx, entity.id))) {
        return { ok: false, code: "blocked_image" };
      }
    }

    await closeRows(tx, eq(moderationQueue.id, row.id), "APPROVED", reviewer, now, {
      manualApproval: true,
    });

    let status: EntityStatus | null = entity?.status ?? null;
    let disabled = false;
    let activated = false;
    if (entity) {
      if (kind === "report") {
        // Denuncia/remocao procedente: a entidade sai e as demais pendencias dela fecham junto.
        disabled = await disableEntity(tx, entity.id, reviewer, now);
        await closeRows(tx, eq(moderationQueue.entityId, entity.id), "APPROVED", reviewer, now, {
          manualApproval: true,
          closedWithEntity: true,
        });
        if (disabled) status = "DISABLED";
      } else {
        status = await settleEntity(tx, entity.id, reviewer, now);
        activated = status === "ACTIVE" && entity.status !== "ACTIVE";
      }
    }
    return {
      ok: true,
      action: "approved",
      entityId: entity?.id ?? null,
      entityName: entity?.name ?? null,
      status,
      activated,
      disabled,
    };
  });
}

/** Rejeitar o item (semantica por tipo de motivo: ver cabecalho). */
export async function rejectItem(
  db: DbExecutor,
  itemId: number,
  reviewer: string,
  opts: ReviewOptions = {}
): Promise<ReviewOutcome> {
  assertHuman(reviewer);
  const now = opts.now ?? new Date();

  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const row = await lockPendingRow(tx, itemId);
    if (!row) return { ok: false, code: "stale" };
    const kind = reasonKind(row.reason);
    const entity = row.entityId !== null ? await lockEntity(tx, row.entityId) : undefined;

    let action: ReviewAction = "rejected";
    if (kind === "duplicate") action = "not_duplicate";
    else if (kind === "report") action = "dismissed";

    await closeRows(tx, eq(moderationQueue.id, row.id), "REJECTED", reviewer, now, {
      manualRejection: true,
    });

    let status: EntityStatus | null = entity?.status ?? null;
    let disabled = false;
    let activated = false;
    if (entity) {
      if (kind === "waive") {
        disabled = await disableEntity(tx, entity.id, reviewer, now);
        await closeRows(tx, eq(moderationQueue.entityId, entity.id), "REJECTED", reviewer, now, {
          manualRejection: true,
          closedWithEntity: true,
        });
        if (disabled) status = "DISABLED";
      } else {
        status = await settleEntity(tx, entity.id, reviewer, now);
        activated = status === "ACTIVE" && entity.status !== "ACTIVE";
      }
    }
    return {
      ok: true,
      action,
      entityId: entity?.id ?? null,
      entityName: entity?.name ?? null,
      status,
      activated,
      disabled,
    };
  });
}

/** Define o genero da entidade do item e fecha os motivos de genero pendentes. */
export async function setItemGender(
  db: DbExecutor,
  itemId: number,
  gender: string,
  reviewer: string,
  opts: ReviewOptions = {}
): Promise<ReviewOutcome> {
  assertHuman(reviewer);
  if (!isSettableGender(gender)) return { ok: false, code: "invalid_gender" };
  const now = opts.now ?? new Date();

  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const row = await lockPendingRow(tx, itemId);
    if (!row) return { ok: false, code: "stale" };
    if (row.entityId === null) return { ok: false, code: "no_entity" };
    const entity = await lockEntity(tx, row.entityId);
    if (!entity || entity.status === "DISABLED" || entity.status === "MERGED") {
      return { ok: false, code: "stale" };
    }

    if (entity.gender !== gender) {
      await tx.update(entities).set({ gender, updatedAt: now }).where(eq(entities.id, entity.id));
      await revision(tx, entity.id, reviewer, "moderation", { gender: [entity.gender, gender] });
    }
    await closeRows(
      tx,
      and(
        eq(moderationQueue.entityId, entity.id),
        inArray(moderationQueue.reason, [...GENDER_REASONS])
      ),
      "APPROVED",
      reviewer,
      now,
      { manualGender: gender }
    );
    const status = await settleEntity(tx, entity.id, reviewer, now);
    return {
      ok: true,
      action: "gender",
      entityId: entity.id,
      entityName: entity.name,
      status,
      activated: status === "ACTIVE" && entity.status !== "ACTIVE",
      disabled: false,
      gender,
    };
  });
}

/** Normaliza e valida um nome digitado por moderador; null se invalido. */
export function cleanEntityName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  const length = Array.from(name).length;
  if (length < NAME_MIN_CHARS || length > NAME_MAX_CHARS) return null;
  if (nameKey(name) === "" && normalizeName(name) === "") return null;
  return name;
}

/** Corrige o nome da entidade do item e fecha INVALID_NAME pendente. */
export async function renameItemEntity(
  db: DbExecutor,
  itemId: number,
  rawName: string,
  reviewer: string,
  opts: ReviewOptions = {}
): Promise<ReviewOutcome> {
  assertHuman(reviewer);
  const name = cleanEntityName(rawName);
  if (!name) return { ok: false, code: "invalid_name" };
  const now = opts.now ?? new Date();

  return db.transaction(async (tx): Promise<ReviewOutcome> => {
    const row = await lockPendingRow(tx, itemId);
    if (!row) return { ok: false, code: "stale" };
    if (row.entityId === null) return { ok: false, code: "no_entity" };
    const entity = await lockEntity(tx, row.entityId);
    if (!entity || entity.status === "DISABLED" || entity.status === "MERGED") {
      return { ok: false, code: "stale" };
    }

    if (entity.name !== name) {
      const key = nameKey(name);
      await tx
        .update(entities)
        .set({ name, nameNormalized: key === "" ? normalizeName(name) : key, updatedAt: now })
        .where(eq(entities.id, entity.id));
      await revision(tx, entity.id, reviewer, "moderation", { name: [entity.name, name] });
    }
    await closeRows(
      tx,
      and(eq(moderationQueue.entityId, entity.id), eq(moderationQueue.reason, "INVALID_NAME")),
      "APPROVED",
      reviewer,
      now,
      { manualName: name }
    );
    const status = await settleEntity(tx, entity.id, reviewer, now);
    return {
      ok: true,
      action: "renamed",
      entityId: entity.id,
      entityName: name,
      status,
      activated: status === "ACTIVE" && entity.status !== "ACTIVE",
      disabled: false,
      name,
    };
  });
}
