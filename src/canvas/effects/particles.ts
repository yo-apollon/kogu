import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Rect } from "../engine/draw/shapes.js";
import { COLORS, rgba } from "../theme/tokens.js";
import { mulberry32 } from "./noise.js";

export interface ParticleOptions {
  seed: number;
  count: number;
  colors?: readonly string[];
  minR?: number;
  maxR?: number;
  /** Fracao (0..1) de particulas desenhadas como brilho de 4 pontas. */
  sparkle?: number;
  /** Alfa do nucleo. */
  alpha?: number;
  /** Zona a evitar (rosto): particulas dentro dela sao mantidas so com probabilidade `keep`. */
  avoid?: { cx: number; cy: number; r: number; keep: number };
}

function sparklePath(g: SKRSContext2D, x: number, y: number, r: number): void {
  const k = r * 0.22;
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + k, y - k);
  g.lineTo(x + r, y);
  g.lineTo(x + k, y + k);
  g.lineTo(x, y + r);
  g.lineTo(x - k, y + k);
  g.lineTo(x - r, y);
  g.lineTo(x - k, y - k);
  g.closePath();
}

/** Particulas/estrelas semeadas, deterministicas. Deve ser chamada com clip ja aplicado, se necessario. */
export function drawParticles(g: SKRSContext2D, rect: Rect, opts: ParticleOptions): void {
  const rand = mulberry32(opts.seed ^ 0x51ed270b);
  const colors = opts.colors && opts.colors.length > 0 ? opts.colors : [COLORS.white];
  const minR = opts.minR ?? 0.8;
  const maxR = opts.maxR ?? 2.6;
  const sparkle = opts.sparkle ?? 0.15;
  const alpha = opts.alpha ?? 0.9;
  g.save();
  for (let i = 0; i < opts.count; i++) {
    // consome sempre os mesmos sorteios por iteracao => estabilidade quando `avoid` muda
    const x = rect.x + rand() * rect.w;
    const y = rect.y + rand() * rect.h;
    const r = minR + (maxR - minR) * Math.pow(rand(), 2.2);
    const color = colors[Math.floor(rand() * colors.length)]!;
    const isSparkle = rand() < sparkle;
    const keepRoll = rand();
    if (opts.avoid) {
      const d = Math.hypot(x - opts.avoid.cx, y - opts.avoid.cy);
      if (d < opts.avoid.r && keepRoll > opts.avoid.keep) continue;
    }
    g.fillStyle = rgba(color, alpha * 0.22);
    g.beginPath();
    g.arc(x, y, r * 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rgba(color, alpha);
    if (isSparkle) {
      sparklePath(g, x, y, r * 3);
      g.fill();
    } else {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
