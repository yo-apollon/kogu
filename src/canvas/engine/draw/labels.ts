import type { CardRenderContext } from "../../skins/types.js";

/**
 * Textos fixos impressos na carta. Tabela propria (o canvas roda em worker, sem o modulo i18n do bot);
 * os idiomas espelham SUPPORTED_LOCALES. Idioma desconhecido cai em pt-BR.
 */
const LABELS = {
  "pt-BR": { rank: "RANK", pact: "Pacto:", free: "LIVRE PARA PACTO", aether: "Éter", isNew: "#NEW" },
  "en-US": { rank: "RANK", pact: "Pact:", free: "FREE TO PACT", aether: "Aether", isNew: "#NEW" },
} as const;

export interface CardLabels {
  rank: string;
  pact: string;
  free: string;
  aether: string;
  isNew: string;
}

export function labelsFor(locale: string): CardLabels {
  return (LABELS as Record<string, CardLabels>)[locale] ?? LABELS["pt-BR"];
}

export function rankText(c: CardRenderContext): string {
  const labels = labelsFor(c.locale);
  return c.popularityRank && c.popularityRank < 99999 ? `#${c.popularityRank}` : labels.isNew;
}

export function safeAether(c: CardRenderContext): number {
  return Number.isFinite(c.aetherValue) ? c.aetherValue : 150;
}

export function clampStat(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(999, Math.round(v))) : 0;
}

/** Nome do dono limitado a 16 grafemas (preserva CJK/emoji). */
export function ownerText(name: string): string {
  return Array.from(name).slice(0, 16).join("");
}
