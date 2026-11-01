import { and, eq, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { RECENT_ROLLS_KEEP, ROLL_REJECTION_ATTEMPTS } from "../../config/gacha.js";
import { db } from "../../infra/db/client.js";
import {
  disabledSeries,
  entities,
  entityImages,
  entitySeries,
  guilds,
  pacts,
  releaseWindows,
  series,
  users,
} from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import type { KV } from "../../infra/redis/kv.js";
import { childLogger } from "../../lib/logger.js";
import {
  getPool,
  pickFromPool,
  type Rejector,
  type RollFilter,
} from "./pool.js";
import { calculateAetherValue, rollVariant, type Rng } from "./variants.js";

export { calculateAetherValue, rollVariant };
export type { Rng };
export type { RollFilter };

const log = childLogger("summon:roll");

/** TTL curto dos caches de series desativadas e flags de guild. */
const DISABLED_CACHE_MS = 30_000;
const GUILD_FLAGS_CACHE_MS = 30_000;
const RECENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Quantas vezes refazer o sorteio quando a entidade escolhida ja nao esta ACTIVE (pool defasado). */
const STALE_RETRIES = 3;

export const recentKey = (guildId: string) => `roll:recent:${guildId}`;
export const disabledServerKey = (guildId: string) => `disabled:srv:${guildId}`;
export const disabledUserKey = (guildId: string, userId: string) =>
  `disabled:usr:${guildId}:${userId}`;

// ---------------------------------------------------------------------------
// Rejeicao
// ---------------------------------------------------------------------------

export interface RejectionRules {
  /** Ids sorteados recentemente na guild. */
  recent: ReadonlySet<number>;
  disabledSeries: ReadonlySet<number>;
  disabledFranchises: ReadonlySet<number>;
  /** guilds.allow_adult. */
  allowAdult: boolean;
}

/** Monta o predicado de rejeicao do sorteio (serie/franquia desativada, recente, adulto). */
export function buildRejector(rules: RejectionRules): Rejector {
  return (id, seriesId, franchiseId, adult) =>
    rules.recent.has(id) ||
    (adult && !rules.allowAdult) ||
    (seriesId !== 0 && rules.disabledSeries.has(seriesId)) ||
    (franchiseId !== 0 && rules.disabledFranchises.has(franchiseId));
}

export interface DisabledSet {
  series: number[];
  franchises: number[];
}

async function kvGetJson<T>(kv: KV | null, key: string): Promise<T | null> {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    log.warn({ err, key }, "falha ao ler cache no KV");
    return null;
  }
}

async function kvSetJson(kv: KV | null, key: string, value: unknown): Promise<void> {
  if (!kv) return;
  try {
    await kv.set(key, JSON.stringify(value), { px: DISABLED_CACHE_MS });
  } catch (err) {
    log.warn({ err, key }, "falha ao gravar cache no KV");
  }
}

async function queryDisabled(where: SQL | undefined): Promise<DisabledSet> {
  const rows = await db
    .select({ seriesId: disabledSeries.seriesId, franchiseId: disabledSeries.franchiseId })
    .from(disabledSeries)
    .where(where);
  const out: DisabledSet = { series: [], franchises: [] };
  for (const r of rows) {
    if (r.seriesId !== null) out.series.push(r.seriesId);
    if (r.franchiseId !== null) out.franchises.push(r.franchiseId);
  }
  return out;
}

async function cachedDisabled(
  kv: KV | null,
  key: string,
  where: SQL | undefined
): Promise<DisabledSet> {
  const hit = await kvGetJson<DisabledSet>(kv, key);
  if (hit) return hit;
  const fresh = await queryDisabled(where);
  await kvSetJson(kv, key, fresh);
  return fresh;
}

/** Series/franquias desativadas pelo usuario e pelo servidor (cache KV de 30 s). */
export async function loadDisabledSets(
  kv: KV | null,
  guildId: string,
  userId: string
): Promise<DisabledSet> {
  const [server, user] = await Promise.all([
    cachedDisabled(
      kv,
      disabledServerKey(guildId),
      and(eq(disabledSeries.guildId, guildId), eq(disabledSeries.isServerWide, true))
    ),
    cachedDisabled(
      kv,
      disabledUserKey(guildId, userId),
      and(
        eq(disabledSeries.guildId, guildId),
        eq(disabledSeries.userId, userId),
        eq(disabledSeries.isServerWide, false)
      )
    ),
  ]);
  return {
    series: [...server.series, ...user.series],
    franchises: [...server.franchises, ...user.franchises],
  };
}

/**
 * Invalida o cache de desativadas apos $disable/$enable. `userId` omitido invalida so o conjunto
 * do servidor (alteracao server-wide); usuarios novos so enxergam a mudanca apos o TTL de 30 s.
 */
export async function invalidateDisabledCache(guildId: string, userId?: string): Promise<void> {
  try {
    const kv = await getKV();
    const keys = [disabledServerKey(guildId)];
    if (userId) keys.push(disabledUserKey(guildId, userId));
    await kv.del(...keys);
  } catch (err) {
    log.warn({ err, guildId }, "falha ao invalidar cache de series desativadas");
  }
}

async function loadRecent(kv: KV | null, guildId: string): Promise<Set<number>> {
  if (!kv) return new Set();
  try {
    const raw = await kv.lrange(recentKey(guildId), 0, RECENT_ROLLS_KEEP - 1);
    return new Set(raw.map(Number).filter(Number.isFinite));
  } catch (err) {
    log.warn({ err, guildId }, "falha ao ler historico recente");
    return new Set();
  }
}

async function rememberRecent(kv: KV | null, guildId: string, entityId: number): Promise<void> {
  if (!kv) return;
  const key = recentKey(guildId);
  try {
    await kv.lpush(key, String(entityId));
    await kv.ltrim(key, 0, RECENT_ROLLS_KEEP - 1);
    await kv.pexpire(key, RECENT_TTL_MS);
  } catch (err) {
    log.warn({ err, guildId }, "falha ao gravar historico recente");
  }
}

// ---------------------------------------------------------------------------
// Flags da guild
// ---------------------------------------------------------------------------

interface GuildRollFlags {
  releaseBoostEnabled: boolean;
  allowAdult: boolean;
}

const flagsCache = new Map<string, { at: number; flags: GuildRollFlags }>();

export function invalidateGuildRollFlags(guildId: string): void {
  flagsCache.delete(guildId);
}

async function loadGuildFlags(guildId: string, now: number): Promise<GuildRollFlags> {
  const hit = flagsCache.get(guildId);
  if (hit && now - hit.at < GUILD_FLAGS_CACHE_MS) return hit.flags;
  const [row] = await db
    .select({ releaseBoostEnabled: guilds.releaseBoostEnabled, allowAdult: guilds.allowAdult })
    .from(guilds)
    .where(eq(guilds.id, guildId))
    .limit(1);
  const flags = row ?? { releaseBoostEnabled: true, allowAdult: false };
  flagsCache.set(guildId, { at: now, flags });
  return flags;
}

// ---------------------------------------------------------------------------
// Fallback SQL
// ---------------------------------------------------------------------------

/** Exportado para testes de integracao do fallback. */
export interface FallbackRules {
  filter: RollFilter;
  boostEnabled: boolean;
  allowAdult: boolean;
  now: number;
  excludeIds: ReadonlySet<number>;
  disabled: DisabledSet;
}

/**
 * Sorteio ponderado no banco (Efraimidis-Spirakis): o menor `-ln(U)/w` tem probabilidade
 * proporcional a w. Usa `1 - random()` para nunca chamar ln(0). Aplica as mesmas regras do
 * sorteio em memoria, inclusive o boost de lancamento.
 */
export async function fallbackPick(rules: FallbackRules): Promise<number | null> {
  const { filter, disabled } = rules;
  const franchiseOf = sql`coalesce(${series.franchiseId}, ${entities.franchiseId})`;
  const nowSec = rules.now / 1000;

  const boostExpr = rules.boostEnabled
    ? sql`coalesce(
        case when ${releaseWindows.startsAt} <= to_timestamp(${nowSec})
              and ${releaseWindows.endsAt} > to_timestamp(${nowSec})
          then 1 + (${releaseWindows.boost} - 1)
               * extract(epoch from (${releaseWindows.endsAt} - to_timestamp(${nowSec})))
               / extract(epoch from (${releaseWindows.endsAt} - ${releaseWindows.startsAt}))
        end, 1)`
    : sql`1`;

  const conditions: (SQL | undefined)[] = [
    eq(entities.status, "ACTIVE"),
    sql`${entities.gender} <> 'UNKNOWN'`,
    sql`${entities.rollWeight} > 0`,
  ];
  if (filter.universe) conditions.push(eq(entities.universe, filter.universe));
  if (filter.type) conditions.push(eq(entities.type, filter.type));
  if (filter.gender === "FEMALE" || filter.gender === "MALE") {
    conditions.push(eq(entities.gender, filter.gender));
  }
  if (!rules.allowAdult) conditions.push(eq(entities.isAdult, false));
  if (rules.excludeIds.size > 0) conditions.push(notInArray(entities.id, [...rules.excludeIds]));
  if (disabled.series.length > 0) {
    conditions.push(
      or(isNull(entitySeries.seriesId), notInArray(entitySeries.seriesId, disabled.series))
    );
  }
  if (disabled.franchises.length > 0) {
    conditions.push(sql`(${franchiseOf} is null or ${franchiseOf} not in ${disabled.franchises})`);
  }

  const [row] = await db
    .select({ id: entities.id })
    .from(entities)
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(
      releaseWindows,
      and(eq(releaseWindows.seriesId, entitySeries.seriesId), isNull(releaseWindows.closedAt))
    )
    .where(and(...conditions))
    .orderBy(sql`-ln(1 - random()) / (${entities.rollWeight} * ${boostExpr})`)
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Resultado do roll
// ---------------------------------------------------------------------------

export interface RolledPact {
  id: number;
  userId: string;
  variant: "STANDARD" | "FOIL" | "HOLO" | "ASTRAL";
  awakeningKeys: number;
  /** users.username do dono; null se o usuario nao tiver nome. */
  ownerName: string | null;
}

export interface RolledEntity {
  id: number;
  slug: string;
  name: string;
  nameNative: string | null;
  universe: "ANIME" | "GAME" | "CINEMA";
  type: "CHARACTER" | "WEAPON" | "COMPANION" | "DOMAIN";
  gender: "FEMALE" | "MALE" | "NONBINARY" | "ITEM" | "UNKNOWN";
  tier: "COMMON" | "RARE" | "EPIC" | "LEGENDARY" | "MYTHIC";
  /** Edicao da carta (BASIC/EPIC/MYTHIC); null = carta comum. */
  edition?: "BASIC" | "EPIC" | "MYTHIC" | null;
  description: string | null;
  isAdult: boolean;
  baseAether: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  baseHp: number;
  popularityRank: number | null;
  likeRank: number | null;
  claimRank: number | null;
  likesCount: number;
  claimsCount: number;
  /** Imagem primaria (sempre ACTIVE, por CHECK); null se a entidade nao tiver. */
  imageUrl: string | null;
  seriesId: number | null;
  seriesTitle: string | null;
  franchiseId: number | null;
  /** Pacto existente neste servidor, se houver. */
  pact: RolledPact | null;
}

/**
 * UMA query: entidade + imagem primaria + serie primaria + dono do pacto no servidor.
 * Exige status ACTIVE: se o pool estiver defasado e a entidade tiver saido do ar, devolve null.
 */
async function fetchRolled(guildId: string, entityId: number): Promise<RolledEntity | null> {
  const [r] = await db
    .select({
      id: entities.id,
      slug: entities.slug,
      name: entities.name,
      nameNative: entities.nameNative,
      universe: entities.universe,
      type: entities.type,
      gender: entities.gender,
      tier: entities.tier,
      edition: entities.edition,
      description: entities.description,
      isAdult: entities.isAdult,
      baseAether: entities.baseAether,
      baseAtk: entities.baseAtk,
      baseDef: entities.baseDef,
      baseSpd: entities.baseSpd,
      baseHp: entities.baseHp,
      popularityRank: entities.popularityRank,
      likeRank: entities.likeRank,
      claimRank: entities.claimRank,
      likesCount: entities.likesCount,
      claimsCount: entities.claimsCount,
      entityFranchiseId: entities.franchiseId,
      imageUrl: entityImages.url,
      seriesId: series.id,
      seriesTitle: series.title,
      seriesFranchiseId: series.franchiseId,
      pactId: pacts.id,
      pactUserId: pacts.userId,
      pactVariant: pacts.variant,
      pactKeys: pacts.awakeningKeys,
      ownerName: users.username,
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
    .leftJoin(pacts, and(eq(pacts.entityId, entities.id), eq(pacts.guildId, guildId)))
    .leftJoin(users, eq(users.id, pacts.userId))
    .where(and(eq(entities.id, entityId), eq(entities.status, "ACTIVE")))
    .limit(1);
  if (!r) return null;

  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    nameNative: r.nameNative,
    universe: r.universe,
    type: r.type,
    gender: r.gender,
    tier: r.tier,
    edition: (r.edition as "BASIC" | "EPIC" | "MYTHIC" | null) ?? null,
    description: r.description,
    isAdult: r.isAdult,
    baseAether: r.baseAether,
    baseAtk: r.baseAtk,
    baseDef: r.baseDef,
    baseSpd: r.baseSpd,
    baseHp: r.baseHp,
    popularityRank: r.popularityRank,
    likeRank: r.likeRank,
    claimRank: r.claimRank,
    likesCount: r.likesCount,
    claimsCount: r.claimsCount,
    imageUrl: r.imageUrl,
    seriesId: r.seriesId,
    seriesTitle: r.seriesTitle,
    franchiseId: r.seriesFranchiseId ?? r.entityFranchiseId,
    pact:
      r.pactId !== null && r.pactUserId !== null
        ? {
            id: r.pactId,
            userId: r.pactUserId,
            variant: r.pactVariant ?? "STANDARD",
            awakeningKeys: r.pactKeys ?? 0,
            ownerName: r.ownerName,
          }
        : null,
  };
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

export interface RollParams {
  guildId: string;
  userId: string;
  filter?: RollFilter;
  /** Injetavel (seed) para testes; padrao Math.random. */
  rng?: Rng;
  /** Epoch ms; padrao Date.now(). Afeta so o boost de lancamento. */
  now?: number;
  /** Omitidos = lidos de guilds (cache de 30 s). */
  releaseBoost?: boolean;
  allowAdult?: boolean;
}

/**
 * Sorteia uma entidade para a guild/usuario.
 *
 * 1. Sorteio ponderado em memoria (busca binaria) com rejeicao: series/franquias desativadas do
 *    usuario e do servidor, recentes da guild, adulto sem permissao. ROLL_REJECTION_ATTEMPTS tentativas.
 * 2. Esgotadas, fallback SQL ponderado com as mesmas regras; se nada restar, tenta de novo sem o
 *    filtro de recentes (pool pequeno), mantendo as regras duras.
 * 3. Uma query traz entidade + imagem + serie + dono do pacto. Nunca devolve entidade fora de ACTIVE.
 *
 * Retorna null se nao houver nenhuma entidade elegivel.
 */
export async function rollEntity(params: RollParams): Promise<RolledEntity | null> {
  const { guildId, userId } = params;
  const rng = params.rng ?? Math.random;
  const now = params.now ?? Date.now();
  const filter = params.filter ?? {};

  let kv: KV | null = null;
  try {
    kv = await getKV();
  } catch (err) {
    log.warn({ err }, "KV indisponivel; sorteio sem historico recente nem cache");
  }

  const [pool, flags, disabled, recent] = await Promise.all([
    getPool(),
    params.releaseBoost !== undefined && params.allowAdult !== undefined
      ? Promise.resolve({
          releaseBoostEnabled: params.releaseBoost,
          allowAdult: params.allowAdult,
        })
      : loadGuildFlags(guildId, now).then((f) => ({
          releaseBoostEnabled: params.releaseBoost ?? f.releaseBoostEnabled,
          allowAdult: params.allowAdult ?? f.allowAdult,
        })),
    loadDisabledSets(kv, guildId, userId),
    loadRecent(kv, guildId),
  ]);

  const rules: RejectionRules = {
    recent,
    disabledSeries: new Set(disabled.series),
    disabledFranchises: new Set(disabled.franchises),
    allowAdult: flags.allowAdult,
  };
  const stale = new Set<number>(); // ids sorteados que ja nao estao ACTIVE

  for (let round = 0; round < STALE_RETRIES; round++) {
    const reject = buildRejector(rules);
    let id = pickFromPool(pool, filter, {
      rng,
      now,
      boostEnabled: flags.releaseBoostEnabled,
      maxAttempts: ROLL_REJECTION_ATTEMPTS,
      isRejected: (eid, sid, fid, adult) => stale.has(eid) || reject(eid, sid, fid, adult),
    }).id;

    if (id === null) {
      const base = {
        filter,
        boostEnabled: flags.releaseBoostEnabled,
        allowAdult: flags.allowAdult,
        now,
        disabled,
      };
      id = await fallbackPick({ ...base, excludeIds: new Set([...recent, ...stale]) });
      id ??= await fallbackPick({ ...base, excludeIds: stale });
    }
    if (id === null) return null;

    const rolled = await fetchRolled(guildId, id);
    if (rolled) {
      await rememberRecent(kv, guildId, rolled.id);
      return rolled;
    }
    stale.add(id);
    log.debug({ entityId: id }, "entidade do pool ja nao esta ACTIVE; sorteando de novo");
  }
  return null;
}
