import type { SKRSContext2D } from "@napi-rs/canvas";
import { DEFAULT_FACE_HOLE, drawMaskedLayer, type FaceHole } from "../engine/draw/layer.js";
import type { Rect } from "../engine/draw/shapes.js";
import { COLORS, rgba } from "../theme/tokens.js";
import { drawParticles } from "./particles.js";
import { mulberry32 } from "./noise.js";

export interface HoloOptions {
  seed: number;
  intensity?: number;
  hole?: FaceHole | null;
}

/**
 * Holografico: gradiente conico iridescente (color-dodge) + faixas prismaticas diagonais (screen)
 * + brilhos pontuais. O buraco do rosto reduz a intensidade no centro do retrato.
 */
export function drawHolo(g: SKRSContext2D, rect: Rect, opts: HoloOptions): void {
  const rand = mulberry32(opts.seed ^ 0x0b01);
  const k = opts.intensity ?? 1;
  const hole = opts.hole === undefined ? DEFAULT_FACE_HOLE : opts.hole;
  const ccx = rect.w * (0.25 + rand() * 0.5);
  const ccy = rect.h * (0.25 + rand() * 0.4);
  const start = rand() * Math.PI * 2;
  const stripeAngle = (35 + rand() * 20) * (Math.PI / 180);

  // 1) conico iridescente em color-dodge: realca sem lavar as sombras
  drawMaskedLayer(
    g,
    rect,
    (lg, local) => {
      const cone = lg.createConicGradient(start, ccx, ccy);
      const stops = COLORS.holo;
      stops.forEach((c, i) => cone.addColorStop(i / (stops.length - 1), c));
      lg.fillStyle = cone;
      lg.fillRect(0, 0, local.w, local.h);
    },
    { composite: "color-dodge", alpha: 0.44 * k, hole }
  );

  // 2) faixas prismaticas em screen
  drawMaskedLayer(
    g,
    rect,
    (lg, local) => {
      const len = Math.hypot(local.w, local.h);
      lg.save();
      lg.translate(local.w / 2, local.h / 2);
      lg.rotate(stripeAngle);
      const bands = 7;
      const bw = len / bands;
      const shift = rand() * bw;
      for (let i = -1; i <= bands; i++) {
        const x = -len / 2 + i * bw + shift;
        const color = COLORS.holo[i < 0 ? 0 : i % (COLORS.holo.length - 1)]!;
        const grad = lg.createLinearGradient(x, 0, x + bw, 0);
        grad.addColorStop(0, rgba(color, 0));
        grad.addColorStop(0.5, rgba(color, 0.55));
        grad.addColorStop(1, rgba(color, 0));
        lg.fillStyle = grad;
        lg.fillRect(x, -len / 2, bw, len);
      }
      lg.restore();
    },
    { composite: "screen", alpha: 0.2 * k, hole }
  );

  // 3) brilhos pontuais
  drawParticles(g, rect, {
    seed: opts.seed ^ 0x77,
    count: Math.round(34 * k),
    colors: [COLORS.white, ...COLORS.holo.slice(0, 6)],
    minR: 0.7,
    maxR: 1.8,
    sparkle: 0.35,
    alpha: 0.85,
    avoid: { cx: rect.x + rect.w * 0.5, cy: rect.y + rect.h * 0.34, r: rect.h * 0.28, keep: 0.25 },
  });
}
