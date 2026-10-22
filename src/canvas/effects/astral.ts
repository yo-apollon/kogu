import type { SKRSContext2D } from "@napi-rs/canvas";
import { DEFAULT_FACE_HOLE, drawMaskedLayer, type FaceHole } from "../engine/draw/layer.js";
import type { Rect } from "../engine/draw/shapes.js";
import type { ThemeTokens } from "../skins/types.js";
import { COLORS, lighten, rgba } from "../theme/tokens.js";
import { mulberry32 } from "./noise.js";
import { drawParticles } from "./particles.js";

export interface AstralOptions {
  seed: number;
  theme: ThemeTokens;
  intensity?: number;
  hole?: FaceHole | null;
}

/**
 * Astral: nebulosa radial multi-camada (cores do tema) + brilho de borda + estrelas semeadas.
 * Nebulosa em 'screen' com buraco no rosto; estrelas rarefeitas sobre o centro.
 */
export function drawAstral(g: SKRSContext2D, rect: Rect, opts: AstralOptions): void {
  const rand = mulberry32(opts.seed ^ 0xa57a1);
  const k = opts.intensity ?? 1;
  const hole = opts.hole === undefined ? DEFAULT_FACE_HOLE : opts.hole;
  const { primary, secondary, glow } = opts.theme;
  const palette = [primary, secondary, glow, lighten(secondary, 0.35)];

  drawMaskedLayer(
    g,
    rect,
    (lg, local) => {
      // camadas de nebulosa: manchas grandes com falloff suave
      const layers = 5;
      for (let i = 0; i < layers; i++) {
        const cx = local.w * (0.1 + rand() * 0.8);
        const cy = local.h * (0.1 + rand() * 0.8);
        const r = local.h * (0.25 + rand() * 0.3);
        const color = palette[i % palette.length]!;
        const grad = lg.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba(color, 0.75));
        grad.addColorStop(0.45, rgba(color, 0.28));
        grad.addColorStop(1, rgba(color, 0));
        lg.fillStyle = grad;
        lg.fillRect(0, 0, local.w, local.h);
      }
      // veu de poeira clara em diagonal
      const dust = lg.createLinearGradient(0, local.h, local.w, 0);
      dust.addColorStop(0, rgba(COLORS.white, 0));
      dust.addColorStop(0.5, rgba(COLORS.white, 0.18));
      dust.addColorStop(1, rgba(COLORS.white, 0));
      lg.fillStyle = dust;
      lg.fillRect(0, 0, local.w, local.h);
    },
    { composite: "screen", alpha: 0.5 * k, hole }
  );

  // brilho nas bordas da arte (moldura de luz)
  drawMaskedLayer(
    g,
    rect,
    (lg, local) => {
      const rim = lg.createRadialGradient(local.w / 2, local.h / 2, local.h * 0.3, local.w / 2, local.h / 2, local.h * 0.75);
      rim.addColorStop(0, rgba(glow, 0));
      rim.addColorStop(1, rgba(glow, 0.7));
      lg.fillStyle = rim;
      lg.fillRect(0, 0, local.w, local.h);
    },
    { composite: "screen", alpha: 0.45 * k, hole: null }
  );

  drawParticles(g, rect, {
    seed: opts.seed ^ 0x5a5a,
    count: Math.round(70 * k),
    colors: [COLORS.white, lighten(primary, 0.5), lighten(secondary, 0.5)],
    minR: 0.6,
    maxR: 2.2,
    sparkle: 0.22,
    alpha: 0.9,
    avoid: { cx: rect.x + rect.w * 0.5, cy: rect.y + rect.h * 0.34, r: rect.h * 0.28, keep: 0.2 },
  });
}
