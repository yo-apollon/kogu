import type { SKRSContext2D } from "@napi-rs/canvas";
import { drawVariantEffects } from "../engine/draw/variantEffects.js";
import { scoreMatch } from "../engine/draw/match.js";
import { drawPortrait } from "../engine/draw/portrait.js";
import { roundRectPath, type Rect } from "../engine/draw/shapes.js";
import { COLORS, lighten, rgba } from "../theme/tokens.js";
import type { CardLayer, CardRenderContext, CardSkin } from "./types.js";

/**
 * Padrao Mudae: arte limpa (retrato 0,64, cantos de 4% da largura, borda branca fina).
 * Nenhum texto/stat/pill na imagem: toda informacao vai no embed (src/ui/summonEmbed.ts).
 * A variante e um efeito SUTIL dentro da arte e na borda.
 */
const W = 480;
const H = 750;
const RADIUS = Math.round(W * 0.04);
const ART: Rect = { x: 0, y: 0, w: W, h: H };
const EDGE = 2;
/** Pontuacao base: vence skins de universo (10); perde para evento (50) e para a preferida do dono (100). */
export const MUDAE_BASE_SCORE = 20;

/** Intensidade dos efeitos: bem abaixo das skins tematicas, para a arte continuar limpa. */
const EFFECT_SCALE = 0.7;

function borderRect(): Rect {
  return { x: EDGE / 2, y: EDGE / 2, w: W - EDGE, h: H - EDGE };
}

const background: CardLayer = {
  id: "background",
  draw() {
    // fundo transparente de proposito
  },
};

const portrait: CardLayer = {
  id: "portrait",
  draw(g: SKRSContext2D, c: CardRenderContext) {
    g.save();
    roundRectPath(g, ART, RADIUS);
    g.clip();
    drawPortrait(g, c, ART, { yBias: 0.08 });
    g.restore();
  },
};

const effects: CardLayer = {
  id: "effects",
  draw(g, c) {
    g.save();
    roundRectPath(g, ART, RADIUS);
    g.clip();
    drawVariantEffects(g, c, ART, undefined, EFFECT_SCALE);
    g.restore();
  },
};

const frame: CardLayer = {
  id: "frame",
  draw(g, c) {
    const r = borderRect();
    g.save();
    switch (c.variant) {
      case "FOIL": {
        const grad = g.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, COLORS.white);
        grad.addColorStop(0.5, lighten(c.theme.secondary, 0.6));
        grad.addColorStop(1, COLORS.white);
        g.strokeStyle = grad;
        break;
      }
      case "HOLO": {
        const grad = g.createLinearGradient(0, 0, W, H);
        const stops = COLORS.holo;
        stops.forEach((col, i) => grad.addColorStop(i / (stops.length - 1), lighten(col, 0.55)));
        g.strokeStyle = grad;
        break;
      }
      case "ASTRAL":
        g.strokeStyle = lighten(c.theme.glow, 0.7);
        g.shadowColor = rgba(c.theme.glow, 0.9);
        g.shadowBlur = 10;
        break;
      default:
        g.strokeStyle = COLORS.white;
    }
    g.lineWidth = EDGE;
    roundRectPath(g, r, RADIUS - EDGE / 2);
    g.stroke();
    g.restore();
  },
};

export const mudaeSkin: CardSkin = {
  id: "mudae",
  version: 1,
  label: "Mudae",
  size: { w: W, h: H },
  match(ctx) {
    const s = scoreMatch("mudae", ctx, { fallback: true });
    return s > 1 ? s : MUDAE_BASE_SCORE;
  },
  layers: [background, portrait, effects, frame],
};
