import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { moderationQueue } from "../infra/db/schema/index.js";
import type { Entity, ModerationItem } from "../infra/db/schema/index.js";
import type { DbExecutor } from "./executor.js";

export type ModerationReason = ModerationItem["reason"];
export type EntityStatus = Entity["status"];

/** Quem fecha automaticamente uma pendencia quando a regra deixa de se aplicar. */
export const SYSTEM_REVIEWER = "system";

/**
 * Motivos avaliados a cada sincronizacao. Quando a regra deixa de falhar (chegou imagem, genero
 * confirmado, favoritos subiram...), a pendencia e fechada sozinha e a entidade pode ativar.
 * LEGACY_GENDER so fecha quando a fonte confirma o genero (ver `genderConfirmed`).
 */
export const AUTO_REASONS: ReadonlySet<ModerationReason> = new Set<ModerationReason>([
  "NO_IMAGE",
  "UNKNOWN_GENDER",
  "LEGACY_GENDER",
  "ADULT_CONTENT",
  "INVALID_NAME",
  "LOW_FAVORITES",
]);

/** Motivos que exigem decisao humana: mandam a entidade para PENDING_REVIEW. */
export const REVIEW_REASONS: ReadonlySet<ModerationReason> = new Set<ModerationReason>([
  "REAL_PERSON",
  "DUPLICATE_SUSPECT",
]);

export const NAME_MIN_CHARS = 2;
export const NAME_MAX_CHARS = 64;

/**
 * Piso de favoritos por fonte (abaixo disto: LOW_FAVORITES). IGDB e TMDB ficam em 0 porque o
 * valor delas nao e "favoritos de personagem" (popularidade da obra/ator).
 */
export const DEFAULT_FAVORITES_FLOOR: Readonly<Record<string, number>> = {
  ANILIST: 10,
  JIKAN: 10,
  IGDB: 0,
  TMDB: 0,
  MANUAL: 0,
  LEGACY: 0,
};

export interface QuarantineInput {
  name: string;
  /** Chave de dedupe; vazia significa nome sem letras nem numeros. */
  nameNormalized: string;
  gender: string;
  hasImage: boolean;
  isAdult: boolean;
  isRealPerson: boolean;
  sourceFavorites: number;
  /** Fonte primaria da entidade (define o piso de favoritos). */
  source: string;
  /** Entidades suspeitas de serem a mesma (ja sem os pares dispensados por um moderador). */
  duplicateOf?: readonly number[];
}

export interface QuarantineOptions {
  /** Catalogo aceita conteudo adulto (ativa com is_adult=true; o filtro por servidor e do pool). */
  allowAdult: boolean;
  favoritesFloor: Readonly<Record<string, number>>;
  /** Motivos dispensados por um moderador (aprovacao manual persiste entre sincronizacoes). */
  waivedReasons?: ReadonlySet<ModerationReason>;
}

export interface Finding {
  reason: ModerationReason;
  otherEntityId?: number;
  details?: Record<string, unknown>;
}

export interface Verdict {
  status: "ACTIVE" | "QUARANTINED" | "PENDING_REVIEW";
  findings: Finding[];
}

/**
 * Avalia as regras de quarentena (puro).
 * Qualquer motivo de revisao humana (REAL_PERSON, DUPLICATE_SUSPECT) leva a PENDING_REVIEW;
 * os demais levam a QUARANTINED; sem nenhum motivo a entidade fica ACTIVE.
 */
export function evaluateEntity(input: QuarantineInput, options: QuarantineOptions): Verdict {
  const waived = options.waivedReasons ?? new Set<ModerationReason>();
  const findings: Finding[] = [];
  const add = (f: Finding) => {
    if (!waived.has(f.reason)) findings.push(f);
  };

  if (!input.hasImage) add({ reason: "NO_IMAGE" });
  if (input.gender === "UNKNOWN") add({ reason: "UNKNOWN_GENDER" });
  if (input.isAdult && !options.allowAdult) add({ reason: "ADULT_CONTENT" });

  const length = Array.from(input.name.trim()).length;
  if (length < NAME_MIN_CHARS || length > NAME_MAX_CHARS || input.nameNormalized === "") {
    add({ reason: "INVALID_NAME", details: { length } });
  }

  const floor = options.favoritesFloor[input.source] ?? 0;
  if (input.sourceFavorites < floor) {
    add({
      reason: "LOW_FAVORITES",
      details: { favourites: input.sourceFavorites, floor, source: input.source },
    });
  }

  if (input.isRealPerson) add({ reason: "REAL_PERSON" });

  for (const other of input.duplicateOf ?? []) {
    add({ reason: "DUPLICATE_SUSPECT", otherEntityId: other });
  }

  if (findings.length === 0) return { status: "ACTIVE", findings };
  const needsReview = findings.some((f) => REVIEW_REASONS.has(f.reason));
  return { status: needsReview ? "PENDING_REVIEW" : "QUARANTINED", findings };
}

/* ------------------------------------------------------------------ */
/* Banco                                                              */
/* ------------------------------------------------------------------ */

export interface Waivers {
  reasons: Set<ModerationReason>;
  /** Pares marcados como "nao e duplicata" por um moderador. */
  notDuplicateOf: Set<number>;
}

/**
 * Decisoes humanas que se sobrepoem as regras automaticas:
 * - aprovacao manual (APPROVED por alguem que nao e o sistema) dispensa aquele motivo;
 * - DUPLICATE_SUSPECT rejeitado = "nao e duplicata" daquele par.
 */
export async function loadWaivers(db: DbExecutor, entityId: number): Promise<Waivers> {
  const rows = await db
    .select({
      reason: moderationQueue.reason,
      status: moderationQueue.status,
      entityId: moderationQueue.entityId,
      other: moderationQueue.otherEntityId,
    })
    .from(moderationQueue)
    .where(
      and(
        or(eq(moderationQueue.entityId, entityId), eq(moderationQueue.otherEntityId, entityId)),
        inArray(moderationQueue.status, ["APPROVED", "REJECTED"]),
        or(isNull(moderationQueue.reviewedBy), ne(moderationQueue.reviewedBy, SYSTEM_REVIEWER))
      )
    );

  const waivers: Waivers = { reasons: new Set(), notDuplicateOf: new Set() };
  for (const r of rows) {
    if (r.reason === "DUPLICATE_SUSPECT") {
      if (r.status === "REJECTED") {
        const counterpart = r.entityId === entityId ? r.other : r.entityId;
        if (counterpart !== null) waivers.notDuplicateOf.add(counterpart);
      }
    } else if (r.status === "APPROVED" && r.entityId === entityId) {
      waivers.reasons.add(r.reason);
    }
  }
  return waivers;
}

export interface ReconcileOptions {
  now: Date;
  /** A fonte primaria trouxe genero conhecido: fecha LEGACY_GENDER. */
  genderConfirmed?: boolean;
}

export interface ReconcileResult {
  /** Status final desejado (o chamador grava em entities.status). */
  status: EntityStatus;
  inserted: number;
  resolved: number;
}

/**
 * Aplica o veredito: abre pendencias novas em moderation_queue (sem duplicar as abertas, graças
 * ao indice unico uq_moderation_pending), fecha as automaticas que deixaram de valer e decide
 * o status final.
 *
 * Regras de status:
 * - veredito nao ACTIVE: vale o status do veredito (ACTIVE, QUARANTINED e PENDING_REVIEW trocam);
 * - veredito ACTIVE: quem ja e ACTIVE continua; quem estava em quarentena/revisao so ativa se nao
 *   sobrou nenhuma pendencia aberta (decisao humana pendente bloqueia a ativacao automatica).
 * DISABLED e MERGED sao terminais: nunca mudam aqui.
 */
export async function reconcileModeration(
  db: DbExecutor,
  entityId: number,
  currentStatus: EntityStatus | null,
  verdict: Verdict,
  opts: ReconcileOptions
): Promise<ReconcileResult> {
  if (currentStatus === "DISABLED" || currentStatus === "MERGED") {
    return { status: currentStatus, inserted: 0, resolved: 0 };
  }

  const open = await db
    .select({
      id: moderationQueue.id,
      reason: moderationQueue.reason,
      other: moderationQueue.otherEntityId,
    })
    .from(moderationQueue)
    .where(and(eq(moderationQueue.entityId, entityId), eq(moderationQueue.status, "PENDING")));

  let inserted = 0;
  for (const f of verdict.findings) {
    if (f.reason === "DUPLICATE_SUSPECT" && f.otherEntityId !== undefined) {
      // O mesmo par pode ja estar aberto a partir do outro lado.
      const reverse = await db
        .select({ id: moderationQueue.id })
        .from(moderationQueue)
        .where(
          and(
            eq(moderationQueue.entityId, f.otherEntityId),
            eq(moderationQueue.otherEntityId, entityId),
            eq(moderationQueue.reason, "DUPLICATE_SUSPECT"),
            eq(moderationQueue.status, "PENDING")
          )
        )
        .limit(1);
      if (reverse.length > 0) continue;
    }
    const rows = await db
      .insert(moderationQueue)
      .values({
        entityId,
        otherEntityId: f.otherEntityId ?? null,
        reason: f.reason,
        details: f.details ?? {},
      })
      .onConflictDoNothing()
      .returning({ id: moderationQueue.id });
    inserted += rows.length;
  }

  const stillFailing = new Set(verdict.findings.map((f) => f.reason));
  const toResolve = open.filter(
    (row) =>
      AUTO_REASONS.has(row.reason) &&
      !stillFailing.has(row.reason) &&
      (row.reason !== "LEGACY_GENDER" || opts.genderConfirmed === true)
  );
  if (toResolve.length > 0) {
    await db
      .update(moderationQueue)
      .set({
        status: "APPROVED",
        reviewedBy: SYSTEM_REVIEWER,
        reviewedAt: opts.now,
        details: sql`${moderationQueue.details} || '{"autoResolved": true}'::jsonb`,
      })
      .where(
        inArray(
          moderationQueue.id,
          toResolve.map((r) => r.id)
        )
      );
  }

  const resolvedIds = new Set(toResolve.map((r) => r.id));
  const blocking = open.filter((r) => !resolvedIds.has(r.id)).length;

  let status: EntityStatus;
  if (verdict.status !== "ACTIVE") status = verdict.status;
  else if (currentStatus === "ACTIVE") status = "ACTIVE";
  else if (currentStatus === null) status = "ACTIVE";
  else status = blocking > 0 ? currentStatus : "ACTIVE";

  return { status, inserted, resolved: toResolve.length };
}

/** Abre uma pendencia avulsa (ex.: images.verify sem imagem sobrando). Idempotente. */
export async function openModeration(
  db: DbExecutor,
  item: { entityId: number; reason: ModerationReason; otherEntityId?: number; details?: Record<string, unknown> }
): Promise<boolean> {
  const rows = await db
    .insert(moderationQueue)
    .values({
      entityId: item.entityId,
      otherEntityId: item.otherEntityId ?? null,
      reason: item.reason,
      details: item.details ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: moderationQueue.id });
  return rows.length > 0;
}
