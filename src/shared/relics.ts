/**
 * Reliquias (Bronze -> Esmeralda): regras de custo e evolucao como funcoes PURAS (copiado para a
 * dashboard). Emoji/i18n e o parse de entrada ficam em `modules/economy/relics.ts`.
 *
 *  - nivel maximo 4;
 *  - custo = round(custoBase * (nivelAtual + 1) * desconto);
 *  - desconto de 25% em todas as evolucoes quando a Reliquia de Rubi esta no nivel maximo.
 */

export const RELIC_KEYS = ["bronze", "silver", "gold", "sapphire", "ruby", "emerald"] as const;
export type RelicKey = (typeof RELIC_KEYS)[number];

export const RELIC_MAX_LEVEL = 8;

/** Custo base em Eter; o custo real multiplica pelo proximo nivel (1..4) e escala exponencialmente na Ascensao (5..8). */
export const RELIC_BASE_COST: Readonly<Record<RelicKey, number>> = {
  bronze: 500,
  silver: 1000,
  gold: 1500,
  sapphire: 2500,
  ruby: 4000,
  emerald: 5000,
};

/** Multiplicadores de nivel para a Ascensao Astral (Tier II: niveis 5 a 8). */
export const ASCENSION_MULTIPLIERS: Readonly<Record<number, number>> = {
  4: 8,   // 4 -> 5 (ex: Bronze 4.000, Esmeralda 40.000)
  5: 14,  // 5 -> 6 (ex: Bronze 7.000, Esmeralda 70.000)
  6: 22,  // 6 -> 7 (ex: Bronze 11.000, Esmeralda 110.000)
  7: 35,  // 7 -> 8 (ex: Bronze 17.500, Esmeralda 175.000)
};

/** Rubi no nivel 4..7 da -25% em todas as evolucoes; no nivel 8 (maximo cosmico) da -35%. */
export const RUBY_DISCOUNT_LEVEL = 4;
export const RUBY_DISCOUNT_FACTOR = 0.75;
export const RUBY_COSMIC_DISCOUNT_LEVEL = 8;
export const RUBY_COSMIC_DISCOUNT_FACTOR = 0.65;

/** Colunas de `guild_members` que guardam o nivel de cada reliquia. */
export interface RelicColumns {
  relicBronze: number;
  relicSilver: number;
  relicGold: number;
  relicSapphire: number;
  relicRuby: number;
  relicEmerald: number;
}

export const RELIC_FIELD: Readonly<Record<RelicKey, keyof RelicColumns>> = {
  bronze: "relicBronze",
  silver: "relicSilver",
  gold: "relicGold",
  sapphire: "relicSapphire",
  ruby: "relicRuby",
  emerald: "relicEmerald",
};

export type RelicLevels = Record<RelicKey, number>;

/** Inteiro em [0, RELIC_MAX_LEVEL]; lixo (NaN, negativo, string) vira 0. */
export function clampRelicLevel(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(RELIC_MAX_LEVEL, Math.max(0, Math.trunc(n)));
}

export function emptyRelicLevels(): RelicLevels {
  return { bronze: 0, silver: 0, gold: 0, sapphire: 0, ruby: 0, emerald: 0 };
}

/** Niveis a partir de uma linha de `guild_members` (ou parte dela). */
export function relicLevelsOf(row: Partial<RelicColumns> | null | undefined): RelicLevels {
  const levels = emptyRelicLevels();
  if (!row) return levels;
  for (const key of RELIC_KEYS) levels[key] = clampRelicLevel(row[RELIC_FIELD[key]]);
  return levels;
}

export function isMaxLevel(level: number): boolean {
  return level >= RELIC_MAX_LEVEL;
}

/** Multiplicador de preco: 0.65 com Rubi no nivel 8 (maximo), 0.75 no nivel 4..7, senao 1. */
export function relicDiscount(rubyLevel: number): number {
  const lvl = clampRelicLevel(rubyLevel);
  if (lvl >= RUBY_COSMIC_DISCOUNT_LEVEL) return RUBY_COSMIC_DISCOUNT_FACTOR;
  if (lvl >= RUBY_DISCOUNT_LEVEL) return RUBY_DISCOUNT_FACTOR;
  return 1;
}

/**
 * Custo para subir `key` do nivel `currentLevel` ao proximo. `null` quando ja esta no maximo.
 * `rubyLevel` e o nivel atual da Reliquia de Rubi do jogador.
 */
export function relicUpgradeCost(
  key: RelicKey,
  currentLevel: number,
  rubyLevel: number
): number | null {
  const level = clampRelicLevel(currentLevel);
  if (isMaxLevel(level)) return null;
  const multiplier = level < 4 ? level + 1 : (ASCENSION_MULTIPLIERS[level] ?? (level + 1) * 3);
  return Math.round(RELIC_BASE_COST[key] * multiplier * relicDiscount(clampRelicLevel(rubyLevel)));
}

export type RelicUpgradePlan =
  | { kind: "max"; level: number }
  | { kind: "insufficient"; cost: number; balance: number; level: number }
  | { kind: "ok"; cost: number; fromLevel: number; toLevel: number; balanceAfter: number };

/** Decide o resultado de uma evolucao sem efeitos colaterais. */
export function planRelicUpgrade(
  levels: RelicLevels,
  balance: number,
  key: RelicKey
): RelicUpgradePlan {
  const level = levels[key];
  const cost = relicUpgradeCost(key, level, levels.ruby);
  if (cost === null) return { kind: "max", level };
  if (balance < cost) return { kind: "insufficient", cost, balance, level };
  return { kind: "ok", cost, fromLevel: level, toLevel: level + 1, balanceAfter: balance - cost };
}

/** Soma dos niveis (0..24), usada em resumos. */
export function totalRelicLevels(levels: RelicLevels): number {
  return RELIC_KEYS.reduce((sum, key) => sum + levels[key], 0);
}