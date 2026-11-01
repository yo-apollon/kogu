import {
  AETHER_BAND_CURVE,
  AETHER_BAND_JITTER,
  AETHER_MIN,
  EDITION_TIER,
  AETHER_RANGE,
  POPULARITY_WEIGHT,
  TIER_AETHER_BAND,
  TIER_TOP_PERCENT,
  TIER_WEIGHT,
  type EntityEdition,
  type EntityTier,
} from "../config/gacha.js";
import {
  aetherFromPrestige,
  assignNicheTiers,
  computeFictionPrestige,
  spreadTiedPrices,
  thresholdsFor,
  type FictionMember,
  type NicheFamily,
  type PrestigeSource,
  type PrestigeThresholds,
} from "./prestige.js";

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

/**
 * Posicao `index` (0 = melhor) dentro do proprio tier, de 1 (topo do tier) a 0 (fim do tier).
 * Tier com uma carta so devolve 1.
 */
export function positionWithinTier(index: number, total: number): number {
  const c = tierCutoffs(total);
  const tier = tierForPosition(index, total);
  const bounds: Record<EntityTier, [number, number]> = {
    MYTHIC: [0, c.MYTHIC],
    LEGENDARY: [c.MYTHIC, c.LEGENDARY],
    EPIC: [c.LEGENDARY, c.EPIC],
    RARE: [c.EPIC, c.RARE],
    COMMON: [c.RARE, total],
  };
  const [start, end] = bounds[tier];
  const size = end - start;
  if (size <= 1) return 1;
  return 1 - (index - start) / (size - 1);
}

/**
 * Eter base de uma carta: interpola dentro da faixa do tier (`t` = 1 topo do tier, 0 fim) com
 * curva `AETHER_BAND_CURVE` e um desvio fixo derivado da semente da carta.
 */
export function baseAetherForTier(tier: EntityTier, t: number, seed: number): number {
  const { min, max } = TIER_AETHER_BAND[tier];
  const clamped = Math.min(1, Math.max(0, t));
  const raw = min + (max - min) * Math.pow(clamped, AETHER_BAND_CURVE);
  const jitter = ((Math.abs(seed) % 2001) / 1000 - 1) * AETHER_BAND_JITTER;
  return Math.round(Math.min(max, Math.max(min, raw * (1 + jitter))));
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

export interface ScoringNiche {
  key: string;
  family: NicheFamily;
  /** Limiares proprios do nicho (`niches.profile.thresholds`); sem isto valem os da familia. */
  thresholds?: PrestigeThresholds;
}

export interface ScoringInput {
  id: number;
  statsSeed: number;
  /** Fontes que conhecem a entidade (external ids). So a contagem entra no bonus. */
  sources: readonly string[];
  /** Favoritos por fonte (chave = fonte). Fontes sem valor nao entram nos percentis. */
  favorites: Readonly<Record<string, number>>;
  /** Edicao da carta; null/ausente = carta comum, que entra no ranking por percentil. */
  edition?: EntityEdition | null;
  /** Ancora (BASIC) das edicoes EPIC/MYTHIC; a propria ancora tem null. */
  parentId?: number | null;
  /** Nicho de prestigio; ausente = comportamento legado (percentil global). */
  niche?: ScoringNiche | null;
  /** Prestigio gravado; so CURATED/OVERRIDE valem (COMPUTED e sempre recalculado). */
  prestige?: number | null;
  prestigeSource?: PrestigeSource | null;
  /** Serie principal e papel nela (ficcao). */
  seriesId?: number | null;
  seriesRole?: string | null;
  /** Piso de tier por curadoria. */
  tierFloor?: EntityTier | null;
}

export interface ScoringOutput extends BaseStats {
  id: number;
  popularityScore: number;
  /** 1..N, unico; null para edicoes (fora do ranking). */
  popularityRank: number | null;
  tier: EntityTier;
  baseAether: number;
  rollWeight: number;
  /** Prestigio efetivo (null = entidade sem prestigio: legado ou edicao derivada). */
  prestige: number | null;
  prestigeSource: PrestigeSource | null;
}

/** Percentil de `value` dentro de `sorted` (crescente) sem ele participar: mesma regra de `percentiles`. */
function percentileOf(value: number, sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(1, lo / Math.max(1, sorted.length - 1));
}

interface GroupSignals {
  /** Score de popularidade (0..1) e maior favorito de cada item, na ordem de `list`. */
  scores: number[];
  tops: number[];
  sortedBySource: Map<string, number[]>;
}

/** Percentis de favoritos por fonte DENTRO de `list` e score combinado (passos 1 e 2 do scoring). */
function groupSignals(list: readonly ScoringInput[]): GroupSignals {
  const bySource = new Map<string, number[]>();
  list.forEach((e, idx) => {
    for (const source of Object.keys(e.favorites)) {
      let l = bySource.get(source);
      if (!l) bySource.set(source, (l = []));
      l.push(idx);
    }
  });
  const pctByEntity: number[][] = list.map(() => []);
  const sortedBySource = new Map<string, number[]>();
  for (const [source, idxs] of bySource) {
    const values = idxs.map((i) => list[i].favorites[source] ?? 0);
    const pcts = percentiles(values);
    idxs.forEach((entityIdx, k) => pctByEntity[entityIdx].push(pcts[k]));
    sortedBySource.set(
      source,
      [...values].sort((a, b) => a - b)
    );
  }
  return {
    scores: list.map((e, idx) => combineScore(pctByEntity[idx], new Set(e.sources).size)),
    tops: list.map((e) => Math.max(0, ...Object.values(e.favorites))),
    sortedBySource,
  };
}

const isAnchor = (e: ScoringInput) => e.edition === "BASIC" || (!!e.edition && !e.parentId);

interface PrestigeResult {
  value: number;
  source: PrestigeSource;
}

/**
 * Prestigio efetivo de cada entidade com nicho: CURATED/OVERRIDE gravado sempre vence; senao ficcao e
 * computada (fama no nicho, serie, historia). Pessoas sem curadoria ficam sem prestigio (caem no legado).
 * O contexto inclui as ancoras de edicao (a fama e a serie nao dependem de a carta ter edicoes).
 */
function resolvePrestige(inputs: readonly ScoringInput[]): Map<number, PrestigeResult> {
  const out = new Map<number, PrestigeResult>();
  const fictionByNiche = new Map<string, ScoringInput[]>();
  for (const e of inputs) {
    if (!e.niche || (e.edition && !isAnchor(e))) continue;
    if (
      e.prestige !== null &&
      e.prestige !== undefined &&
      (e.prestigeSource === "CURATED" || e.prestigeSource === "OVERRIDE")
    ) {
      out.set(e.id, { value: e.prestige, source: e.prestigeSource });
    }
    if (e.niche.family === "fiction") {
      let l = fictionByNiche.get(e.niche.key);
      if (!l) fictionByNiche.set(e.niche.key, (l = []));
      l.push(e);
    }
  }
  for (const list of fictionByNiche.values()) {
    const sig = groupSignals(list);
    const members: FictionMember[] = list.map((e, i) => ({
      id: e.id,
      seriesId: e.seriesId ?? null,
      role: e.seriesRole ?? null,
      fame: sig.scores[i],
      favorites: sig.tops[i],
    }));
    const computed = computeFictionPrestige(members);
    for (const e of list) {
      if (!out.has(e.id)) out.set(e.id, { value: computed.get(e.id) ?? 0, source: "COMPUTED" });
    }
  }
  return out;
}

/**
 * Pontua o catalogo (so entidades ativas). Passos:
 * 0. entidades com nicho e prestigio (ficcao computada ou curada) seguem o sistema de prestigio:
 *    tier por limiares absolutos + quotas do nicho, Eter pelo prestigio, score = prestigio/100.
 *    As demais (sem nicho, ou pessoas sem curadoria) seguem o legado abaixo;
 * 1. percentil de favoritos por fonte, calculado entre as entidades COMUNS legadas que tem aquela fonte
 *    (edicoes ficam de fora para nao distorcer os percentis nem os tiers das demais);
 * 2. score = max dos percentis + 0.02 por fonte adicional (teto 1);
 * 3. ranking por score desc, desempate por favoritos desc e id asc (deterministico), so das comuns;
 * 4. tier pela posicao no ranking; Eter, peso de sorteio e stats a partir do score/tier.
 * Edicoes (`edition` != null): tier fixo `EDITION_TIER`, sem rank, score da ancora (a propria carta
 * BASIC ou o `parentId`; com prestigio, prestigio/100), e o Eter dentro da faixa do tier usa o score
 * da ancora como posicao.
 * Retorna primeiro as comuns na ordem do ranking e depois as edicoes por id.
 */
export function scoreCatalog(inputs: readonly ScoringInput[]): ScoringOutput[] {
  const regular = inputs.filter((e) => !e.edition);
  const editioned = inputs.filter((e) => e.edition);
  const prestigeById = resolvePrestige(inputs);

  const legacy = regular.filter((e) => !prestigeById.has(e.id));
  const tiered = regular.filter((e) => prestigeById.has(e.id));

  // --- legado: ranking por percentil entre as cartas sem prestigio ---
  const sig = groupSignals(legacy);
  const legacyRows = legacy.map((e, idx) => ({ e, score: sig.scores[idx], topFavorites: sig.tops[idx] }));
  legacyRows.sort((a, b) => b.score - a.score || b.topFavorites - a.topFavorites || a.e.id - b.e.id);
  const legacyTotal = legacyRows.length;

  interface Row {
    e: ScoringInput;
    score: number;
    topFavorites: number;
    tier: EntityTier;
    aether: number;
    prestige: PrestigeResult | null;
  }
  const rows: Row[] = legacyRows.map(({ e, score, topFavorites }, index) => {
    const tier = tierForPosition(index, legacyTotal);
    return {
      e,
      score,
      topFavorites,
      tier,
      aether: baseAetherForTier(tier, positionWithinTier(index, legacyTotal), e.statsSeed),
      prestige: null,
    };
  });

  // --- prestigio: quotas e preco por nicho ---
  const byNiche = new Map<string, ScoringInput[]>();
  for (const e of tiered) {
    let l = byNiche.get(e.niche!.key);
    if (!l) byNiche.set(e.niche!.key, (l = []));
    l.push(e);
  }
  for (const list of byNiche.values()) {
    const th = list[0].niche!.thresholds ?? thresholdsFor(list[0].niche!.family);
    const tops = new Map(list.map((e) => [e.id, Math.max(0, ...Object.values(e.favorites))]));
    const tiers = assignNicheTiers(
      list.map((e) => ({
        id: e.id,
        prestige: prestigeById.get(e.id)!.value,
        tie: tops.get(e.id),
        floor: e.tierFloor ?? null,
      })),
      th
    );
    const priced = list.map((e) => {
      const p = prestigeById.get(e.id)!;
      const tier = tiers.get(e.id)!;
      return { id: e.id, tier, prestige: p.value, aether: aetherFromPrestige(tier, p.value, th), seed: e.statsSeed };
    });
    const spread = spreadTiedPrices(priced);
    for (const e of list) {
      const p = prestigeById.get(e.id)!;
      rows.push({
        e,
        score: p.value / 100,
        topFavorites: tops.get(e.id)!,
        tier: tiers.get(e.id)!,
        aether: spread.get(e.id)!,
        prestige: p,
      });
    }
  }

  rows.sort((a, b) => b.score - a.score || b.topFavorites - a.topFavorites || a.e.id - b.e.id);
  const out: ScoringOutput[] = rows.map((r, index) => ({
    id: r.e.id,
    popularityScore: r.score,
    popularityRank: index + 1,
    tier: r.tier,
    baseAether: r.aether,
    rollWeight: rollWeightFor(r.tier, r.score),
    prestige: r.prestige?.value ?? null,
    prestigeSource: r.prestige?.source ?? null,
    ...distributeStats(r.tier, r.e.statsSeed),
  }));

  // Score de uma ancora fora do ranking: prestigio/100 quando tem; senao onde ela ficaria entre as legadas.
  const anchorScore = (a: ScoringInput): number => {
    const pr = prestigeById.get(a.id);
    if (pr) return pr.value / 100;
    const pcts: number[] = [];
    for (const [source, value] of Object.entries(a.favorites)) {
      const sorted = sig.sortedBySource.get(source);
      if (sorted) pcts.push(percentileOf(value, sorted));
    }
    return combineScore(pcts, new Set(a.sources).size);
  };
  const scoreById = new Map<number, number>();
  for (const e of editioned) if (e.edition === "BASIC" || !e.parentId) scoreById.set(e.id, anchorScore(e));

  editioned.sort((a, b) => a.id - b.id);
  for (const e of editioned) {
    const edition = e.edition as EntityEdition;
    const tier = EDITION_TIER[edition];
    const score = scoreById.get(e.parentId ?? e.id) ?? 0;
    const own = isAnchor(e) ? (prestigeById.get(e.id) ?? null) : null;
    out.push({
      id: e.id,
      popularityScore: score,
      popularityRank: null,
      tier,
      baseAether: baseAetherForTier(tier, score, e.statsSeed),
      rollWeight: rollWeightFor(tier, score),
      prestige: own?.value ?? null,
      prestigeSource: own?.source ?? null,
      ...distributeStats(tier, e.statsSeed),
    });
  }
  return out;
}
