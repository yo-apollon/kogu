import { VARIANT_MULTIPLIER, type CardVariant, type EntityTier } from "../../config/gacha.js";
import type { ThemeTokens } from "../skins/types.js";
import { TIER_STYLE } from "./tiers.js";

/**
 * Unica fonte de cores das cartas. Skins e efeitos NUNCA usam literais de cor:
 * importam COLORS / resolveTheme e compoem com rgba()/mix()/lighten().
 */

export type Hex = string;

export function hexToRgb(hex: Hex): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): Hex {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Cor com alfa: rgba(r,g,b,a). */
export function rgba(hex: Hex, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

/** Interpolacao linear entre duas cores (t=0 => a, t=1 => b). */
export function mix(a: Hex, b: Hex, t: number): Hex {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";
export const lighten = (hex: Hex, t: number): Hex => mix(hex, WHITE, t);
export const darken = (hex: Hex, t: number): Hex => mix(hex, BLACK, t);

/** Paleta neutra e semantica compartilhada (a paleta por variante vem de resolveTheme). */
export const COLORS = {
  white: WHITE,
  black: BLACK,
  // base escura da carta classica
  ink0: "#0B0C10",
  ink1: "#141622",
  ink2: "#090A0F",
  panel: "#13151F",
  pill: "#1E2030",
  fallbackMid: "#1E1B4B",
  // texto
  muted: "#94A3B8",
  // semanticas
  gold: "#FACC15",
  atk: "#F87171",
  def: "#60A5FA",
  spd: "#34D399",
  aether: "#00FFA3",
  aetherDeep: "#006644",
  owner: "#F472B6",
  free: "#4ADE80",
  // iridescencia do holo (ciclo de matiz)
  holo: ["#FF5E5E", "#FFD15E", "#7CFF5E", "#5EFFF2", "#5E7CFF", "#C45EFF", "#FF5E5E"],
} as const;

/** Paletas especificas de skin (tambem tokens: nenhuma skin declara cor propria). */
export const SKIN_COLORS = {
  animeNeon: {
    bg0: "#12041F",
    bg1: "#2A0A45",
    bg2: "#090214",
    chip: "#1B0830",
    cyan: "#22E4FF",
    pink: "#FF3DA5",
    lime: "#B6FF3C",
  },
  gameHud: {
    bg0: "#070B12",
    bg1: "#0F1724",
    steel: "#1B2638",
    line: "#2B3B55",
    accent: "#38F2C8",
    warn: "#FFB020",
  },
  cinemaNoir: {
    bg0: "#050505",
    bg1: "#121110",
    film: "#0A0908",
    hole: "#D9CDB4",
    ivory: "#F1E8D4",
    sepia: "#C9A66B",
    ash: "#A9A092",
    ember: "#8C1C1C",
  },
} as const;

interface PaletteEntry {
  primary: Hex;
  secondary: Hex;
  glow: Hex;
  badgeBg: Hex;
  borderWidth: number;
  glowBlur: number;
}

/** Paletas atuais do renderer legado, uma por variante. */
const VARIANT_PALETTE: Record<CardVariant, PaletteEntry> = {
  STANDARD: { primary: "#5865F2", secondary: "#2B2D31", glow: "#5865F2", badgeBg: "#313338", borderWidth: 4, glowBlur: 0 },
  FOIL: { primary: "#E2E8F0", secondary: "#64748B", glow: "#CBD5E1", badgeBg: "#475569", borderWidth: 4, glowBlur: 16 },
  HOLO: { primary: "#FACC15", secondary: "#CA8A04", glow: "#FDE047", badgeBg: "#854D0E", borderWidth: 6, glowBlur: 16 },
  ASTRAL: { primary: "#E879F9", secondary: "#06B6D4", glow: "#D946EF", badgeBg: "#701A75", borderWidth: 8, glowBlur: 16 },
};

/** Rotulo da variante: "STANDARD", "FOIL +25%", "HOLO +75%", "ASTRAL +300%". */
export function variantLabel(variant: CardVariant): string {
  const m = VARIANT_MULTIPLIER[variant];
  if (m <= 1) return variant;
  return `${variant} +${Math.round((m - 1) * 100)}%`;
}

const cache = new Map<string, ThemeTokens>();

/** Tokens por tier x variante. COMMON + variante reproduz exatamente o legado. */
export function resolveTheme(tier: EntityTier, variant: CardVariant): ThemeTokens {
  const key = `${tier}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = VARIANT_PALETTE[variant];
  const t = TIER_STYLE[tier];
  const theme: ThemeTokens = {
    primary: lighten(base.primary, t.lighten),
    secondary: base.secondary,
    glow: lighten(base.glow, t.lighten),
    badgeBg: base.badgeBg,
    label: variantLabel(variant),
    borderWidth: base.borderWidth + t.borderBonus,
    glowBlur: base.glowBlur + t.glowBonus,
  };
  cache.set(key, theme);
  return theme;
}
