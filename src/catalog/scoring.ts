import {
  AETHER_MIN,
  AETHER_RANGE,
  POPULARITY_WEIGHT,
  TIER_TOP_PERCENT,
  TIER_WEIGHT,
  type EntityTier,
} from "../config/gacha.js";

/**
 * Scoring do catalogo. Tudo aqui e puro (sem banco, sem relogio, sem Math.random):
 * o job `catalog.rerank` carrega as entidades ativas, chama `scoreCatalog` e grava o resultado.
 */

/** Bonus por fonte adicional que conhece a entidade. */
export const MULTI_SOURCE_BONUS = 0.02;

/* ------------------------------------------------------------------ */
/* PRNG                                                               */
/* ------------------------------------------------------------------ */

/** mulberry32: PRNG de 32 bits, determinístico por semente. Retorna valores em [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Percentis e score                                                  */
/* ------------------------------------------------------------------ */

/**
 * Percentil de cada valor dentro do proprio conjunto, em [0, 1]:
 * `(quantos valores sao estritamente menores) / (n - 1)`.
 * O maior valor unico vale 1; empates dividem o mesmo percentil; conjunto todo igual (ou de um
 * so item) vale 0, ou seja, "sem evidencia de popularidade".
 */
export function percentiles(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(n).fill(0);
  const denom = Math.max(1, n - 1);
  let start = 0;
  while (start < n) {
    let end = start;
    while (end + 1 < n && order[end + 1].v === order[start].v) end++;
    const p = Math.min(1, start / denom);
    for (let k = start; k <= end; k++) out[order[k].i] = p;
    start = end + 1;
  }
  return out;
}

/** `max(percentis por fonte) + 0.02 por fonte adicional`, limitado a 1. */
export function combineScore(sourcePercentiles: readonly number[], sourceCount: number): number {
  const best = sourcePercentiles.length > 0 ? Math.max(...sourcePercentiles) : 0;
  const extra = Math.max(0, sourceCount - 1);
  return Math.min(1, Math.max(0, best + MULTI_SOURCE_BONUS * extra));
}

/* ------------------------------------------------------------------ */
/* Tiers                                                              */
/* ------------------------------------------------------------------ */

export interface TierCutoffs {
  MYTHIC: number;
  LEGENDARY: number;
  EPIC: number;
  RARE: number;
}

/**
 * Quantas posicoes (do topo do ranking) ficam ate cada tier, cumulativo:
 * MYTHIC top 1%, LEGENDARY top 5%, EPIC top 15%, RARE top 40%. Arredonda para cima, entao um
 * catalogo nao vazio sempre tem pelo menos um MYTHIC.
 */
export function tierCutoffs(total: number): TierCutoffs {
  const cut = (pct: number) => Math.min(total, Math.ceil(total * pct - 1e-9));
  return {
    MYTHIC: cut(TIER_TOP_PERCENT.MYTHIC),
    LEGENDARY: cut(TIER_TOP_PERCENT.LEGENDARY),
    EPIC: cut(TIER_TOP_PERCENT.EPIC),
    RARE: cut(TIER_TOP_PERCENT.RARE),
  };
}

/** Tier da posicao `index` (0 = melhor) num ranking de `total` itens. */
export function tierForPosition(index: number, total: number): EntityTier {
  const c = tierCutoffs(total);
  if (index < c.MYTHIC) return "MYTHIC";
  if (index < c.LEGENDARY) return "LEGENDARY";
  if (index < c.EPIC) return "EPIC";
  if (index < c.RARE) return "RARE";
  return "COMMON";
}

/* ------------------------------------------------------------------ */
/* Eter, peso de sorteio e stats                                      */
/* ------------------------------------------------------------------ */

/** `base_aether = round(AETHER_MIN + AETHER_RANGE * score^2)`. */
export function baseAetherFor(score: number): number {
  return Math.round(AETHER_MIN + AETHER_RANGE * score * score);
}

/** `roll_weight = TIER_WEIGHT[tier] * (1 + POPULARITY_WEIGHT * score)`. */
export function rollWeightFor(tier: EntityTier, score: number): number {
  return TIER_WEIGHT[tier] * (1 + POPULARITY_WEIGHT * score);
}

/** Orcamento total de pontos de stats por tier. */
export const STAT_BUDGET: Readonly<Record<EntityTier, number>> = {
  COMMON: 150,
  RARE: 190,
  EPIC: 240,
  LEGENDARY: 300,
  MYTHIC: 380,
};

/** Cada stat recebe pelo menos esta fracao do orcamento. */
export const MIN_STAT_SHARE = 0.1;
/** HP usa a mesma fracao multiplicada por isto (HP e uma escala maior que ATK/DEF/SPD). */
export const HP_MULTIPLIER = 3;

export interface BaseStats {
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  baseHp: number;
}

/**
 * Distribui o orcamento do tier entre ATK/DEF/SPD/HP com o PRNG semeado por `statsSeed`.
 * A forma da distribuicao depende so da semente; o tier so escala. Assim os stats sao estaveis
 * entre ressincronizacoes e mudam apenas de escala quando o tier muda.
 */
export function distributeStats(tier: EntityTier, statsSeed: number): BaseStats {
  const rng = mulberry32(statsSeed);
  const draws = [rng(), rng(), rng(), rng()];
  const sum = draws.reduce((a, b) => a + b, 0) || 1;
  const spread = 1 - 4 * MIN_STAT_SHARE;
  const share = draws.map((d) => MIN_STAT_SHARE + (spread * d) / sum);
  const budget = STAT_BUDGET[tier];
  return {
    baseAtk: Math.round(budget * share[0]),
    baseDef: Math.round(budget * share[1]),
    baseSpd: Math.round(budget * share[2]),
    baseHp: Math.round(budget * share[3] * HP_MULTIPLIER),
  };
}

/* ------------------------------------------------------------------ */
/* Catalogo inteiro                                                   */
/* ------------------------------------------------------------------ */

export interface ScoringInput {
  id: number;
  statsSeed: number;
  /** Fontes que conhecem a entidade (external ids). So a contagem entra no bonus. */
  sources: readonly string[];
  /** Favoritos por fonte (chave = fonte). Fontes sem valor nao entram nos percentis. */
  favorites: Readonly<Record<string, number>>;
}

export interface ScoringOutput extends BaseStats {
  id: number;
  popularityScore: number;
  /** 1..N, unico. */
  popularityRank: number;
  tier: EntityTier;
  baseAether: number;
  rollWeight: number;
}

/**
 * Pontua o catalogo (so entidades ativas). Passos:
 * 1. percentil de favoritos por fonte, calculado entre as entidades que tem aquela fonte;
 * 2. score = max dos percentis + 0.02 por fonte adicional (teto 1);
 * 3. ranking por score desc, desempate por favoritos desc e id asc (deterministico);
 * 4. tier pela posicao no ranking; Eter, peso de sorteio e stats a partir do score/tier.
 * Retorna na ordem do ranking.
 */
export function scoreCatalog(inputs: readonly ScoringInput[]): ScoringOutput[] {
  const bySource = new Map<string, number[]>();
  inputs.forEach((e, idx) => {
    for (const source of Object.keys(e.favorites)) {
      let list = bySource.get(source);
      if (!list) bySource.set(source, (list = []));
      list.push(idx);
    }
  });

  const pctByEntity: number[][] = inputs.map(() => []);
  for (const [source, idxs] of bySource) {
    const pcts = percentiles(idxs.map((i) => inputs[i].favorites[source] ?? 0));
    idxs.forEach((entityIdx, k) => pctByEntity[entityIdx].push(pcts[k]));
  }

  const scored = inputs.map((e, idx) => {
    const sourceCount = new Set(e.sources).size;
    const topFavorites = Math.max(0, ...Object.values(e.favorites));
    return { e, score: combineScore(pctByEntity[idx], sourceCount), topFavorites };
  });

  scored.sort((a, b) => b.score - a.score || b.topFavorites - a.topFavorites || a.e.id - b.e.id);

  const total = scored.length;
  return scored.map(({ e, score }, index) => {
    const tier = tierForPosition(index, total);
    return {
      id: e.id,
      popularityScore: score,
      popularityRank: index + 1,
      tier,
      baseAether: baseAetherFor(score),
      rollWeight: rollWeightFor(tier, score),
      ...distributeStats(tier, e.statsSeed),
    };
  });
}
