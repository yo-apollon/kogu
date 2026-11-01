import {
  ENTITY_TIERS,
  FICTION_NO_SIGNAL_CAP,
  FICTION_POSITION_DECAY,
  FICTION_PRESTIGE_WEIGHTS,
  FICTION_ROLE_WEIGHT,
  MYTHIC_CAP_MIN_NICHE_SIZE,
  MYTHIC_MAX_SHARE,
  PRESTIGE_BAND_CURVE,
  PRESTIGE_THRESHOLDS,
  TIER_AETHER_BAND,
  type EntityTier,
  type PrestigeFamily,
} from "../config/gacha.js";

/**
 * Prestigio por nicho (docs/raridade-por-nicho.md). Tudo aqui e puro (sem banco, sem relogio, sem
 * Math.random): o scoring carrega as entidades e chama estas funcoes.
 */

export const NICHE_FAMILIES = ["fiction", "people_sport", "people_music", "people_creator"] as const;
export type NicheFamily = (typeof NICHE_FAMILIES)[number];

export const PRESTIGE_SOURCES = ["COMPUTED", "CURATED", "OVERRIDE"] as const;
export type PrestigeSource = (typeof PRESTIGE_SOURCES)[number];

/** Limiares por tier (prestigio minimo); abaixo do menor e COMMON. */
export type PrestigeThresholds = Record<Exclude<EntityTier, "COMMON">, number>;

const TIER_RANK: Record<EntityTier, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3, MYTHIC: 4 };
export const tierRank = (tier: EntityTier): number => TIER_RANK[tier];

export function isNicheFamily(value: unknown): value is NicheFamily {
  return typeof value === "string" && (NICHE_FAMILIES as readonly string[]).includes(value);
}

/** Familia de limiares: ficcao ou pessoas (esporte, musica e criadores). */
export function prestigeFamilyOf(family: NicheFamily | PrestigeFamily): PrestigeFamily {
  return family === "fiction" ? "fiction" : "people";
}

export function thresholdsFor(family: NicheFamily | PrestigeFamily): PrestigeThresholds {
  return PRESTIGE_THRESHOLDS[prestigeFamilyOf(family)];
}

/** Valida um perfil de limiares de nicho (`niches.profile.thresholds`): numeros em 0..100 e decrescentes. */
export function parseThresholds(value: unknown): PrestigeThresholds | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const keys = ["MYTHIC", "LEGENDARY", "EPIC", "RARE"] as const;
  const out = {} as PrestigeThresholds;
  for (const k of keys) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return null;
    out[k] = n;
  }
  if (!(out.MYTHIC > out.LEGENDARY && out.LEGENDARY > out.EPIC && out.EPIC > out.RARE)) return null;
  return out;
}

/** Tier pelo limiar absoluto, sem quotas por nicho. */
export function tierForPrestige(
  prestige: number,
  family: NicheFamily | PrestigeFamily | PrestigeThresholds
): EntityTier {
  const t = typeof family === "string" ? thresholdsFor(family) : family;
  if (prestige >= t.MYTHIC) return "MYTHIC";
  if (prestige >= t.LEGENDARY) return "LEGENDARY";
  if (prestige >= t.EPIC) return "EPIC";
  if (prestige >= t.RARE) return "RARE";
  return "COMMON";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Percentil em [0, 1] (mesma regra de `scoring.percentiles`, sem importar dele para evitar ciclo). */
function percentilesOf(values: readonly number[]): number[] {
  const n = values.length;
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

/* ------------------------------------------------------------------ */
/* Ficcao (secao 4.1)                                                 */
/* ------------------------------------------------------------------ */

export type RoleKind = "MAIN" | "SUPPORTING" | "NONE";

/** MAIN e SUPPORTING vem do AniList; qualquer outro valor (BACKGROUND, texto livre, null) = sem papel. */
export function roleKindOf(role: string | null | undefined): RoleKind {
  const r = (role ?? "").trim().toUpperCase();
  return r === "MAIN" || r === "SUPPORTING" ? r : "NONE";
}

const ROLE_RANK: Record<RoleKind, number> = { MAIN: 3, SUPPORTING: 2, NONE: 1 };
export const roleRank = (role: string | null | undefined): number => ROLE_RANK[roleKindOf(role)];

/** `historia_score` em [0, 1]: peso do papel x decaimento da posicao (1 = primeiro por favoritos). */
export function storyScore(role: string | null | undefined, position: number): number {
  const w = FICTION_ROLE_WEIGHT[roleKindOf(role)];
  return w / (1 + FICTION_POSITION_DECAY * Math.max(0, position - 1));
}

export interface FictionMember {
  id: number;
  /** Serie principal; null = sem serie (cada um vira o seu proprio grupo, sem sinal de serie). */
  seriesId: number | null;
  role: string | null;
  /** `fama_score` em [0, 1]: percentil dos favoritos do personagem dentro do nicho (com bonus de fonte extra). */
  fame: number;
  /** Maior contagem bruta de favoritos entre as fontes (desempate e deteccao de "sem sinal"). */
  favorites: number;
}

const byFame = (a: FictionMember, b: FictionMember) =>
  b.fame - a.fame || b.favorites - a.favorites || a.id - b.id;

/**
 * Prestigio computado de ficcao para UM nicho (passe todos os membros do nicho de uma vez).
 * `100 * (0.40 fama + 0.30 serie + 0.30 historia)` e depois as regras de coerencia da serie:
 * teto no protagonista, ordem por papel e limite de 40 em obra sem sinal. Valores arredondados a 2 casas.
 */
export function computeFictionPrestige(members: readonly FictionMember[]): Map<number, number> {
  const groups = new Map<string, FictionMember[]>();
  for (const m of members) {
    const key = m.seriesId === null ? `solo:${m.id}` : `s:${m.seriesId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(m);
  }

  // Popularidade da serie: soma dos 3 maiores `fama` do elenco (premia obra com mais de um nome forte).
  const seriesKeys = [...groups.keys()].filter((k) => k.startsWith("s:"));
  const raw = seriesKeys.map((k) =>
    [...groups.get(k)!]
      .sort(byFame)
      .slice(0, 3)
      .reduce((acc, m) => acc + m.fame, 0)
  );
  const seriesPct = new Map<string, number>();
  percentilesOf(raw).forEach((p, i) => seriesPct.set(seriesKeys[i], p));

  const W = FICTION_PRESTIGE_WEIGHTS;
  const out = new Map<number, number>();
  for (const [key, group] of groups) {
    const ordered = [...group].sort(byFame);
    const serie = seriesPct.get(key) ?? 0;
    const noSignal = group.every((m) => m.favorites <= 0);
    const hist = new Map<number, number>();
    const prest = new Map<number, number>();
    ordered.forEach((m, idx) => {
      const h = storyScore(m.role, idx + 1);
      hist.set(m.id, h);
      const value = noSignal
        ? Math.min(FICTION_NO_SIGNAL_CAP, 100 * h)
        : 100 * (W.fame * m.fame + W.series * serie + W.story * h);
      prest.set(m.id, clamp(value, 0, 100));
    });

    if (group.length > 1) {
      // 1. Teto: ninguem passa do protagonista (maior historia, desempate por fama).
      const protagonist = [...ordered].sort(
        (a, b) => hist.get(b.id)! - hist.get(a.id)! || byFame(a, b)
      )[0];
      const cap = prest.get(protagonist.id)!;
      for (const m of ordered) prest.set(m.id, Math.min(prest.get(m.id)!, cap));

      // 2. Ordem por papel: de baixo para cima, quem tem papel maior sobe ate o maior valor dos papeis menores.
      const ranks = [...new Set(ordered.map((m) => roleRank(m.role)))].sort((a, b) => a - b);
      let floor = 0;
      for (const rank of ranks) {
        const level = ordered.filter((m) => roleRank(m.role) === rank);
        let levelMax = 0;
        for (const m of level) {
          const v = Math.max(prest.get(m.id)!, floor);
          prest.set(m.id, v);
          levelMax = Math.max(levelMax, v);
        }
        floor = Math.max(floor, levelMax);
      }
    }
    for (const m of group) out.set(m.id, round2(clamp(prest.get(m.id)!, 0, 100)));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Quotas por nicho (secao 5)                                         */
/* ------------------------------------------------------------------ */

export interface NicheCard {
  id: number;
  prestige: number;
  /** Desempate de ordem entre prestigios iguais (ex.: fama); maior primeiro. */
  tie?: number;
  /** Piso de tier por curadoria: o tier final nunca fica abaixo dele. */
  floor?: EntityTier | null;
}

const byPrestige = (a: NicheCard, b: NicheCard) =>
  b.prestige - a.prestige || (b.tie ?? 0) - (a.tie ?? 0) || a.id - b.id;

/**
 * Maximo de MYTHIC num nicho com `total` cartas: ceil(1%) se o nicho tem MYTHIC_CAP_MIN_NICHE_SIZE
 * cartas ou mais; em nichos menores nao ha teto percentual (so o limiar absoluto).
 */
export function mythicCap(total: number): number {
  if (total < MYTHIC_CAP_MIN_NICHE_SIZE) return total;
  return Math.ceil(total * MYTHIC_MAX_SHARE - 1e-9);
}

/**
 * Tier de cada carta de UM nicho: limiar absoluto, depois (1) teto de MYTHIC (so em nicho grande),
 * excedente desce para LEGENDARY pela ordem de prestigio; (2) piso de quantidade: se ninguem ficou
 * MYTHIC, a melhor carta sobe ate LEGENDARY (nunca MYTHIC por si so); (3) piso por curadoria
 * (`floor`) de cada carta, aplicado por ultimo.
 */
export function assignNicheTiers(
  cards: readonly NicheCard[],
  family: NicheFamily | PrestigeFamily | PrestigeThresholds
): Map<number, EntityTier> {
  const sorted = [...cards].sort(byPrestige);
  const out = new Map<number, EntityTier>();
  let mythics = 0;
  const cap = mythicCap(sorted.length);
  for (const c of sorted) {
    let tier = tierForPrestige(c.prestige, family);
    if (tier === "MYTHIC") {
      if (mythics >= cap) tier = "LEGENDARY";
      else mythics++;
    }
    out.set(c.id, tier);
  }
  if (sorted.length > 0 && mythics === 0) {
    const best = sorted[0];
    if (tierRank(out.get(best.id)!) < tierRank("LEGENDARY")) out.set(best.id, "LEGENDARY");
  }
  for (const c of sorted) {
    if (c.floor && tierRank(out.get(c.id)!) < tierRank(c.floor)) out.set(c.id, c.floor);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Preco (secao 6)                                                    */
/* ------------------------------------------------------------------ */

/** Intervalo de prestigio que cada tier cobre nos limiares (COMMON vai de 0 ao menor limiar, MYTHIC ate 100). */
export function tierPrestigeRange(tier: EntityTier, th: PrestigeThresholds): [number, number] {
  switch (tier) {
    case "MYTHIC":
      return [th.MYTHIC, 100];
    case "LEGENDARY":
      return [th.LEGENDARY, th.MYTHIC];
    case "EPIC":
      return [th.EPIC, th.LEGENDARY];
    case "RARE":
      return [th.RARE, th.EPIC];
    default:
      return [0, th.RARE];
  }
}

/**
 * Eter base pela posicao do prestigio dentro do tier: `min + (max - min) * t^curva`, com
 * `t = (prestigio - min_do_tier) / (max_do_tier - min_do_tier)` limitado a [0, 1]. Monotonico no
 * prestigio dentro do tier, sem jitter. Carta rebaixada/promovida por quota usa o `t` limitado.
 */
export function aetherFromPrestige(
  tier: EntityTier,
  prestige: number,
  family: NicheFamily | PrestigeFamily | PrestigeThresholds
): number {
  const th = typeof family === "string" ? thresholdsFor(family) : family;
  const [lo, hi] = tierPrestigeRange(tier, th);
  const t = hi > lo ? clamp((prestige - lo) / (hi - lo), 0, 1) : 1;
  const { min, max } = TIER_AETHER_BAND[tier];
  return Math.round(clamp(min + (max - min) * Math.pow(t, PRESTIGE_BAND_CURVE), min, max));
}

export interface PricedCard {
  id: number;
  tier: EntityTier;
  prestige: number;
  aether: number;
  seed: number;
}

/**
 * Desempate de preco SO entre cartas com prestigio e tier identicos, por semente fixa da carta:
 * o grupo ocupa [piso, preco-base], onde o piso e o maior entre o minimo da faixa e o preco-base do
 * grupo imediatamente inferior do mesmo tier. Assim nunca reordena prestigios diferentes.
 */
export function spreadTiedPrices(cards: readonly PricedCard[]): Map<number, number> {
  const groups = new Map<string, PricedCard[]>();
  for (const c of cards) {
    const key = `${c.tier}|${c.prestige}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(c);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => a[0].prestige - b[0].prestige || tierRank(a[0].tier) - tierRank(b[0].tier)
  );
  const lowerTop = new Map<EntityTier, number>();
  const out = new Map<number, number>();
  for (const g of ordered) {
    const tier = g[0].tier;
    const base = Math.max(...g.map((c) => c.aether));
    const floor = Math.max(TIER_AETHER_BAND[tier].min, lowerTop.get(tier) ?? 0);
    const sorted = [...g].sort((a, b) => Math.abs(a.seed) - Math.abs(b.seed) || a.id - b.id);
    sorted.forEach((c, idx) => out.set(c.id, Math.max(Math.min(floor, base), base - idx)));
    lowerTop.set(tier, base);
  }
  return out;
}

export { ENTITY_TIERS };
