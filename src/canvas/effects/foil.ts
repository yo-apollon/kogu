import type { SKRSContext2D } from "@napi-rs/canvas";
import { DEFAULT_FACE_HOLE, drawMaskedLayer, type FaceHole } from "../engine/draw/layer.js";
import type { Rect } from "../engine/draw/shapes.js";
import { COLORS, lighten, rgba } from "../theme/tokens.js";
import { drawGrain, mulberry32 } from "./noise.js";

export interface FoilOptions {
  seed: number;
  /** Cor do metal (normalmente theme.primary). */
  tint: string;
  intensity?: number;
  hole?: FaceHole | null;
}

/**
 * Folha metalica: varredura linear diagonal brilhante + faixa secundaria fina + granulado.
 * A posicao da varredura vem do seed (cada carta tem seu reflexo).
 */
export function drawFoil(g: SKRSContext2D, rect: Rect, opts: FoilOptions): void {
  const rand = mulberry32(opts.seed ^ 0xf011);
  const k = opts.intensity ?? 1;
  const p = 0.3 + rand() * 0.4;
  const angle = (-30 - rand() * 20) * (Math.PI / 180);
  const cx = rect.w / 2;
  const cy = rect.h / 2;
  const len = Math.hypot(rect.w, rect.h) / 2;
  const dx = Math.cos(angle) * len;
  const dy = Math.sin(angle) * len;
  const bright = lighten(opts.tint, 0.55);

  drawMaskedLayer(
    g,
    rect,
    (lg, local) => {
      const sweep = lg.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      sweep.addColorStop(0, rgba(COLORS.white, 0));
      sweep.addColorStop(Math.max(0.01, p - 0.2), rgba(opts.tint, 0));
      sweep.addColorStop(p - 0.07, rgba(opts.tint, 0.28));
      sweep.addColorStop(p, rgba(COLORS.white, 0.62));
      sweep.addColorStop(p + 0.07, rgba(bright, 0.28));
      sweep.addColorStop(Math.min(0.99, p + 0.2), rgba(opts.tint, 0));
      sweep.addColorStop(1, rgba(COLORS.white, 0));
      lg.fillStyle = sweep;
      lg.fillRect(0, 0, local.w, local.h);

      const q = Math.min(0.95, p + 0.28 + rand() * 0.1);
      const thin = lg.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      thin.addColorStop(0, rgba(COLORS.white, 0));
      thin.addColorStop(q - 0.02, rgba(COLORS.white, 0));
      thin.addColorStop(q, rgba(COLORS.white, 0.35));
      thin.addColorStop(q + 0.02, rgba(COLORS.white, 0));
      thin.addColorStop(1, rgba(COLORS.white, 0));
      lg.fillStyle = thin;
      lg.fillRect(0, 0, local.w, local.h);
    },
    { composite: "screen", alpha: 0.55 * k, hole: opts.hole === undefined ? DEFAULT_FACE_HOLE : opts.hole }
  );

  drawGrain(g, rect, opts.seed, { density: 0.0022, alpha: 0.07 * k, size: 1 });
}
