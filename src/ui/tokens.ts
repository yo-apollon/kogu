/**
 * Tokens de cor do design system. Todas as cores de embed vem daqui.
 * As paletas de variante reaproveitam as de `src/canvas/cardRenderer.ts`.
 */
import type { CardVariant, EntityTier } from "../config/gacha.js";

/** Cor lateral do embed por tier de raridade. */
export const TIER_COLORS: Record<EntityTier, number> = {
  COMMON: 0x9ca3af,
  RARE: 0x3b82f6,
  EPIC: 0xa855f7,
  LEGENDARY: 0xf59e0b,
  MYTHIC: 0xff2e63,
};

export interface VariantPalette {
  /** Cor do embed (lateral). */
  embed: number;
  primary: number;
  secondary: number;
  glow: number;
  badgeBg: number;
}

/** Paleta por variante visual da carta (espelha o renderer atual). */
export const VARIANT_PALETTES: Record<CardVariant, VariantPalette> = {
  STANDARD: {
    embed: 0x5865f2,
    primary: 0x5865f2,
    secondary: 0x2b2d31,
    glow: 0x5865f2,
    badgeBg: 0x313338,
  },
  FOIL: {
    embed: 0xcbd5e1,
    primary: 0xe2e8f0,
    secondary: 0x64748b,
    glow: 0xcbd5e1,
    badgeBg: 0x475569,
  },
  HOLO: {
    embed: 0xfacc15,
    primary: 0xfacc15,
    secondary: 0xca8a04,
    glow: 0xfde047,
    badgeBg: 0x854d0e,
  },
  ASTRAL: {
    embed: 0xd946ef,
    primary: 0xe879f9,
    secondary: 0x06b6d4,
    glow: 0xd946ef,
    badgeBg: 0x701a75,
  },
};

export const UI_STATES = [
  "free",
  "claimed",
  "expired",
  "error",
  "success",
  "warn",
  "info",
] as const;
export type UiState = (typeof UI_STATES)[number];

/** Cor por estado de interacao/mensagem. */
export const STATE_COLORS: Record<UiState, number> = {
  /** Entidade livre para Pacto (bordo, estilo Mudae). */
  free: 0xe03b54,
  claimed: 0x2b2d31,
  expired: 0x6b7280,
  error: 0xef4444,
  success: 0x4ade80,
  warn: 0xf59e0b,
  info: 0x5865f2,
};

/** Cor de marca, usada quando nenhum estado se aplica. */
export const BRAND_COLOR = 0x5865f2;

export function colorForVariant(variant: CardVariant | string | null | undefined): number {
  const palette = variant ? VARIANT_PALETTES[variant as CardVariant] : undefined;
  return (palette ?? VARIANT_PALETTES.STANDARD).embed;
}

export function colorForTier(tier: EntityTier | string | null | undefined): number {
  return (tier ? TIER_COLORS[tier as EntityTier] : undefined) ?? TIER_COLORS.COMMON;
}

export function colorForState(state: UiState): number {
  return STATE_COLORS[state] ?? BRAND_COLOR;
}

/** Paleta de cores icônicas por franquia / universo para combinar com o personagem. */
export const FRANCHISE_COLORS: Record<string, number> = {
  // Persona (ex: Ren Amamiya)
  persona: 0xe60012,
  "persona 5": 0xe60012,
  "persona 4": 0xfbbf24,
  "persona 3": 0x2563eb,
  // Vocaloid (ex: Hatsune Miku)
  vocaloid: 0xf77f00,
  "hatsune miku": 0x00f5d4,
  // Shonen & Anime consagrados
  "one piece": 0xff7700,
  "jujutsu kaisen": 0x6a0dad,
  bleach: 0xe63946,
  naruto: 0xff7700,
  "naruto shippuden": 0xff7700,
  "dragon ball": 0xff5722,
  "dragon ball z": 0xff5722,
  "dragon ball super": 0xff5722,
  "solo leveling": 0x7b2cbf,
  "demon slayer": 0x168aad,
  "kimetsu no yaiba": 0x168aad,
  "attack on titan": 0x588157,
  "shingeki no kyojin": 0x588157,
  "chainsaw man": 0xf77f00,
  jojo: 0xff007f,
  "jojo's bizarre adventure": 0xff007f,
  "hunter x hunter": 0x52b788,
  "my hero academia": 0x2ec4b6,
  "boku no hero academia": 0x2ec4b6,
  "re:zero": 0x8338ec,
  "neon genesis evangelion": 0x7209b7,
  evangelion: 0x7209b7,
  "death note": 0x2b2d42,
  "tokyo ghoul": 0x9d0208,
  "fullmetal alchemist": 0xd90429,
  fate: 0x3a86ff,
  "fate/stay night": 0x3a86ff,
  "sword art online": 0x0077b6,
  "genshin impact": 0x4cc9f0,
  "honkai: star rail": 0x7209b7,
  "league of legends": 0x00b4d8,
  arcane: 0xd00000,
  pokemon: 0xffcb05,
  "pokémon": 0xffcb05,
  zelda: 0x2a9d8f,
  "the legend of zelda": 0x2a9d8f,
  mario: 0xe52521,
  sonic: 0x0077b6,
  "final fantasy": 0x00b4d8,
  "devil may cry": 0xc1121f,
  "god of war": 0x780000,
  "cyberpunk 2077": 0xfee440,
  "cyberpunk: edgerunners": 0xfee440,
  "elden ring": 0xd4af37,
  "dark souls": 0x495057,
  "spider-man": 0xe63946,
  marvel: 0xe63946,
  batman: 0x1d3557,
  dc: 0x1d3557,
  "star wars": 0xe63946,
};

/** Gera uma cor vibrante e harmoniosa baseada no nome (HSL com saturação 80% e luminosidade 52%). */
export function hashNameToColor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash) % 360;
  const s = 0.8;
  const l = 0.52;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);

  return (ri << 16) | (gi << 8) | bi;
}

/** Resolve a cor que combina perfeitamente com a carta rolled ou inspecionada. */
export function resolveCardEmbedColor(view: {
  name: string;
  franchise?: string | null;
  tier?: EntityTier;
  variant?: CardVariant;
  ownerEmbedColor?: number;
}): number {
  if (view.ownerEmbedColor) return view.ownerEmbedColor;
  if (view.variant && view.variant !== "STANDARD") {
    return VARIANT_PALETTES[view.variant].embed;
  }
  if (view.franchise) {
    const fLower = view.franchise.toLowerCase().trim();
    if (FRANCHISE_COLORS[fLower]) return FRANCHISE_COLORS[fLower];
    for (const [key, color] of Object.entries(FRANCHISE_COLORS)) {
      if (fLower.includes(key)) return color;
    }
  }
  const nLower = view.name.toLowerCase().trim();
  for (const [key, color] of Object.entries(FRANCHISE_COLORS)) {
    if (nLower.includes(key)) return color;
  }
  return hashNameToColor(view.name);
}
