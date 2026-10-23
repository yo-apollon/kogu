import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { POOL_REFRESH_MS } from "../../config/gacha.js";
import { db } from "../../infra/db/client.js";
import {
  entities,
  entitySeries,
  releaseWindows,
  series,
  type Entity,
} from "../../infra/db/schema/index.js";
import { getKV } from "../../infra/redis/client.js";
import { subscribeEvent } from "../../infra/redis/pubsub.js";
import { childLogger } from "../../lib/logger.js";
import type { Rng } from "./variants.js";

const log = childLogger("summon:pool");

export type Universe = Entity["universe"];
export type EntityType = Entity["type"];
/** UNKNOWN nunca entra no pool (vai para quarentena ate o catalogo confirmar o genero). */
export type PoolGender = Exclude<Entity["gender"], "UNKNOWN">;
/** Filtro de genero dos comandos: BOTH (ou omitido) = qualquer genero. */
export type GenderFilter = "FEMALE" | "MALE" | "BOTH";

export interface RollFilter {
  gender?: GenderFilter;
  universe?: Universe;
  type?: EntityType;
}

export interface ReleaseWindowInfo {
  /** Boost inicial; decai linearmente ate 1 em endsAt. */
  boost: number;
  /** Epoch ms. */
  startsAt: number;
  /** Epoch ms. */
  endsAt: number;
}

/** Linha crua do catalogo, ja reduzida as colunas do sorteio. */
export interface PoolRow {
  id: number;
  universe: Universe;
  gender: PoolGender;
  type: EntityType;
  /** Serie primaria; null = sem serie. */
  seriesId: number | null;
  franchiseId: number | null;
  adult: boolean;
  weight: number;
  window: ReleaseWindowInfo | null;
}

export interface BoostedItem extends ReleaseWindowInfo {
  /** Indice do item dentro do bucket. */
  index: number;
  /** roll_weight base do item. */
  weight: number;
}

/**
 * Bucket (universe x gender x type) em arrays tipados.
 * `cumulative[i]` = soma dos pesos base dos itens 0..i. Ids 0 em seriesIds/franchiseIds = ausente
 * (identity comeca em 1).
 */
export interface Bucket {
  key: string;
  universe: Universe;
  gender: PoolGender;
  type: EntityType;
  size: number;
  ids: Float64Array;
  seriesIds: Float64Array;
  franchiseIds: Float64Array;
  adult: Uint8Array;
  cumulative: Float64Array;
  total: number;
  /** Itens sob janela de lancamento; o boost e aplicado no sorteio, por guild. */
  boosted: BoostedItem[];
}

export interface Pool {
  /** Epoch ms do carregamento. */
  loadedAt: number;
  size: number;
  buckets: Bucket[];
  /** Cache de buckets por filtro (o pool e imutavel depois de construido). */
  viewCache: Map<string, Bucket[]>;
}

const bucketKey = (universe: string, gender: string, type: string) =>
  `${universe}|${gender}|${type}`;

/**
 * Multiplicador de uma janela de lancamento: `boost` no inicio, decaindo linearmente ate 1 no fim.
 * Fora da janela (antes do inicio ou depois do fim) vale 1.
 */
export function releaseBoost(win: ReleaseWindowInfo, now: number): number {
  if (!(win.boost > 1) || now < win.startsAt || now >= win.endsAt) return 1;
  const remaining = (win.endsAt - now) / (win.endsAt - win.startsAt);
  return 1 + (win.boost - 1) * remaining;
}

/** Constroi o pool imutavel a partir das linhas. Itens com peso <= 0 ou nao finito sao ignorados. */
export function buildPool(rows: readonly PoolRow[], loadedAt: number = Date.now()): Pool {
  const groups = new Map<string, PoolRow[]>();
  let size = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.weight) || row.weight <= 0) continue;
    const key = bucketKey(row.universe, row.gender, row.type);
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(row);
    size++;
  }

  const buckets: Bucket[] = [];
  for (const [key, list] of groups) {
    const n = list.length;
    const ids = new Float64Array(n);
    const seriesIds = new Float64Array(n);
    const franchiseIds = new Float64Array(n);
    const adult = new Uint8Array(n);
    const cumulative = new Float64Array(n);
    const boosted: BoostedItem[] = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const r = list[i];
      ids[i] = r.id;
      seriesIds[i] = r.seriesId ?? 0;
      franchiseIds[i] = r.franchiseId ?? 0;
      adult[i] = r.adult ? 1 : 0;
      acc += r.weight;
      cumulative[i] = acc;
      if (r.window && r.window.boost > 1) boosted.push({ index: i, weight: r.weight, ...r.window });
    }
    buckets.push({
      key,
      universe: list[0].universe,
      gender: list[0].gender,
      type: list[0].type,
      size: n,
      ids,
      seriesIds,
      franchiseIds,
      adult,
      cumulative,
      total: acc,
      boosted,
    });
  }
  return { loadedAt, size, buckets, viewCache: new Map() };
}

/** Buckets que casam com o filtro (memoizado por filtro). */
export function selectBuckets(pool: Pool, filter: RollFilter = {}): Bucket[] {
  const key = `${filter.universe ?? "*"}|${filter.gender ?? "BOTH"}|${filter.type ?? "*"}`;
  const cached = pool.viewCache.get(key);
  if (cached) return cached;
  const view = pool.buckets.filter(
    (b) =>
      (filter.universe === undefined || b.universe === filter.universe) &&
      (filter.type === undefined || b.type === filter.type) &&
      (filter.gender === undefined || filter.gender === "BOTH" || b.gender === filter.gender)
  );
  pool.viewCache.set(key, view);
  return view;
}

/** Menor indice i com cumulative[i] > r (busca binaria). Itens de peso 0 nunca sao escolhidos. */
export function upperBound(cumulative: Float64Array, r: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid] > r) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** (id, serie primaria, franquia, adulto) -> true se deve ser rejeitado. 0 = ausente. */
export type Rejector = (
  id: number,
  seriesId: number,
  franchiseId: number,
  adult: boolean
) => boolean;

export interface PickOptions {
  rng: Rng;
  /** Epoch ms usado para o boost de lancamento. */
  now: number;
  /** guilds.release_boost_enabled. */
  boostEnabled: boolean;
  /** Padrao: ROLL_REJECTION_ATTEMPTS (config) do chamador; aqui 20 se omitido. */
  maxAttempts?: number;
  isRejected?: Rejector;
}

export interface PickResult {
  /** null = pool vazio para o filtro ou tentativas esgotadas (use o fallback SQL). */
  id: number | null;
  attempts: number;
}

interface Extra {
  bucket: Bucket;
  index: number;
  weight: number;
}

/**
 * Sorteio ponderado com rejeicao.
 *
 * Distribuicao: peso final = roll_weight x releaseBoost. O pool guarda so o peso base no acumulado;
 * o excedente do boost, w x (boost - 1), vira uma lista curta somada ao total. Sorteia-se em
 * [0, base + excedente): na parte base, busca binaria no acumulado; na parte excedente, varredura
 * linear da lista de itens em janela. O resultado equivale a pesos w x boost sem reconstruir o pool
 * por guild nem por instante.
 */
export function pickFromPool(pool: Pool, filter: RollFilter, opts: PickOptions): PickResult {
  const buckets = selectBuckets(pool, filter);
  if (buckets.length === 0) return { id: null, attempts: 0 };

  let baseTotal = 0;
  for (const b of buckets) baseTotal += b.total;

  const extras: Extra[] = [];
  let extraTotal = 0;
  if (opts.boostEnabled) {
    for (const b of buckets) {
      for (const item of b.boosted) {
        const boost = releaseBoost(item, opts.now);
        if (boost > 1) {
          const weight = item.weight * (boost - 1);
          extras.push({ bucket: b, index: item.index, weight });
          extraTotal += weight;
        }
      }
    }
  }

  const total = baseTotal + extraTotal;
  if (!(total > 0)) return { id: null, attempts: 0 };

  const maxAttempts = opts.maxAttempts ?? 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let r = opts.rng() * total;
    let bucket: Bucket;
    let index: number;
    if (r < baseTotal) {
      bucket = buckets[buckets.length - 1];
      for (const b of buckets) {
        if (r < b.total) {
          bucket = b;
          break;
        }
        r -= b.total;
      }
      index = Math.min(upperBound(bucket.cumulative, r), bucket.size - 1);
    } else {
      r -= baseTotal;
      let chosen = extras[extras.length - 1];
      for (const e of extras) {
        if (r < e.weight) {
          chosen = e;
          break;
        }
        r -= e.weight;
      }
      bucket = chosen.bucket;
      index = chosen.index;
    }

    const id = bucket.ids[index];
    if (
      !opts.isRejected ||
      !opts.isRejected(
        id,
        bucket.seriesIds[index],
        bucket.franchiseIds[index],
        bucket.adult[index] === 1
      )
    ) {
      return { id, attempts: attempt };
    }
  }
  return { id: null, attempts: maxAttempts };
}

// ---------------------------------------------------------------------------
// Carga do banco e ciclo de vida
// ---------------------------------------------------------------------------

/**
 * Carrega o pool: so entidades ACTIVE com genero conhecido e peso > 0, com a serie primaria,
 * a franquia e a janela de lancamento aberta (no maximo uma por serie, por indice unico).
 * Select de colunas; nunca SELECT *.
 */
async function loadRows(): Promise<PoolRow[]> {
  const rows = await db
    .select({
      id: entities.id,
      universe: entities.universe,
      gender: entities.gender,
      type: entities.type,
      adult: entities.isAdult,
      weight: entities.rollWeight,
      entityFranchiseId: entities.franchiseId,
      seriesId: entitySeries.seriesId,
      seriesFranchiseId: series.franchiseId,
      boost: releaseWindows.boost,
      startsAt: releaseWindows.startsAt,
      endsAt: releaseWindows.endsAt,
    })
    .from(entities)
    .leftJoin(
      entitySeries,
      and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true))
    )
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .leftJoin(
      releaseWindows,
      and(
        eq(releaseWindows.seriesId, entitySeries.seriesId),
        isNull(releaseWindows.closedAt),
        gt(releaseWindows.endsAt, sql`now()`)
      )
    )
    .where(
      and(eq(entities.status, "ACTIVE"), ne(entities.gender, "UNKNOWN"), gt(entities.rollWeight, 0))
    )
    .orderBy(entities.id);

  return rows.map((r) => ({
    id: r.id,
    universe: r.universe,
    gender: r.gender as PoolGender,
    type: r.type,
    seriesId: r.seriesId,
    franchiseId: r.seriesFranchiseId ?? r.entityFranchiseId,
    adult: r.adult,
    weight: r.weight,
    window:
      r.boost !== null && r.startsAt !== null && r.endsAt !== null
        ? { boost: r.boost, startsAt: r.startsAt.getTime(), endsAt: r.endsAt.getTime() }
        : null,
  }));
}

let current: Pool | null = null;
let loading: Promise<Pool> | null = null;
let rerun = false;

/**
 * Recarrega o pool do banco. Chamadas durante uma carga em andamento agendam uma nova carga logo
 * depois (a anterior pode ter lido dados anteriores ao `catalog:updated`) e devolvem a mesma promessa.
 */
export function reloadPool(): Promise<Pool> {
  if (loading) {
    rerun = true;
    return loading;
  }
  const run = async (): Promise<Pool> => {
    let pool: Pool;
    do {
      rerun = false;
      pool = buildPool(await loadRows(), Date.now());
      current = pool;
    } while (rerun);
    log.debug({ size: pool.size, buckets: pool.buckets.length }, "pool de sorteio carregado");
    return pool;
  };
  loading = run().finally(() => {
    loading = null;
  });
  return loading;
}

/**
 * Pool atual. Carrega na primeira chamada; depois devolve o pool em memoria e, se tiver mais de
 * POOL_REFRESH_MS, dispara recarga em segundo plano sem bloquear o roll.
 */
export async function getPool(): Promise<Pool> {
  ensureWatcher();
  if (!current) return reloadPool();
  if (!loading && Date.now() - current.loadedAt >= POOL_REFRESH_MS) {
    reloadPool().catch((err: unknown) => log.warn({ err }, "falha ao recarregar o pool"));
  }
  return current;
}

let timer: NodeJS.Timeout | null = null;
let unsubscribe: (() => Promise<void>) | null = null;
let watcherStarted = false;
let watcherGeneration = 0;

function ensureWatcher(): void {
  if (watcherStarted) return;
  startPoolWatcher().catch((err: unknown) => log.warn({ err }, "falha ao iniciar o watcher do pool"));
}

/**
 * Recarga periodica (POOL_REFRESH_MS) e por `catalog:updated`. Idempotente.
 * Se o pub/sub falhar, a recarga periodica continua valendo.
 */
export async function startPoolWatcher(): Promise<void> {
  if (watcherStarted) return;
  watcherStarted = true;
  timer = setInterval(() => {
    reloadPool().catch((err: unknown) => log.warn({ err }, "falha na recarga periodica do pool"));
  }, POOL_REFRESH_MS);
  timer.unref();
  const generation = ++watcherGeneration;
  try {
    const kv = await getKV();
    const off = await subscribeEvent(kv, "catalog:updated", async () => {
      await reloadPool();
    });
    if (generation === watcherGeneration && watcherStarted) unsubscribe = off;
    else await off().catch(() => undefined); // parado enquanto assinava
  } catch (err) {
    log.warn({ err }, "sem assinatura de catalog:updated; so a recarga periodica atualiza o pool");
  }
}

/** Encerra o timer e a assinatura (shutdown e testes). Nao descarta o pool em memoria. */
export async function stopPoolWatcher(): Promise<void> {
  watcherStarted = false;
  watcherGeneration++;
  if (timer) clearInterval(timer);
  timer = null;
  const off = unsubscribe;
  unsubscribe = null;
  if (off) await off().catch(() => undefined);
}

/** Descarta o pool em memoria (testes). */
export function resetPoolForTests(): void {
  current = null;
}
