/**
 * Reliquias (Bronze -> Esmeralda): regras de custo e evolucao como funcoes PURAS.
 *
 * Porte de `handleRelicsCommand` (src/commands/rpgCommands.ts, legado):
 *  - nivel maximo 4;
 *  - custo = round(custoBase * (nivelAtual + 1) * desconto);
 *  - desconto de 25% em todas as evolucoes quando a Reliquia de Rubi esta no nivel maximo.
 * Nada aqui toca banco, Redis ou Discord: a evolucao atomica fica em `extra.ts`.
 */
import { DEFAULT_LOCALE } from "../../config/constants.js";
import { t } from "../../i18n/index.js";
import { emoji, relicEmoji } from "../../ui/emojis.js";

export const RELIC_KEYS = ["bronze", "silver", "gold", "sapphire", "ruby", "emerald"] as const;
export type RelicKey = (typeof RELIC_KEYS)[number];

export const RELIC_MAX_LEVEL = 4;

/** Custo base em Eter; o custo real multiplica pelo proximo nivel (1..4). */
export const RELIC_BASE_COST: Readonly<Record<RelicKey, number>> = {
  bronze: 500,
  silver: 1000,
  gold: 1500,
  sapphire: 2500,
  ruby: 4000,
  emerald: 5000,
};

/** Rubi neste nivel (ou acima) da -25% em todas as evolucoes. */
export const RUBY_DISCOUNT_LEVEL = 4;
export const RUBY_DISCOUNT_FACTOR = 0.75;

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

/** Multiplicador de preco: 0.75 com Rubi no maximo, senao 1. */
export function relicDiscount(rubyLevel: number): number {
  return rubyLevel >= RUBY_DISCOUNT_LEVEL ? RUBY_DISCOUNT_FACTOR : 1;
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
  return Math.round(RELIC_BASE_COST[key] * (level + 1) * relicDiscount(clampRelicLevel(rubyLevel)));
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

// ---------------------------------------------------------------------------
// Entrada do usuario
// ---------------------------------------------------------------------------

const RELIC_ALIASES: Readonly<Record<string, RelicKey>> = {
  bronze: "bronze",
  bronzeo: "bronze",
  silver: "silver",
  prata: "silver",
  gold: "gold",
  ouro: "gold",
  sapphire: "sapphire",
  safira: "sapphire",
  ruby: "ruby",
  rubi: "ruby",
  emerald: "emerald",
  esmeralda: "emerald",
};

function fold(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(reliquia|relic)\s+(de\s+)?/, "")
    .trim();
}

/** Aceita chave em ingles, nome em portugues, com ou sem acento e maiusculas. */
export function parseRelicKey(input: string | null | undefined): RelicKey | null {
  if (!input) return null;
  return RELIC_ALIASES[fold(input)] ?? null;
}

// ---------------------------------------------------------------------------
// Apresentacao (texto puro; nenhum acesso externo)
// ---------------------------------------------------------------------------

/** Barra de nivel: `🟩🟩⬛⬛` (emojis centralizados em ui/emojis). */
export function relicBar(level: number): string {
  const filled = clampRelicLevel(level);
  return (
    emoji("relic.filled").repeat(filled) + emoji("relic.empty").repeat(RELIC_MAX_LEVEL - filled)
  );
}

/** "🥉 Reliquia de Bronze" no idioma pedido. */
export function relicLabel(key: RelicKey, locale: string = DEFAULT_LOCALE): string {
  return `${relicEmoji(key)} ${t(`economy.relic.${key}.name`, locale)}`;
}

export function relicDescription(key: RelicKey, locale: string = DEFAULT_LOCALE): string {
  return t(`economy.relic.${key}.desc`, locale);
}
