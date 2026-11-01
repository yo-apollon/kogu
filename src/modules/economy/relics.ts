/**
 * Reliquias (Bronze -> Esmeralda). As regras de custo e evolucao (funcoes PURAS) vivem em
 * src/shared/relics.ts, copiado para a dashboard; este modulo as reexporta e acrescenta entrada do
 * usuario e apresentacao (emoji/i18n).
 *
 * Porte de `handleRelicsCommand` (src/commands/rpgCommands.ts, legado). Nada aqui toca banco, Redis
 * ou Discord: a evolucao atomica fica em `extra.ts`.
 */
import { DEFAULT_LOCALE } from "../../config/constants.js";
import { t } from "../../i18n/index.js";
import {
  RELIC_BASE_COST,
  RELIC_FIELD,
  RELIC_KEYS,
  RELIC_MAX_LEVEL,
  RUBY_DISCOUNT_FACTOR,
  RUBY_DISCOUNT_LEVEL,
  clampRelicLevel,
  emptyRelicLevels,
  isMaxLevel,
  planRelicUpgrade,
  relicDiscount,
  relicLevelsOf,
  relicUpgradeCost,
  totalRelicLevels,
  type RelicColumns,
  type RelicKey,
  type RelicLevels,
  type RelicUpgradePlan,
} from "../../shared/relics.js";
import { emoji, relicEmoji } from "../../ui/emojis.js";

export {
  RELIC_BASE_COST,
  RELIC_FIELD,
  RELIC_KEYS,
  RELIC_MAX_LEVEL,
  RUBY_DISCOUNT_FACTOR,
  RUBY_DISCOUNT_LEVEL,
  clampRelicLevel,
  emptyRelicLevels,
  isMaxLevel,
  planRelicUpgrade,
  relicDiscount,
  relicLevelsOf,
  relicUpgradeCost,
  totalRelicLevels,
};
export type { RelicColumns, RelicKey, RelicLevels, RelicUpgradePlan };

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

/** Barra de nivel: `🟩🟩🟩🟩🟪🟪⬛⬛` (8 niveis: 1..4 mortal, 5..8 ascensao cosmica). */
export function relicBar(level: number): string {
  const filled = clampRelicLevel(level);
  let bar = "";
  for (let i = 1; i <= RELIC_MAX_LEVEL; i++) {
    if (i <= filled) {
      bar += i <= 4 ? emoji("relic.filled") : "🟪";
    } else {
      bar += emoji("relic.empty");
    }
  }
  return bar;
}

/** "🥉 Reliquia de Bronze" no idioma pedido. */
export function relicLabel(key: RelicKey, locale: string = DEFAULT_LOCALE): string {
  return `${relicEmoji(key)} ${t(`economy.relic.${key}.name`, locale)}`;
}

export function relicDescription(key: RelicKey, locale: string = DEFAULT_LOCALE): string {
  return t(`economy.relic.${key}.desc`, locale);
}
