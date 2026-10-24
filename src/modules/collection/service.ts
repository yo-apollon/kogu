/**
 * Servico do Panteao: listagem paginada, busca de entidades, lideranca, doacao, notas/apelidos e
 * dissolucao. Somente banco (sem discord.js). Hot path: selects por coluna, ordenacao e contagem no
 * SQL, buscas por indice (pg_trgm), nunca a tabela inteira em memoria.
 */
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  type CardVariant,
  type EntityTier,
} from "../../config/gacha.js";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entityImages,
  entitySeries,
  franchises,
  guildMembers,
  pacts,
  series,
  users,
} from "../../infra/db/schema/index.js";
import { cacheGetOrSet, cacheKey } from "../../infra/redis/cache.js";
import type { KV } from "../../infra/redis/kv.js";
import { UserError } from "../../lib/errors.js";
import {
  pactValueSql,
  pantheonConditions,
  pantheonOrder,
  SOULMATE_KEYS,
  tokensMatch,
} from "../../shared/pantheon.js";
import { escapeLike, nameTokens } from "../../shared/text.js";
import { dissolvePact, ensureMember, type DissolveResult } from "../economy/service.js";
import type { PantheonQuery } from "./flags.js";

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 10;
/** Limite do Discord para choices de autocomplete. */
export const AUTOCOMPLETE_LIMIT = 25;
export const AUTOCOMPLETE_TTL_MS = 60_000;
// Fonte unica em src/shared (copiada para a dashboard); reexportado por compatibilidade.
export { escapeLike, pactValueSql, SOULMATE_KEYS };

export const NOTE_MAX_LENGTH = 200;
export const ALIAS_MAX_LENGTH = 40;
export type EntityRef =
  { kind: "id"; id: number } | { kind: "pact"; id: number } | { kind: "name"; text: string };

/**
 * Referencia vinda do autocomplete (`id:<entidade>`, `pact:<pacto>`) ou nome digitado.
 * Valores de choice de autocomplete chegam como texto, entao o prefixo evita confundir com nomes.
 */
export function parseRef(raw: string): EntityRef {
  const text = raw.trim();
  const m = /^(id|pact):(\d{1,15})$/i.exec(text);
  if (m) return { kind: m[1].toLowerCase() === "id" ? "id" : "pact", id: Number(m[2]) };
  return { kind: "name", text };
}

// ---------------------------------------------------------------------------
// Listagem do Panteao
// ---------------------------------------------------------------------------

export interface PantheonRow {
  pactId: number;
  entityId: number;
  name: string;
  gender: string;
  tier: EntityTier;
  variant: CardVariant;
  awakeningKeys: number;
  isSoulmate: boolean;
  alias: string | null;
  alias2: string | null;
  baseAether: number;
  claimRank: number | null;
  likeRank: number | null;
  seriesTitle: string | null;
  /** max(valor atual, aether_at_bind). */
  value: number;
}

export interface PantheonPage {
  rows: PantheonRow[];
  /** Pactos que passam nos filtros. */
  total: number;
  /** Soma do valor atual dos pactos filtrados. */
  totalAether: number;
  /** Primeiro pacto na ordem padrao (lider), independente dos filtros. */
  leaderName: string | null;
}

/** Uma pagina do Panteao (page base 1) com os filtros/ordenacao; total e soma em outra query. */
export async function listPantheon(
  guildId: string,
  userId: string,
  query: PantheonQuery,
  page: number,
  pageSize: number = PAGE_SIZE
): Promise<PantheonPage> {
  const value = pactValueSql();
  const seriesName = sql<string | null>`coalesce(${series.title}, ${franchises.name})`;
  const where = pantheonConditions(guildId, userId, query);
  const safePage = Math.max(1, Math.floor(page));

  const [rows, [agg]] = await Promise.all([
    db
      .select({
        pactId: pacts.id,
        entityId: entities.id,
        name: entities.name,
        gender: entities.gender,
        tier: entities.tier,
        variant: pacts.variant,
        awakeningKeys: pacts.awakeningKeys,
        isSoulmate: pacts.isSoulmate,
        alias: pacts.alias,
        alias2: pacts.alias2,
        baseAether: entities.baseAether,
        claimRank: entities.claimRank,
        likeRank: entities.likeRank,
        seriesTitle: seriesName,
        value,
      })
      .from(pacts)
      .innerJoin(entities, eq(entities.id, pacts.entityId))
      .leftJoin(
        entitySeries,
        and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
      )
      .leftJoin(series, eq(series.id, entitySeries.seriesId))
      .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
      .where(where)
      .orderBy(...pantheonOrder(query.sort, value, seriesName))
      .limit(pageSize)
      .offset((safePage - 1) * pageSize),
    db
      .select({
        total: sql<number>`count(*)::int`,
        totalAether: sql<number>`coalesce(sum(${value}), 0)`.mapWith(Number),
        leaderName: sql<string | null>`(
          SELECT e2.name FROM pacts p2 JOIN entities e2 ON e2.id = p2.entity_id
          WHERE p2.guild_id = ${guildId} AND p2.user_id = ${userId}
          ORDER BY p2.sort_order, p2.bound_at, p2.id LIMIT 1)`,
      })
      .from(pacts)
      .innerJoin(entities, eq(entities.id, pacts.entityId))
      .leftJoin(
        entitySeries,
        and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
      )
      .leftJoin(series, eq(series.id, entitySeries.seriesId))
      .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
      .where(where),
  ]);

  return {
    rows,
    total: agg?.total ?? 0,
    totalAether: agg?.totalAether ?? 0,
    leaderName: agg?.leaderName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pactos do jogador (busca por nome/apelido)
// ---------------------------------------------------------------------------

export interface OwnPact {
  pactId: number;
  entityId: number;
  name: string;
  variant: CardVariant;
  awakeningKeys: number;
  aetherAtBind: number;
  baseAether: number;
  /** Valor atual: o mesmo que o dissolve devolve. */
  value: number;
}

/**
 * Pacto do jogador que casa com `raw`: `pact:<id>` / `id:<entidade>` (autocomplete) ou nome/apelido.
 * Ordem: nome exato, apelido exato, todos os tokens contidos, similaridade (trigram).
 * So considera pactos do proprio jogador (indice guild+user).
 */
export async function findOwnPact(
  guildId: string,
  userId: string,
  raw: string
): Promise<OwnPact | null> {
  const ref = parseRef(raw);
  const own = and(eq(pacts.guildId, guildId), eq(pacts.userId, userId))!;
  let where: SQL;
  let order: SQL[] = [asc(pacts.id)];

  if (ref.kind === "pact") {
    where = and(own, eq(pacts.id, ref.id))!;
  } else if (ref.kind === "id") {
    where = and(own, eq(pacts.entityId, ref.id))!;
  } else {
    const tokens = nameTokens(ref.text);
    if (tokens.length === 0) return null;
    const norm = tokens.join(" ");
    const aliasKey = ref.text.toLowerCase();
    const allTokens = tokensMatch(tokens);
    const aliasHit = sql`(lower(${pacts.alias}) = ${aliasKey} OR lower(${pacts.alias2}) = ${aliasKey})`;
    where = and(own, or(allTokens, aliasHit, sql`${entities.nameNormalized} % ${norm}`))!;
    order = [
      sql`CASE WHEN ${entities.nameNormalized} = ${norm} THEN 0 WHEN ${aliasHit} THEN 1 WHEN ${allTokens} THEN 2 ELSE 3 END`,
      sql`similarity(${entities.nameNormalized}, ${norm}) DESC`,
      asc(entities.name),
      asc(pacts.id),
    ];
  }

  const [row] = await db
    .select({
      pactId: pacts.id,
      entityId: entities.id,
      name: entities.name,
      variant: pacts.variant,
      awakeningKeys: pacts.awakeningKeys,
      aetherAtBind: pacts.aetherAtBind,
      baseAether: entities.baseAether,
      value: pactValueSql(),
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .where(where)
    .orderBy(...order)
    .limit(1);
  return row ?? null;
}

export interface OwnPactChoice {
  pactId: number;
  name: string;
  series: string | null;
}

/** Autocomplete dos pactos do jogador (sem cache: dados pessoais e consulta barata por indice). */
export async function searchOwnPacts(
  guildId: string,
  userId: string,
  raw: string,
  limit: number = AUTOCOMPLETE_LIMIT
): Promise<OwnPactChoice[]> {
  const tokens = nameTokens(raw.slice(0, 100));
  const conds: SQL[] = [eq(pacts.guildId, guildId), eq(pacts.userId, userId)];
  if (tokens.length > 0) {
    conds.push(or(tokensMatch(tokens), sql`${entities.nameNormalized} % ${tokens.join(" ")}`)!);
  }
  return db
    .select({
      pactId: pacts.id,
      name: entities.name,
      series: sql<string | null>`coalesce(${series.title}, ${franchises.name})`,
    })
    .from(pacts)
    .innerJoin(entities, eq(entities.id, pacts.entityId))
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .where(and(...conds))
    .orderBy(asc(pacts.sortOrder), asc(pacts.boundAt), asc(pacts.id))
    .limit(Math.min(limit, AUTOCOMPLETE_LIMIT));
}

// ---------------------------------------------------------------------------
// Lider, doacao, notas e dissolucao
// ---------------------------------------------------------------------------

export interface LeaderResult {
  pactId: number;
  entityId: number;
  sortOrder: number;
}

/**
 * $firstmarry: o pacto passa a ser o primeiro da ordem padrao (sort_order menor que o de todos os
 * outros do jogador). Um UPDATE so, ja filtrando por dono; se ja e o primeiro, nao muda nada.
 */
export async function setLeader(
  guildId: string,
  userId: string,
  pactId: number,
  label: string = String(pactId)
): Promise<LeaderResult> {
  const [row] = await db
    .update(pacts)
    .set({
      sortOrder: sql`LEAST(${pacts.sortOrder}, (
        SELECT MIN(p2.sort_order) - 1 FROM pacts p2
        WHERE p2.guild_id = ${guildId} AND p2.user_id = ${userId} AND p2.id <> ${pactId}))`,
    })
    .where(and(eq(pacts.id, pactId), eq(pacts.guildId, guildId), eq(pacts.userId, userId)))
    .returning({ pactId: pacts.id, entityId: pacts.entityId, sortOrder: pacts.sortOrder });
  if (!row) throw new UserError("errors.not_in_pantheon", { query: label });
  return row;
}

export interface GiveResult {
  pactId: number;
  entityId: number;
}

/**
 * $give: transfere o pacto `pactId` de `fromUserId` para `to`, em uma transacao. Garante a linha em
 * guild_members do destinatario (FK composta de pacts). Nao-dono => `errors.not_in_pantheon` e nada
 * muda (inclusive a criacao do destinatario). Personalizacoes do dono antigo (apelidos, nota, imagem,
 * cor) e a posicao de lider nao acompanham o pacto; selos, variante e valor sim.
 */
export async function giveEntity(input: {
  guildId: string;
  fromUserId: string;
  to: { id: string; username?: string };
  pactId: number;
  /** Nome exibido no erro de nao-dono. */
  label?: string;
}): Promise<GiveResult> {
  const { guildId, fromUserId, to, pactId } = input;
  if (to.id === fromUserId) throw new UserError("collection.give_self");
  return db.transaction(async (tx) => {
    await ensureMember(tx, { guildId, userId: to.id, username: to.username });
    const [moved] = await tx
      .update(pacts)
      .set({
        userId: to.id,
        sortOrder: 0,
        alias: null,
        alias2: null,
        note: null,
        customImage: null,
        embedColor: null,
      })
      .where(and(eq(pacts.id, pactId), eq(pacts.guildId, guildId), eq(pacts.userId, fromUserId)))
      .returning({ pactId: pacts.id, entityId: pacts.entityId });
    if (!moved) {
      throw new UserError("errors.not_in_pantheon", { query: input.label ?? String(pactId) });
    }
    return moved;
  });
}

export type PactTextField = "note" | "alias" | "alias2";

/** Grava nota/apelido; so o dono do pacto. Texto vazio limpa o campo. */
export async function setPactText(input: {
  guildId: string;
  userId: string;
  pactId: number;
  field: PactTextField;
  value: string;
  label?: string;
}): Promise<{ pactId: number; entityId: number }> {
  const value = input.value.trim();
  const max = input.field === "note" ? NOTE_MAX_LENGTH : ALIAS_MAX_LENGTH;
  if (Array.from(value).length > max) {
    throw new UserError("errors.invalid_argument", { arg: input.field });
  }
  const text = value === "" ? null : value;
  const patch =
    input.field === "note"
      ? { note: text }
      : input.field === "alias"
        ? { alias: text }
        : { alias2: text };
  const [row] = await db
    .update(pacts)
    .set(patch)
    .where(
      and(
        eq(pacts.id, input.pactId),
        eq(pacts.guildId, input.guildId),
        eq(pacts.userId, input.userId)
      )
    )
    .returning({ pactId: pacts.id, entityId: pacts.entityId });
  if (!row)
    throw new UserError("errors.not_in_pantheon", { query: input.label ?? String(input.pactId) });
  return row;
}

/** Dissolve o pacto do jogador (reembolso e saldo no economy); erro de nao-dono cita o nome. */
export async function dissolveOwnPact(
  guildId: string,
  userId: string,
  pact: Pick<OwnPact, "pactId" | "name">
): Promise<DissolveResult> {
  try {
    return await dissolvePact(guildId, userId, pact.pactId);
  } catch (err) {
    if (err instanceof UserError && err.key === "errors.not_in_pantheon") {
      throw new UserError(err.key, { query: pact.name });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Busca de entidades (info e autocomplete)
// ---------------------------------------------------------------------------

export interface EntityHit {
  id: number;
  name: string;
  series: string | null;
  gender: string;
  tier: EntityTier;
}

async function attachSeries(hits: Array<Omit<EntityHit, "series">>): Promise<EntityHit[]> {
  if (hits.length === 0) return [];
  const rows = await db
    .select({ entityId: entitySeries.entityId, title: series.title })
    .from(entitySeries)
    .innerJoin(series, eq(series.id, entitySeries.seriesId))
    .where(
      and(
        inArray(
          entitySeries.entityId,
          hits.map((h) => h.id)
        ),
        eq(entitySeries.isPrimary, true)
      )
    );
  const byEntity = new Map(rows.map((r) => [r.entityId, r.title]));
  return hits.map((h) => ({ ...h, series: byEntity.get(h.id) ?? null }));
}

/** Entidades ativas mais populares (autocomplete sem texto). */
export async function topEntities(limit: number = AUTOCOMPLETE_LIMIT): Promise<EntityHit[]> {
  const rows = await db
    .select({ id: entities.id, name: entities.name, gender: entities.gender, tier: entities.tier })
    .from(entities)
    .where(eq(entities.status, "ACTIVE"))
    .orderBy(desc(entities.popularityScore), asc(entities.id))
    .limit(limit);
  return attachSeries(rows);
}

/**
 * Busca por similaridade em `name_normalized` (tokens ordenados): todos os tokens contidos OU
 * trigram `%`. Ordem: nome exato, tokens contidos, similaridade, popularidade. LIMIT sempre.
 */
export async function searchEntities(
  raw: string,
  limit: number = AUTOCOMPLETE_LIMIT
): Promise<EntityHit[]> {
  const tokens = nameTokens(raw.slice(0, 100));
  const norm = tokens.join(" ");
  if (norm === "") return topEntities(limit);
  if (norm.length < 2) {
    // Um caractere ("L", "N"): so nome exato (btree), sem varredura por trigram.
    const exact = await db
      .select({
        id: entities.id,
        name: entities.name,
        gender: entities.gender,
        tier: entities.tier,
      })
      .from(entities)
      .where(and(eq(entities.status, "ACTIVE"), eq(entities.nameNormalized, norm)))
      .orderBy(desc(entities.popularityScore), asc(entities.id))
      .limit(Math.min(Math.max(1, limit), AUTOCOMPLETE_LIMIT));
    return attachSeries(exact);
  }

  const allTokens = tokensMatch(tokens);
  const similarity = sql<number>`similarity(${entities.nameNormalized}, ${norm})`;
  const rows = await db
    .select({ id: entities.id, name: entities.name, gender: entities.gender, tier: entities.tier })
    .from(entities)
    .where(
      and(eq(entities.status, "ACTIVE"), or(allTokens, sql`${entities.nameNormalized} % ${norm}`))
    )
    .orderBy(
      sql`CASE WHEN ${entities.nameNormalized} = ${norm} THEN 0 WHEN ${allTokens} THEN 1 ELSE 2 END`,
      desc(similarity),
      desc(entities.popularityScore),
      asc(entities.name),
      asc(entities.id)
    )
    .limit(Math.min(Math.max(1, limit), AUTOCOMPLETE_LIMIT));
  return attachSeries(rows);
}

/** Autocomplete com cache de 60 s no KV (chave pelo texto normalizado). */
export async function autocompleteEntities(kv: KV, raw: string): Promise<EntityHit[]> {
  const norm = nameTokens(raw.slice(0, 100)).join(" ");
  return cacheGetOrSet(kv, cacheKey("ac", "entity", norm || "_top"), AUTOCOMPLETE_TTL_MS, () =>
    searchEntities(norm, AUTOCOMPLETE_LIMIT)
  );
}

async function entityBySeriesTitle(text: string): Promise<number | null> {
  const needle = `%${escapeLike(text.trim())}%`;
  const [row] = await db
    .select({ id: entities.id })
    .from(series)
    .innerJoin(entitySeries, eq(entitySeries.seriesId, series.id))
    .innerJoin(entities, eq(entities.id, entitySeries.entityId))
    .where(and(sql`${series.title} ILIKE ${needle}`, eq(entities.status, "ACTIVE")))
    .orderBy(desc(entities.popularityScore), asc(entities.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Entidade para o $info: `id:<n>` (autocomplete), melhor nome por similaridade e, sem resultado,
 * a entidade mais popular de uma serie cujo titulo contenha o texto (comportamento do legado).
 */
export async function findEntityId(raw: string): Promise<number | null> {
  const ref = parseRef(raw);
  if (ref.kind === "id") {
    const [row] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.id, ref.id))
      .limit(1);
    return row?.id ?? null;
  }
  const text = ref.kind === "name" ? ref.text : raw.trim();
  const [hit] = await searchEntities(text, 1);
  if (hit) return hit.id;
  return text.length >= 3 ? entityBySeriesTitle(text) : null;
}

// ---------------------------------------------------------------------------
// Ficha da entidade ($info)
// ---------------------------------------------------------------------------

export interface EntityPactInfo {
  id: number;
  userId: string;
  ownerName: string | null;
  variant: CardVariant;
  awakeningKeys: number;
  aetherAtBind: number;
  note: string | null;
  alias: string | null;
  hasCustomImage: boolean;
  ownerEmbedColor: string | null;
  /** Posicao do pacto no Panteao do dono (ordem padrao), base 1. */
  position: number;
}

export interface EntityInfo {
  id: number;
  name: string;
  universe: "ANIME" | "GAME" | "CINEMA";
  gender: string;
  tier: EntityTier;
  baseAether: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  popularityRank: number | null;
  claimRank: number | null;
  likeRank: number | null;
  imageUrl: string | null;
  seriesTitle: string | null;
  pact: EntityPactInfo | null;
}

/** Entidade + imagem primaria + serie + pacto (dono) neste servidor, em uma query; posicao em outra. */
export async function getEntityInfo(guildId: string, entityId: number): Promise<EntityInfo | null> {
  const [r] = await db
    .select({
      id: entities.id,
      name: entities.name,
      universe: entities.universe,
      gender: entities.gender,
      tier: entities.tier,
      baseAether: entities.baseAether,
      baseAtk: entities.baseAtk,
      baseDef: entities.baseDef,
      baseSpd: entities.baseSpd,
      popularityRank: entities.popularityRank,
      claimRank: entities.claimRank,
      likeRank: entities.likeRank,
      imageUrl: entityImages.url,
      seriesTitle: sql<string | null>`coalesce(${series.title}, ${franchises.name})`,
      pactId: pacts.id,
      pactUserId: pacts.userId,
      pactVariant: pacts.variant,
      pactKeys: pacts.awakeningKeys,
      pactAetherAtBind: pacts.aetherAtBind,
      pactNote: pacts.note,
      pactAlias: pacts.alias,
      pactCustomImage: pacts.customImage,
      ownerName: users.username,
      ownerColor: guildMembers.embedColor,
    })
    .from(entities)
    .leftJoin(
      entityImages,
      and(eq(entityImages.entityId, entities.id), eq(entityImages.isPrimary, true))
    )
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(franchises, eq(franchises.id, entities.franchiseId))
    .leftJoin(pacts, and(eq(pacts.entityId, entities.id), eq(pacts.guildId, guildId)))
    .leftJoin(users, eq(users.id, pacts.userId))
    .leftJoin(
      guildMembers,
      and(eq(guildMembers.guildId, pacts.guildId), eq(guildMembers.userId, pacts.userId))
    )
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!r) return null;

  let pact: EntityPactInfo | null = null;
  if (r.pactId !== null && r.pactUserId !== null) {
    pact = {
      id: r.pactId,
      userId: r.pactUserId,
      ownerName: r.ownerName,
      variant: r.pactVariant ?? "STANDARD",
      awakeningKeys: r.pactKeys ?? 0,
      aetherAtBind: r.pactAetherAtBind ?? 0,
      note: r.pactNote,
      alias: r.pactAlias,
      hasCustomImage: Boolean(r.pactCustomImage),
      ownerEmbedColor: r.ownerColor,
      position: await pactPosition(r.pactId),
    };
  }

  return {
    id: r.id,
    name: r.name,
    universe: r.universe,
    gender: r.gender,
    tier: r.tier,
    baseAether: r.baseAether,
    baseAtk: r.baseAtk,
    baseDef: r.baseDef,
    baseSpd: r.baseSpd,
    popularityRank: r.popularityRank,
    claimRank: r.claimRank,
    likeRank: r.likeRank,
    imageUrl: r.imageUrl,
    seriesTitle: r.seriesTitle,
    pact,
  };
}

/** Posicao (base 1) do pacto na ordem padrao do Panteao do dono. */
export async function pactPosition(pactId: number): Promise<number> {
  const mine = alias(pacts, "mine");
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pacts)
    .innerJoin(
      mine,
      and(eq(mine.id, pactId), eq(pacts.guildId, mine.guildId), eq(pacts.userId, mine.userId))
    )
    .where(
      sql`(${pacts.sortOrder}, ${pacts.boundAt}, ${pacts.id}) <= (${mine.sortOrder}, ${mine.boundAt}, ${mine.id})`
    );
  return Math.max(1, row?.n ?? 1);
}
