/**
 * Parametros de balanceamento do jogo. Ajustar aqui, sem mexer na logica.
 */

export const ENTITY_TIERS = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const;
export type EntityTier = (typeof ENTITY_TIERS)[number];

export const CARD_VARIANTS = ["STANDARD", "FOIL", "HOLO", "ASTRAL"] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

/** Peso de sorteio por tier (maior = mais comum). */
export const TIER_WEIGHT: Record<EntityTier, number> = {
  COMMON: 1.0,
  RARE: 0.8,
  EPIC: 0.55,
  LEGENDARY: 0.3,
  MYTHIC: 0.12,
};

/** Corte de percentil (do topo) para cada tier; o restante e COMMON. */
export const TIER_TOP_PERCENT: Record<Exclude<EntityTier, "COMMON">, number> = {
  MYTHIC: 0.01,
  LEGENDARY: 0.05,
  EPIC: 0.15,
  RARE: 0.4,
};

/** Chance acumulada por variante, avaliada de cima para baixo (em %). */
export const VARIANT_CHANCE = {
  ASTRAL: 3,
  HOLO: 9,
  FOIL: 20,
} as const;

/** Multiplicador de Eter por variante. */
export const VARIANT_MULTIPLIER: Record<CardVariant, number> = {
  STANDARD: 1,
  FOIL: 1.25,
  HOLO: 1.75,
  ASTRAL: 4,
};

/** Bonus de Eter por faixa de Selos de Despertar. */
export const AWAKENING_BONUS_AT = [2, 4, 5, 7, 8, 9] as const;
export const AWAKENING_BONUS_STEP = 0.1;
export const AWAKENING_BONUS_AFTER_10 = 0.05;

/** Peso extra proporcional a popularidade: w = tierWeight * (1 + POPULARITY_WEIGHT * score). */
export const POPULARITY_WEIGHT = 0.15;

/** base_aether = round(AETHER_MIN + AETHER_RANGE * score^2). */
export const AETHER_MIN = 40;
export const AETHER_RANGE = 1160;

/** Janela de lancamento: boost inicial decai linearmente ate 1. */
export const RELEASE_BOOST_DEFAULT = 2.0;
export const RELEASE_BOOST_MIN = 1;
export const RELEASE_BOOST_MAX = 5;

/** Historico anti-repeticao por servidor. */
export const RECENT_ROLLS_KEEP = 50;
export const ROLL_REJECTION_ATTEMPTS = 20;

/** Padroes de servidor. */
export const GUILD_DEFAULTS = {
  baseRolls: 10,
  rollIntervalMin: 60,
  claimIntervalMin: 180,
  claimWindowSeconds: 120,
  pactLimit: 8100,
} as const;

/** Intervalo de recarga do pool de sorteio em memoria. */
export const POOL_REFRESH_MS = 5 * 60 * 1000;

/** Eventos sazonais: skin de evento ativa dentro do intervalo. */
export interface SkinEvent {
  skinId: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
}
export const SKIN_EVENTS: SkinEvent[] = [];
