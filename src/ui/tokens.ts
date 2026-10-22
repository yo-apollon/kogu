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
