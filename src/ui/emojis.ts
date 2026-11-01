/**
 * Mapa central de emojis. Todo emoji exibido ao usuario deve vir daqui, para
 * permitir trocar por emojis customizados do servidor sem editar os comandos.
 *
 * Override: variavel de ambiente `KOGU_EMOJIS` (ou legada `ARQON_EMOJIS`) (JSON `{"aether":"<:aether:123>"}`)
 * ou `setEmojiOverrides({...})` em runtime/testes.
 */
import type { CardVariant } from "../config/gacha.js";

export const DEFAULT_EMOJIS = {
  // Economia e pacto
  aether: "💠",
  pact: "❤️",
  key: "🗝️",
  like: "⭐",
  wish: "🌠",
  starwish: "🌟",
  pantheon: "🏛️",
  rift: "🌌",
  scroll: "📜",
  orb: "💠",
  roll: "🎲",
  stacked: "📦",
  daily: "🎁",
  leader: "👑",
  rank: "🏆",
  timer: "⏳",
  settings: "⚙️",
  language: "🌐",
  disabled: "🚫",
  expired: "🌫️",
  dissolve: "💔",
  gift: "🎁",
  note: "📝",
  alias: "🏷️",
  catalog: "📋",
  search: "🔍",

  // Status
  success: "✅",
  error: "❌",
  warn: "⚠️",
  info: "ℹ️",
  lock: "🔒",
  shield: "🛡️",

  // Variantes de carta
  "variant.STANDARD": "📜",
  "variant.FOIL": "✨",
  "variant.HOLO": "🌟",
  "variant.ASTRAL": "🔮",

  // Genero
  "gender.FEMALE": "♀",
  "gender.MALE": "♂",
  "gender.BOTH": "⚧",

  // Reliquias
  "relic.bronze": "🥉",
  "relic.silver": "🥈",
  "relic.gold": "🥇",
  "relic.sapphire": "💎",
  "relic.ruby": "🩸",
  "relic.emerald": "💚",
  "relic.filled": "🟩",
  "relic.empty": "⬛",

  // Atributos de combate
  atk: "⚔️",
  def: "🛡️",
  spd: "⚡",

  // Navegacao
  "nav.first": "⏮️",
  "nav.prev": "◀️",
  "nav.next": "▶️",
  "nav.last": "⏭️",
  "nav.jump": "🔢",
} as const;

export type EmojiKey = keyof typeof DEFAULT_EMOJIS;

let overrides: Partial<Record<EmojiKey, string>> | null = null;

function isEmojiKey(key: string): key is EmojiKey {
  return Object.prototype.hasOwnProperty.call(DEFAULT_EMOJIS, key);
}

function loadEnvOverrides(): Partial<Record<EmojiKey, string>> {
  const raw = process.env.KOGU_EMOJIS ?? process.env.ARQON_EMOJIS;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<EmojiKey, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isEmojiKey(key) && typeof value === "string" && value.length > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Define overrides em runtime (substitui os carregados do ambiente). */
export function setEmojiOverrides(map: Partial<Record<EmojiKey, string>>): void {
  overrides = { ...map };
}

/** Descarta overrides; o proximo acesso relê o ambiente. */
export function resetEmojiOverrides(): void {
  overrides = null;
}

export function emoji(key: EmojiKey): string {
  if (overrides === null) overrides = loadEnvOverrides();
  return overrides[key] ?? DEFAULT_EMOJIS[key];
}

export function variantEmoji(variant: CardVariant | string | null | undefined): string {
  const key = `variant.${variant ?? "STANDARD"}`;
  return emoji(isEmojiKey(key) ? key : "variant.STANDARD");
}

export function genderEmoji(gender: string | null | undefined): string {
  const key = `gender.${gender ?? "BOTH"}`;
  return emoji(isEmojiKey(key) ? key : "gender.BOTH");
}

export function relicEmoji(relic: string): string {
  const key = `relic.${relic}`;
  return isEmojiKey(key) ? emoji(key) : emoji("relic.bronze");
}
