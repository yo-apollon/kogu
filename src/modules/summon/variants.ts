import {
  AWAKENING_BONUS_AFTER_10,
  AWAKENING_BONUS_AT,
  AWAKENING_BONUS_STEP,
  VARIANT_CHANCE,
  VARIANT_MULTIPLIER,
  type CardVariant,
} from "../../config/gacha.js";

/** Gerador de numeros em [0, 1). Injetavel para testes e rolls com seed. */
export type Rng = () => number;

/** Ordem de avaliacao das variantes: de cima para baixo, probabilidades acumuladas. */
const VARIANT_ORDER = ["ASTRAL", "HOLO", "FOIL"] as const;

/**
 * Sorteia a variante visual da carta. Os percentuais de VARIANT_CHANCE sao individuais e
 * acumulam na ordem: ASTRAL 3%, HOLO 9% (ate 12%), FOIL 20% (ate 32%), resto STANDARD.
 * Mesma regra do summonEngine antigo.
 */
export function rollVariant(rng: Rng = Math.random): CardVariant {
  const roll = rng() * 100;
  let acc = 0;
  for (const variant of VARIANT_ORDER) {
    acc += VARIANT_CHANCE[variant];
    if (roll < acc) return variant;
  }
  return "STANDARD";
}

/**
 * Valor em Eter de uma carta. Porte literal de calculateAetherValue (src/engine/summonEngine.ts):
 * multiplicador da variante + bonus por faixa de Selos de Despertar.
 * A ordem das somas em ponto flutuante e a mesma do original, entao o resultado e identico.
 */
export function calculateAetherValue(
  baseAether: number,
  variant: string,
  awakeningKeys: number = 0
): number {
  const safeBase = Number(baseAether) || 150;
  const multiplier0 = (VARIANT_MULTIPLIER as Record<string, number>)[variant];
  let multiplier = multiplier0 ?? 1;

  const keys = Number(awakeningKeys) || 0;
  for (const at of AWAKENING_BONUS_AT) {
    if (keys >= at) multiplier += AWAKENING_BONUS_STEP;
  }
  if (keys >= 11) multiplier += (keys - 10) * AWAKENING_BONUS_AFTER_10;

  return Math.round(safeBase * multiplier);
}

/**
 * Valor de um pacto ja firmado: nunca abaixo do Eter registrado na assinatura
 * (o rerank do catalogo nao pode frustrar quem ja firmou).
 */
export function pactAetherValue(
  baseAether: number,
  variant: string,
  awakeningKeys: number,
  aetherAtBind: number
): number {
  return Math.max(calculateAetherValue(baseAether, variant, awakeningKeys), aetherAtBind);
}

/** Recompensa do orbe de Eter (fluxo antigo: 20% do valor, minimo 25). */
export const ORB_MIN_REWARD = 25;
export const ORB_REWARD_RATIO = 0.2;
/** Teto do premio: com cartas de 25 mil+ de Eter, 20% sem limite viraria inflacao. */
export const ORB_MAX_REWARD = 2_000;

export function orbReward(aetherValue: number): number {
  return Math.min(
    ORB_MAX_REWARD,
    Math.max(ORB_MIN_REWARD, Math.round(aetherValue * ORB_REWARD_RATIO))
  );
}

/** PRNG mulberry32: deterministico por seed, para testes e rolls reproduziveis. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
