// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
/**
 * Parametros de balanceamento do jogo. Ajustar aqui, sem mexer na logica.
 */

export const ENTITY_TIERS = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const;
export type EntityTier = (typeof ENTITY_TIERS)[number];

/**
 * Edicoes de uma mesma carta. BASIC e a ancora do personagem (carta original); EPIC e MYTHIC sao
 * linhas proprias em `entities` com `parent_id` apontando para a ancora. A raridade de cada
 * edicao e fixa (nao entra no ranking por percentil).
 */
export const ENTITY_EDITIONS = ["BASIC", "EPIC", "MYTHIC"] as const;
export type EntityEdition = (typeof ENTITY_EDITIONS)[number];

export const EDITION_TIER: Record<EntityEdition, EntityTier> = {
  BASIC: "COMMON",
  EPIC: "EPIC",
  MYTHIC: "MYTHIC",
};

/** Chave i18n do rotulo de cada edicao (pt-BR "Edicao Mitica", en-US "Mythic Edition"). */
export const EDITION_LABEL = {
  BASIC: "summon.edition_basic",
  EPIC: "summon.edition_epic",
  MYTHIC: "summon.edition_mythic",
} as const satisfies Record<EntityEdition, `summon.edition_${string}`>;

export const CARD_VARIANTS = ["STANDARD", "FOIL", "HOLO", "ASTRAL"] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

/** Peso de sorteio por tier (maior = mais comum). */
export const TIER_WEIGHT: Record<EntityTier, number> = {
  COMMON: 1.0,
  RARE: 0.5,
  EPIC: 0.25,
  LEGENDARY: 0.08,
  MYTHIC: 0.015,
};

/**
 * Faixa de Eter base por tier (antes do multiplicador de variante e dos Selos de Despertar).
 * Dentro da faixa o valor varia pela posicao da carta no tier e por um pequeno desvio fixo
 * por carta, entao nao ha duas cartas com o mesmo preco por acaso.
 */
export const TIER_AETHER_BAND: Record<EntityTier, { min: number; max: number }> = {
  COMMON: { min: 80, max: 800 },
  RARE: { min: 1_000, max: 2_500 },
  EPIC: { min: 3_000, max: 7_000 },
  LEGENDARY: { min: 8_000, max: 20_000 },
  MYTHIC: { min: 25_000, max: 60_000 },
};

/** Expoente da curva dentro da faixa (>1 deixa as melhores cartas do tier mais caras que o meio). */
export const AETHER_BAND_CURVE = 1.6;
/** Desvio fixo por carta, em fracao do valor (0.04 = +-4%), limitado a faixa do tier. */
export const AETHER_BAND_JITTER = 0.04;

/** Limite global de copias ativas por tier (Opcao A: MYTHIC 1/1, LEGENDARY 3, EPIC 10; null = ilimitado). */
export const TIER_MAX_SUPPLY: Record<EntityTier, number | null> = {
  MYTHIC: 1,
  LEGENDARY: 3,
  EPIC: 10,
  RARE: null,
  COMMON: null,
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
