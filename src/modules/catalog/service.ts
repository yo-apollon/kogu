/**
 * Servico do modulo CATALOG: papeis e cota de `$import`, importacao sob demanda pelo pipeline,
 * fila de sugestoes e merge manual. Sem i18n e sem discord.js: os comandos traduzem os resultados.
 * Todas as funcoes recebem o `db` (ou uma transacao) por parametro.
 */
import { and, asc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { MergeError, mergeEntities, type MergeResult } from "../../catalog/dedupe.js";
import type { DbExecutor } from "../../catalog/executor.js";
import { nameKey } from "../../catalog/normalize.js";
import { baseAetherFor } from "../../catalog/scoring.js";
import type { EntityStatus, ModerationReason } from "../../catalog/quarantine.js";
import { upsertCharacter, upsertSeries, type UpsertContext } from "../../catalog/upsert.js";
import { isOwner } from "../../config/env.js";
import {
  characterSuggestions,
  entities,
  guilds,
  moderationQueue,
  users,
  type CharacterSuggestion,
} from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import type { KV } from "../../infra/redis/kv.js";
import { publishEvent } from "../../infra/redis/pubsub.js";
import { childLogger } from "../../lib/logger.js";
import { normalizeName } from "../../lib/text/normalize.js";
import { type CharacterFinder } from "./anilist.js";
import { closeRows, loadEntitySummary, settleEntity } from "./review.js";

const log = childLogger("catalog:module");

/* ------------------------------------------------------------------ */
/* Papeis e cota do $import                                           */
/* ------------------------------------------------------------------ */

/** Importacoes por dia (UTC) de um VIP. Owners nao tem limite. */
export const VIP_DAILY_IMPORT_LIMIT = 2;

export type ImportRole = "owner" | "vip" | "denied";

/** owner (OWNER_IDS) > vip (users.vip_tier > 0) > denied. */
export async function resolveImportRole(
  db: DbExecutor,
  userId: string,
  ownerCheck: (id: string) => boolean = isOwner
): Promise<ImportRole> {
  if (ownerCheck(userId)) return "owner";
  const [row] = await db
    .select({ tier: users.vipTier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row && row.tier > 0 ? "vip" : "denied";
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Garante a linha de `users` sem sobrescrever o resto (idempotente). */
export async function ensureUserRow(
  db: DbExecutor,
  userId: string,
  username?: string
): Promise<void> {
  if (!username) {
    await db.insert(users).values({ id: userId, username: userId }).onConflictDoNothing();
    return;
  }
  await db
    .insert(users)
    .values({ id: userId, username })
    .onConflictDoUpdate({
      target: users.id,
      set: { username },
      setWhere: sql`${users.username} IS DISTINCT FROM ${username}`,
    });
}

export interface QuotaOptions {
  now?: Date;
  max?: number;
}

/**
 * Consome 1 importacao do dia em UM UPDATE atomico. Dia novo (UTC) reinicia o contador em 1; no
 * mesmo dia incrementa ate `max`. Sem linha atualizada = limite atingido (ou usuario inexistente).
 */
export async function claimVipImport(
  db: DbExecutor,
  userId: string,
  opts: QuotaOptions = {}
): Promise<{ ok: true; used: number } | { ok: false }> {
  const now = opts.now ?? new Date();
  const max = opts.max ?? VIP_DAILY_IMPORT_LIMIT;
  const dayStart = utcDayStart(now);
  const dayIso = dayStart.toISOString();
  const nowIso = now.toISOString();

  const [row] = await db
    .update(users)
    .set({
      dailyImportsCount: sql`CASE WHEN ${users.lastImportReset} < ${dayIso}::timestamptz THEN 1 ELSE ${users.dailyImportsCount} + 1 END`,
      lastImportReset: sql`CASE WHEN ${users.lastImportReset} < ${dayIso}::timestamptz THEN ${nowIso}::timestamptz ELSE ${users.lastImportReset} END`,
    })
    .where(
      and(eq(users.id, userId), or(lt(users.lastImportReset, dayStart), lt(users.dailyImportsCount, max)))
    )
    .returning({ used: users.dailyImportsCount });
  return row ? { ok: true, used: row.used } : { ok: false };
}

/** Devolve a importacao consumida quando nada foi importado (nao achou, API fora, ja existia). */
export async function refundVipImport(
  db: DbExecutor,
  userId: string,
  opts: Pick<QuotaOptions, "now"> = {}
): Promise<void> {
  const dayStart = utcDayStart(opts.now ?? new Date());
  await db
    .update(users)
    .set({ dailyImportsCount: sql`GREATEST(${users.dailyImportsCount} - 1, 0)` })
    .where(and(eq(users.id, userId), sql`${users.lastImportReset} >= ${dayStart.toISOString()}::timestamptz`));
}

/* ------------------------------------------------------------------ */
/* Importacao                                                         */
/* ------------------------------------------------------------------ */

/** Mesmo default de createJobContext: o catalogo so aceita adulto com CATALOG_ALLOW_ADULT=true. */
export function catalogAllowsAdult(): boolean {
  return process.env.CATALOG_ALLOW_ADULT === "true";
}

export interface ImportedEntity {
  id: number;
  name: string;
  franchise: string;
  seriesTitle: string | null;
  status: EntityStatus;
  gender: string;
  aether: number;
  imageUrl: string | null;
  /** Motivos de moderacao ainda abertos. */
  pendingReasons: ModerationReason[];
}

export type ImportOutcome =
  | { kind: "not_found" }
  /** DISABLED/MERGED: nao reimportavel. */
  | { kind: "disabled"; entity: ImportedEntity }
  /** Ja estava no catalogo e nada mudou. */
  | { kind: "exists"; entity: ImportedEntity; anilistId: number | null }
  /** Criada agora, ou ativada agora por um owner. */
  | { kind: "imported"; entity: ImportedEntity; created: boolean; activated: boolean; anilistId: number | null };

export interface ImportOptions {
  db: DbExecutor;
  finder: CharacterFinder;
  /** Quem importa. So `isOwner` pode ativar direto uma entidade em quarentena. */
  actor: { id: string; isOwner: boolean };
  now?: Date;
  allowAdult?: boolean;
}

/** Motivos que a importacao de um owner dispensa (decisao curatorial explicita). */
export const OWNER_WAIVED_REASONS: readonly ModerationReason[] = ["LOW_FAVORITES", "ADULT_CONTENT"];

async function loadImported(db: DbExecutor, entityId: number): Promise<ImportedEntity> {
  const summary = await loadEntitySummary(db, entityId);
  if (!summary) throw new Error(`entidade ${entityId} sumiu logo apos a importacao`);
  const [row] = await db
    .select({ aether: entities.baseAether })
    .from(entities)
    .where(eq(entities.id, entityId));
  const pending = await db
    .select({ reason: moderationQueue.reason })
    .from(moderationQueue)
    .where(and(eq(moderationQueue.entityId, entityId), eq(moderationQueue.status, "PENDING")))
    .orderBy(asc(moderationQueue.id));
  return {
    id: summary.id,
    name: summary.name,
    franchise: summary.franchise ?? summary.seriesTitle ?? "",
    seriesTitle: summary.seriesTitle,
    status: summary.status,
    gender: summary.gender,
    aether: row?.aether ?? 0,
    imageUrl: summary.imageUrl,
    pendingReasons: pending.map((p) => p.reason),
  };
}

/**
 * Eter provisorio de uma entidade recem-ativada: percentil dos favoritos entre as ativas, com a
 * mesma formula do rerank (`baseAetherFor`). O `catalog.rerank` diario sobrescreve (tier, rank,
 * peso); isto so evita que a carta importada valha o padrao (100) ate la.
 */
export async function applyProvisionalAether(db: DbExecutor, entityId: number): Promise<number | null> {
  const [me] = await db
    .select({ favorites: entities.sourceFavorites })
    .from(entities)
    .where(eq(entities.id, entityId));
  if (!me) return null;
  const [r] = await db
    .select({
      others: sql<number>`count(*)::int`,
      lower: sql<number>`(count(*) FILTER (WHERE ${entities.sourceFavorites} < ${me.favorites}))::int`,
    })
    .from(entities)
    .where(and(eq(entities.status, "ACTIVE"), ne(entities.id, entityId)));
  const score = r && r.others > 0 ? r.lower / r.others : 0;
  const aether = baseAetherFor(score);
  await db
    .update(entities)
    .set({ baseAether: aether, popularityScore: score })
    .where(eq(entities.id, entityId));
  return aether;
}

/** Avisa o pool de sorteio (e demais instancias) que o catalogo mudou. Nunca lanca. */
export async function notifyCatalogUpdated(source: string, kv?: KV): Promise<void> {
  try {
    await publishEvent(kv ?? (await getKV()), "catalog:updated", { source, at: Date.now() });
  } catch (err) {
    log.warn({ err }, "falha ao publicar catalog:updated");
  }
}

/**
 * Busca `query` no AniList e grava pelo pipeline (`upsertSeries` + `upsertCharacter`): o status
 * inicial segue as regras de quarentena. Owner: LOW_FAVORITES e ADULT_CONTENT sao dispensados
 * (aprovacao humana registrada com o id do owner, que persiste entre sincronizacoes) e a entidade
 * ativa direto; genero desconhecido, sem imagem, nome invalido e duplicata continuam na fila.
 * Lanca `CatalogApiError` quando o AniList falha.
 */
export async function importCharacter(query: string, opts: ImportOptions): Promise<ImportOutcome> {
  const { db, finder, actor } = opts;
  const now = opts.now ?? new Date();

  const match = await finder.find(query);
  if (!match) return { kind: "not_found" };

  const ctx: UpsertContext = { db, now, allowAdult: opts.allowAdult ?? catalogAllowsAdult() };
  const seriesRef = await upsertSeries(ctx, match.series);
  if (!seriesRef) return { kind: "not_found" };
  const result = await upsertCharacter(ctx, match.character, seriesRef);
  if (result.entityId === undefined || result.outcome === "skipped" || result.outcome === "not_found") {
    return { kind: "not_found" };
  }
  const created = result.outcome === "created";
  const anilistId = Number.parseInt(match.character.externalId, 10);
  const sourceId = Number.isFinite(anilistId) ? anilistId : null;

  let entity = await loadImported(db, result.entityId);
  if (entity.status === "DISABLED" || entity.status === "MERGED") return { kind: "disabled", entity };

  let activated = false;
  if (entity.status !== "ACTIVE" && actor.isOwner) {
    const entityId = entity.id;
    const status = await db.transaction(async (tx) => {
      await closeRows(
        tx,
        and(
          eq(moderationQueue.entityId, entityId),
          inArray(moderationQueue.reason, [...OWNER_WAIVED_REASONS])
        ),
        "APPROVED",
        actor.id,
        now,
        { ownerImport: true }
      );
      return settleEntity(tx, entityId, actor.id, now);
    });
    activated = status === "ACTIVE";
    if (activated) entity = await loadImported(db, entity.id);
  }

  if ((created || activated) && entity.status === "ACTIVE") {
    const aether = await applyProvisionalAether(db, entity.id);
    if (aether !== null) entity = { ...entity, aether };
  }

  if (created || activated) {
    return { kind: "imported", entity, created, activated, anilistId: sourceId };
  }
  return { kind: "exists", entity, anilistId: sourceId };
}

/* ------------------------------------------------------------------ */
/* Sugestoes                                                          */
/* ------------------------------------------------------------------ */

/** Sugestoes pendentes por usuario (em todos os servidores). */
export const SUGGEST_MAX_PENDING = 5;
export const SUGGEST_NAME_MAX = 100;

export type SuggestResult =
  | { status: "created"; id: number; pending: number }
  | { status: "limit"; max: number }
  | { status: "duplicate" }
  | { status: "exists"; entityName: string; franchise: string };

export interface SuggestInput {
  guildId: string;
  userId: string;
  username?: string;
  characterName: string;
}

export function cleanSuggestionName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SUGGEST_NAME_MAX);
}

/**
 * Enfileira uma sugestao. Em transacao com lock consultivo por usuario, o limite de pendentes nao
 * estoura sob concorrencia. Recusa nome ja presente no catalogo (chave normalizada exata) e nome ja
 * pendente na fila (qualquer usuario).
 */
export async function createSuggestion(
  db: DbExecutor,
  input: SuggestInput,
  opts: { max?: number } = {}
): Promise<SuggestResult> {
  const max = opts.max ?? SUGGEST_MAX_PENDING;
  const name = cleanSuggestionName(input.characterName);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`suggest:${input.userId}`}, 0))`);
    await tx.insert(guilds).values({ id: input.guildId }).onConflictDoNothing();
    await ensureUserRow(tx, input.userId, input.username);

    const [mine] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(characterSuggestions)
      .where(and(eq(characterSuggestions.userId, input.userId), eq(characterSuggestions.status, "PENDING")));
    if ((mine?.n ?? 0) >= max) return { status: "limit", max } as const;

    const [dup] = await tx
      .select({ id: characterSuggestions.id })
      .from(characterSuggestions)
      .where(
        and(
          eq(characterSuggestions.status, "PENDING"),
          sql`lower(${characterSuggestions.characterName}) = ${name.toLowerCase()}`
        )
      )
      .limit(1);
    if (dup) return { status: "duplicate" } as const;

    const key = nameKey(name);
    if (key !== "") {
      const [known] = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.nameNormalized, key), ne(entities.status, "MERGED")))
        .limit(1);
      if (known) {
        const summary = await loadEntitySummary(tx, known.id);
        if (summary) {
          return {
            status: "exists",
            entityName: summary.name,
            franchise: summary.franchise ?? summary.seriesTitle ?? "",
          } as const;
        }
      }
    }

    const [row] = await tx
      .insert(characterSuggestions)
      .values({ guildId: input.guildId, userId: input.userId, characterName: name })
      .returning({ id: characterSuggestions.id });
    return { status: "created", id: row.id, pending: (mine?.n ?? 0) + 1 } as const;
  });
}

export interface SuggestionScope {
  /** Restringe a um servidor (staff comum); omitido = fila global (owner/moderador do catalogo). */
  guildId?: string;
}

export async function listPendingSuggestions(
  db: DbExecutor,
  opts: SuggestionScope & { limit: number; offset: number }
): Promise<{ rows: CharacterSuggestion[]; total: number }> {
  const where = and(
    eq(characterSuggestions.status, "PENDING"),
    opts.guildId ? eq(characterSuggestions.guildId, opts.guildId) : undefined
  );
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(characterSuggestions)
    .where(where);
  const rows = await db
    .select()
    .from(characterSuggestions)
    .where(where)
    .orderBy(asc(characterSuggestions.createdAt), asc(characterSuggestions.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return { rows, total: count?.n ?? 0 };
}

/** Sugestao pendente que casa com o nome digitado: igualdade normalizada primeiro, depois "contem". */
export async function findPendingSuggestion(
  db: DbExecutor,
  query: string,
  scope: SuggestionScope = {}
): Promise<CharacterSuggestion | null> {
  const wanted = normalizeName(query);
  if (wanted === "") return null;
  const { rows } = await listPendingSuggestions(db, { ...scope, limit: 500, offset: 0 });
  return (
    rows.find((r) => normalizeName(r.characterName) === wanted) ??
    rows.find((r) => normalizeName(r.characterName).includes(wanted)) ??
    null
  );
}

/** Reserva a sugestao para o revisor (PENDING -> APPROVED atomico). false = outro staff pegou. */
export async function claimSuggestion(
  db: DbExecutor,
  id: number,
  reviewer: string,
  now: Date = new Date()
): Promise<boolean> {
  const rows = await db
    .update(characterSuggestions)
    .set({ status: "APPROVED", reviewedBy: reviewer, reviewedAt: now })
    .where(and(eq(characterSuggestions.id, id), eq(characterSuggestions.status, "PENDING")))
    .returning({ id: characterSuggestions.id });
  return rows.length > 0;
}

/** Desfaz `claimSuggestion` quando a importacao nao aconteceu. */
export async function releaseSuggestion(db: DbExecutor, id: number): Promise<void> {
  await db
    .update(characterSuggestions)
    .set({ status: "PENDING", reviewedBy: null, reviewedAt: null })
    .where(and(eq(characterSuggestions.id, id), eq(characterSuggestions.status, "APPROVED")));
}

export async function resolveSuggestion(
  db: DbExecutor,
  id: number,
  resolved: { entityId: number; anilistId: number | null }
): Promise<void> {
  await db
    .update(characterSuggestions)
    .set({ resolvedEntityId: resolved.entityId, anilistId: resolved.anilistId })
    .where(eq(characterSuggestions.id, id));
}

/* ------------------------------------------------------------------ */
/* Merge manual                                                       */
/* ------------------------------------------------------------------ */

export type MergeOutcome =
  | { ok: true; winner: { id: number; name: string }; loser: { id: number; name: string }; result: MergeResult }
  | { ok: false; code: "not_found"; id: number }
  | { ok: false; code: "failed"; reason: string };

export type MergePreview =
  | { ok: true; winner: { id: number; name: string }; loser: { id: number; name: string } }
  | { ok: false; code: "not_found"; id: number }
  | { ok: false; code: "failed"; reason: string };

/** Confere que as duas entidades existem e podem ser mescladas (para o prompt de confirmacao). */
export async function previewMerge(
  db: DbExecutor,
  winnerId: number,
  loserId: number
): Promise<MergePreview> {
  if (winnerId === loserId) return { ok: false, code: "failed", reason: "same entity" };
  const winner = await loadEntitySummary(db, winnerId);
  if (!winner) return { ok: false, code: "not_found", id: winnerId };
  const loser = await loadEntitySummary(db, loserId);
  if (!loser) return { ok: false, code: "not_found", id: loserId };
  if (winner.status === "MERGED") return { ok: false, code: "failed", reason: "winner already merged" };
  if (loser.status === "MERGED") return { ok: false, code: "failed", reason: "loser already merged" };
  return {
    ok: true,
    winner: { id: winner.id, name: winner.name },
    loser: { id: loser.id, name: loser.name },
  };
}

/** `/catalog merge <id1> <id2>`: id1 permanece, id2 e absorvida (`mergeEntities`, transacional). */
export async function mergeCatalogEntities(
  db: DbExecutor,
  winnerId: number,
  loserId: number,
  moderatorId: string,
  now: Date = new Date()
): Promise<MergeOutcome> {
  const preview = await previewMerge(db, winnerId, loserId);
  if (!preview.ok) return preview;
  try {
    const result = await mergeEntities(db, winnerId, loserId, {
      changedBy: moderatorId,
      reason: "manual_merge",
      now,
    });
    return { ok: true, winner: preview.winner, loser: preview.loser, result };
  } catch (err) {
    if (err instanceof MergeError) return { ok: false, code: "failed", reason: err.message };
    throw err;
  }
}
