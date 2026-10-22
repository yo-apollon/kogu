import { SKIN_EVENTS } from "../../../config/gacha.js";
import type { SkinMatchContext, UniverseKey } from "../../skins/types.js";

/** Pontuacoes de prioridade da selecao de skin. */
export const MATCH_SCORE = {
  preferred: 100,
  event: 50,
  universe: 10,
  fallback: 1,
} as const;

/** True se existe um evento de skin ativo agora para `skinId`. Le SKIN_EVENTS em tempo de chamada. */
export function hasActiveEvent(skinId: string, now: Date): boolean {
  const t = now.getTime();
  return SKIN_EVENTS.some((e) => e.skinId === skinId && t >= Date.parse(e.startsAt) && t < Date.parse(e.endsAt));
}

/**
 * Pontuacao padrao de skin: skin preferida do dono > evento > universo > fallback.
 * `universes` vazio e `fallback=true` => skin universal (classic).
 */
export function scoreMatch(
  skinId: string,
  ctx: SkinMatchContext,
  opts: { universes?: readonly UniverseKey[]; fallback?: boolean } = {}
): number {
  if (ctx.preferredSkinId === skinId) return MATCH_SCORE.preferred;
  if (hasActiveEvent(skinId, ctx.now)) return MATCH_SCORE.event;
  if (opts.universes?.includes(ctx.universe)) return MATCH_SCORE.universe;
  return opts.fallback ? MATCH_SCORE.fallback : 0;
}
