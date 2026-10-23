import type { CardSkin, SkinMatchContext } from "./types.js";
import { animeNeonSkin } from "./anime-neon.js";
import { cinemaNoirSkin } from "./cinema-noir.js";
import { classicSkin } from "./classic.js";
import { gameHudSkin } from "./game-hud.js";
import { mudaeSkin } from "./mudae.js";

/** Skin usada quando nenhuma outra pontua (e quando o registro esta vazio de matches). */
export const FALLBACK_SKIN_ID = "mudae";

const skins = new Map<string, CardSkin>();

/** Registra (ou substitui) uma skin. A ordem de registro desempata pontuacoes iguais. */
export function registerSkin(skin: CardSkin): void {
  skins.set(skin.id, skin);
}

export function getSkin(id: string): CardSkin | undefined {
  return skins.get(id);
}

export function listSkins(): CardSkin[] {
  return [...skins.values()];
}

/**
 * Escolhe a skin de maior pontuacao: preferida do dono (100) > evento (50) > mudae (20, padrao) > universo (10) > classic (1).
 * Empates: vence a primeira registrada. Cai em `mudae` se nada pontuar.
 */
export function selectSkin(ctx: SkinMatchContext): CardSkin {
  let best: CardSkin | undefined;
  let bestScore = 0;
  for (const skin of skins.values()) {
    const score = skin.match(ctx);
    if (score > bestScore) {
      best = skin;
      bestScore = score;
    }
  }
  const chosen = best ?? skins.get(FALLBACK_SKIN_ID);
  if (!chosen) throw new Error("Nenhuma skin registrada (classic ausente)");
  return chosen;
}

// skins embutidas: classic, depois as tematicas e por fim mudae (padrao; ver MUDAE_BASE_SCORE)
for (const skin of [classicSkin, animeNeonSkin, gameHudSkin, cinemaNoirSkin, mudaeSkin]) registerSkin(skin);
