/**
 * Servico da Lista de Desejos (wishes) e da busca de entidades usada no autocomplete.
 *
 * - Busca: pg_trgm sobre `entities.name_normalized` (tokens ordenados, sem acento). A consulta e
 *   normalizada do mesmo jeito; alem da similaridade (`%`), todos os tokens digitados podem aparecer
 *   como substring (`LIKE '%tok%'`), o que cobre digitacao parcial ("zero tw"). Ambos usam o indice GIN.
 * - Autocomplete: resultado em cache no KV por 60 s (`cacheGetOrSet`), chave pela consulta normalizada.
 * - Escrita: uma transacao por operacao; o membro e travado (`FOR UPDATE`) para que o limite da lista
 *   nao seja furado por adicoes concorrentes. `ensureMember` garante a FK composta (guild_members).
 * - Sem SELECT *: toda query lista colunas.
 */
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entitySeries,
  franchises,
  guildMembers,
  guilds,
  series,
  wishes,
} from "../../infra/db/schema/index.js";
import { cacheGetOrSet, cacheKey } from "../../infra/redis/cache.js";
import type { KV } from "../../infra/redis/kv.js";
import { UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { nameTokens, normalizeName, trigramSimilarity } from "../../lib/text/normalize.js";
import { ensureMember, type Executor, type MemberRef } from "../economy/service.js";

const log = childLogger("wishlist:service");

/** Maximo de entradas (desejos comuns + estelares) por membro e servidor. */
export const WISH_LIMIT = 10;
/** Maximo de Desejos Estelares dentro da lista. */
export const STARWISH_LIMIT = 3;
/** Itens por pagina em `$wl` / `/wish list`. */
export const WISHLIST_PAGE_SIZE = 10;
/** Limite do Discord para opcoes de autocomplete. */
export const AUTOCOMPLETE_LIMIT = 25;
export const AUTOCOMPLETE_CACHE_MS = 60_000;
/** Menos que isto no autocomplete mostra as entidades mais populares em vez de buscar. */
export const MIN_SEARCH_CHARS = 2;
const MAX_SEARCH_TOKENS = 6;

// ---------------------------------------------------------------------------
// Referencias de entidade (valor das opcoes de autocomplete)
// ---------------------------------------------------------------------------

export type EntityRef = { kind: "id"; id: number } | { kind: "text"; text: string };

const ENTITY_ID_RE = /^id:(\d{1,15})$/;

/** Valor enviado pelo autocomplete: `id:<entityId>`. */
export function entityRefValue(entityId: number): string {
  return `id:${entityId}`;
}

/** `id:123` aponta uma entidade exata; qualquer outro texto e busca por nome. */
export function parseEntityRef(raw: string): EntityRef {
  const text = raw.trim();
  const match = ENTITY_ID_RE.exec(text);
  if (match) return { kind: "id", id: Number(match[1]) };
  return { kind: "text", text };
}

export interface SearchTerms {
  /** Tokens normalizados em ordem alfabetica (mesma forma de `entities.name_normalized`). */
  key: string;
  tokens: string[];
}

export function searchTerms(query: string): SearchTerms {
  const tokens = nameTokens(query).slice(0, MAX_SEARCH_TOKENS);
  return { key: tokens.join(" "), tokens };
}

// ---------------------------------------------------------------------------
// Busca de entidades
// ---------------------------------------------------------------------------

export interface EntityHit {
  id: number;
  name: string;
  /** Titulo da serie primaria, quando houver. */
  seriesTitle: string | null;
  baseAether: number;
}

export interface SearchEntitiesOptions {
  allowAdult?: boolean;
  /** 1..25 (padrao 25). */
  limit?: number;
  /** Consulta curta (< 2 caracteres): devolve as mais populares em vez de buscar (autocomplete). */
  popularWhenShort?: boolean;
  exec?: Executor;
}

const entityColumns = {
  id: entities.id,
  name: entities.name,
  seriesTitle: series.title,
  baseAether: entities.baseAether,
};

/**
 * Entidades ACTIVE cujo nome combina com `query`, melhores primeiro (igualdade exata, similaridade,
 * popularidade). Adultas so entram com `allowAdult`.
 */
export async function searchEntities(
  query: string,
  opts: SearchEntitiesOptions = {}
): Promise<EntityHit[]> {
  const exec = opts.exec ?? db;
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? AUTOCOMPLETE_LIMIT)), AUTOCOMPLETE_LIMIT);
  const { key, tokens } = searchTerms(query);

  const filters: SQL[] = [eq(entities.status, "ACTIVE")];
  if (!opts.allowAdult) filters.push(eq(entities.isAdult, false));

  const base = () =>
    exec
      .select(entityColumns)
      .from(entities)
      .leftJoin(
        entitySeries,
        and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
      )
      .leftJoin(series, eq(series.id, entitySeries.seriesId));

  if (key.length < MIN_SEARCH_CHARS && opts.popularWhenShort) {
    return base()
      .where(and(...filters))
      .orderBy(desc(entities.popularityScore), asc(entities.id))
      .limit(limit);
  }
  if (tokens.length === 0) return [];

  // `%` (similaridade do texto todo) e `<%` (similaridade com um trecho do nome) cobrem erros de
  // digitacao; os `LIKE` por token cobrem digitacao parcial. Os tres usam o indice GIN trigram.
  const tokenMatches = tokens.map((tok) => sql`${entities.nameNormalized} LIKE ${`%${tok}%`}`);
  const textMatch = sql`(${entities.nameNormalized} % ${key} OR ${key} <% ${entities.nameNormalized} OR (${sql.join(tokenMatches, sql` AND `)}))`;
  const score = sql`GREATEST(similarity(${entities.nameNormalized}, ${key}), word_similarity(${key}, ${entities.nameNormalized}))`;

  return base()
    .where(and(...filters, textMatch))
    .orderBy(
      sql`(${entities.nameNormalized} = ${key}) DESC`,
      sql`${score} DESC`,
      desc(entities.popularityScore),
      asc(entities.id)
    )
    .limit(limit);
}

/** Entidade ACTIVE por id (respeita o filtro de conteudo adulto). */
export async function getActiveEntity(
  entityId: number,
  opts: { allowAdult?: boolean; exec?: Executor } = {}
): Promise<EntityHit | null> {
  const exec = opts.exec ?? db;
  const filters: SQL[] = [eq(entities.id, entityId), eq(entities.status, "ACTIVE")];
  if (!opts.allowAdult) filters.push(eq(entities.isAdult, false));
  const [row] = await exec
    .select(entityColumns)
    .from(entities)
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .where(and(...filters))
    .limit(1);
  return row ?? null;
}

/** Resolve o texto do usuario (`id:N` do autocomplete ou nome) para uma entidade, ou `null`. */
export async function resolveEntity(
  raw: string,
  opts: { allowAdult?: boolean; exec?: Executor } = {}
): Promise<EntityHit | null> {
  const ref = parseEntityRef(raw);
  if (ref.kind === "id") return getActiveEntity(ref.id, opts);
  const [best] = await searchEntities(ref.text, { ...opts, limit: 1 });
  return best ?? null;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface AutocompleteDeps {
  search?: typeof searchEntities;
}

/** Guilda aceita conteudo adulto? Cache de 60 s no KV (o autocomplete nao passa pelo guildConfig). */
export async function guildAllowsAdult(kv: KV, guildId: string): Promise<boolean> {
  try {
    return await cacheGetOrSet(kv, cacheKey("ac", "adult", guildId), AUTOCOMPLETE_CACHE_MS, async () => {
      const [row] = await db
        .select({ allowAdult: guilds.allowAdult })
        .from(guilds)
        .where(eq(guilds.id, guildId))
        .limit(1);
      return row?.allowAdult ?? false;
    });
  } catch (err) {
    log.warn({ err, guildId }, "falha ao ler allow_adult para o autocomplete");
    return false;
  }
}

/** Autocomplete de entidades do catalogo; mesmo resultado por 60 s para a mesma consulta normalizada. */
export async function autocompleteEntities(
  kv: KV,
  query: string,
  allowAdult: boolean,
  deps: AutocompleteDeps = {}
): Promise<EntityHit[]> {
  const search = deps.search ?? searchEntities;
  const { key } = searchTerms(query);
  const load = () =>
    search(query, { allowAdult, limit: AUTOCOMPLETE_LIMIT, popularWhenShort: true });
  try {
    return await cacheGetOrSet(
      kv,
      cacheKey("ac", "entity", allowAdult ? "a" : "n", key),
      AUTOCOMPLETE_CACHE_MS,
      load
    );
  } catch (err) {
    // KV fora do ar nao pode derrubar o autocomplete: busca direto.
    log.warn({ err }, "cache do autocomplete indisponivel; consultando o banco");
    return load();
  }
}

// ---------------------------------------------------------------------------
// Lista de desejos
// ---------------------------------------------------------------------------

export interface WishEntry {
  entityId: number;
  name: string;
  seriesTitle: string | null;
  franchiseName: string | null;
  baseAether: number;
  isStarwish: boolean;
  createdAt: Date;
}

/** Desejos do membro: Desejos Estelares primeiro, depois do mais antigo ao mais novo. */
export async function listWishes(
  guildId: string,
  userId: string,
  exec: Executor = db
): Promise<WishEntry[]> {
  return exec
    .select({
      entityId: wishes.entityId,
      name: entities.name,
      seriesTitle: series.title,
      franchiseName: franchises.name,
      baseAether: entities.baseAether,
      isStarwish: wishes.isStarwish,
      createdAt: wishes.createdAt,
    })
    .from(wishes)
    .innerJoin(entities, eq(entities.id, wishes.entityId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .where(and(eq(wishes.guildId, guildId), eq(wishes.userId, userId)))
    .orderBy(desc(wishes.isStarwish), asc(wishes.createdAt), asc(entities.name));
}

/**
 * Melhor correspondencia por nome dentro de uma lista pequena: igualdade de tokens primeiro; depois
 * entre os que contem todos os tokens digitados, a de maior similaridade de trigramas.
 */
export function matchByName<T>(
  items: readonly T[],
  query: string,
  nameOf: (item: T) => string
): T | undefined {
  const tokens = nameTokens(query);
  if (tokens.length === 0) return undefined;
  const key = tokens.join(" ");
  let best: T | undefined;
  let bestScore = -1;
  for (const item of items) {
    const name = nameOf(item);
    if (nameTokens(name).join(" ") === key) return item;
    const normalized = normalizeName(name);
    if (!tokens.every((tok) => normalized.includes(tok))) continue;
    const score = trigramSimilarity(name, query);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** Entrada da lista do membro que corresponde a `raw` (`id:N` ou nome). */
export function findWishEntry(entries: readonly WishEntry[], raw: string): WishEntry | undefined {
  const ref = parseEntityRef(raw);
  if (ref.kind === "id") return entries.find((e) => e.entityId === ref.id);
  return matchByName(entries, ref.text, (e) => e.name);
}

/** Autocomplete de `/wish remove`: so o que ja esta na lista do membro. */
export async function autocompleteWishes(
  guildId: string,
  userId: string,
  query: string
): Promise<EntityHit[]> {
  const entries = await listWishes(guildId, userId);
  const tokens = nameTokens(query);
  return entries
    .filter((e) => {
      if (tokens.length === 0) return true;
      const normalized = normalizeName(e.name);
      return tokens.every((tok) => normalized.includes(tok));
    })
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((e) => ({
      id: e.entityId,
      name: e.name,
      seriesTitle: e.seriesTitle ?? e.franchiseName,
      baseAether: e.baseAether,
    }));
}

export type WishStatus = "added" | "upgraded" | "exists" | "removed";

export interface WishResult {
  status: WishStatus;
  /** Estado final do desejo (ou o que foi removido). */
  isStarwish: boolean;
  /** Quantidade de entradas apos a operacao. */
  total: number;
}

export interface ApplyWishOptions {
  starwish?: boolean;
  /** `toggle`: desejo existente e removido (legado de `$wish nome`); `add`: nunca remove. */
  mode: "add" | "toggle";
}

/**
 * Adiciona, promove a Desejo Estelar ou (em `toggle`) remove, tudo em uma transacao com o membro
 * travado, de modo que `WISH_LIMIT` e `STARWISH_LIMIT` valem sob concorrencia.
 * Lanca `UserError` `wishlist.limit_reached` / `wishlist.starwish_limit_reached`.
 */
export async function applyWish(
  ref: MemberRef,
  entityId: number,
  opts: ApplyWishOptions
): Promise<WishResult> {
  const starwish = opts.starwish === true;
  return db.transaction(async (tx) => {
    await ensureMember(tx, ref);
    await tx
      .select({ userId: guildMembers.userId })
      .from(guildMembers)
      .where(and(eq(guildMembers.guildId, ref.guildId), eq(guildMembers.userId, ref.userId)))
      .for("update");

    const rows = await tx
      .select({ entityId: wishes.entityId, isStarwish: wishes.isStarwish })
      .from(wishes)
      .where(and(eq(wishes.guildId, ref.guildId), eq(wishes.userId, ref.userId)));
    const total = rows.length;
    const stars = rows.filter((r) => r.isStarwish).length;
    const existing = rows.find((r) => r.entityId === entityId);
    const key = and(
      eq(wishes.guildId, ref.guildId),
      eq(wishes.userId, ref.userId),
      eq(wishes.entityId, entityId)
    );

    if (existing) {
      if (starwish && !existing.isStarwish) {
        if (stars >= STARWISH_LIMIT) {
          throw new UserError("wishlist.starwish_limit_reached", { max: STARWISH_LIMIT });
        }
        await tx.update(wishes).set({ isStarwish: true }).where(key);
        return { status: "upgraded", isStarwish: true, total };
      }
      if (opts.mode === "toggle") {
        await tx.delete(wishes).where(key);
        return { status: "removed", isStarwish: existing.isStarwish, total: total - 1 };
      }
      return { status: "exists", isStarwish: existing.isStarwish, total };
    }

    if (total >= WISH_LIMIT) throw new UserError("wishlist.limit_reached", { max: WISH_LIMIT });
    if (starwish && stars >= STARWISH_LIMIT) {
      throw new UserError("wishlist.starwish_limit_reached", { max: STARWISH_LIMIT });
    }
    await tx.insert(wishes).values({
      guildId: ref.guildId,
      userId: ref.userId,
      entityId,
      isStarwish: starwish,
    });
    return { status: "added", isStarwish: starwish, total: total + 1 };
  });
}

export const addWish = (ref: MemberRef, entityId: number, opts: { starwish?: boolean } = {}) =>
  applyWish(ref, entityId, { ...opts, mode: "add" });

export const toggleWish = (ref: MemberRef, entityId: number, opts: { starwish?: boolean } = {}) =>
  applyWish(ref, entityId, { ...opts, mode: "toggle" });

/** Remove o desejo. `true` se existia. */
export async function removeWish(
  guildId: string,
  userId: string,
  entityId: number
): Promise<boolean> {
  const rows = await db
    .delete(wishes)
    .where(
      and(eq(wishes.guildId, guildId), eq(wishes.userId, userId), eq(wishes.entityId, entityId))
    )
    .returning({ entityId: wishes.entityId });
  return rows.length > 0;
}
