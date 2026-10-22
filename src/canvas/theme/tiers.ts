import type { EntityTier } from "../../config/gacha.js";

/**
 * Modulacao visual por tier. Somente numeros: as cores vivem em tokens.ts.
 * Tier maior => borda mais grossa, brilho maior e cor primaria levemente clareada.
 */
export interface TierStyle {
  /** 0..4, util para skins que desenham ornamentos progressivos. */
  rank: number;
  /** Fracao de branco misturada na cor primaria (0..1). */
  lighten: number;
  /** Largura extra de borda em px. */
  borderBonus: number;
  /** Blur extra do brilho em px. */
  glowBonus: number;
}

export const TIER_STYLE: Record<EntityTier, TierStyle> = {
  COMMON: { rank: 0, lighten: 0, borderBonus: 0, glowBonus: 0 },
  RARE: { rank: 1, lighten: 0.04, borderBonus: 0, glowBonus: 3 },
  EPIC: { rank: 2, lighten: 0.08, borderBonus: 1, glowBonus: 6 },
  LEGENDARY: { rank: 3, lighten: 0.14, borderBonus: 2, glowBonus: 10 },
  MYTHIC: { rank: 4, lighten: 0.2, borderBonus: 3, glowBonus: 14 },
};

export function tierRank(tier: EntityTier): number {
  return TIER_STYLE[tier].rank;
}
