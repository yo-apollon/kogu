import type { SKRSContext2D } from "@napi-rs/canvas";
import { COLORS } from "../../theme/tokens.js";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function roundRectPath(g: SKRSContext2D, r: Rect, radius: number): void {
  g.beginPath();
  g.roundRect(r.x, r.y, r.w, r.h, radius);
}

/** Retangulo com cantos chanfrados (cut = tamanho do corte). Ordem: tl, tr, br, bl. */
export function chamferPath(g: SKRSContext2D, r: Rect, cut: number | [number, number, number, number]): void {
  const [tl, tr, br, bl] = typeof cut === "number" ? [cut, cut, cut, cut] : cut;
  g.beginPath();
  g.moveTo(r.x + tl, r.y);
  g.lineTo(r.x + r.w - tr, r.y);
  g.lineTo(r.x + r.w, r.y + tr);
  g.lineTo(r.x + r.w, r.y + r.h - br);
  g.lineTo(r.x + r.w - br, r.y + r.h);
  g.lineTo(r.x + bl, r.y + r.h);
  g.lineTo(r.x, r.y + r.h - bl);
  g.lineTo(r.x, r.y + tl);
  g.closePath();
}

export function polygonPath(g: SKRSContext2D, pts: ReadonlyArray<readonly [number, number]>): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
}

/** Caminho de estrela de `spikes` pontas (nao preenche). */
export function starPath(g: SKRSContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number): void {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  g.beginPath();
  g.moveTo(cx, cy - outer);
  for (let i = 0; i < spikes; i++) {
    g.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
    rot += step;
    g.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
    rot += step;
  }
  g.closePath();
}

export function drawStar(
  g: SKRSContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  color: string,
  glow = 8,
  spikes = 5
): void {
  g.save();
  starPath(g, cx, cy, spikes, outer, inner);
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = glow;
  g.fill();
  g.restore();
}

/** Cristal de Eter: losango lapidado vetorial (substitui emoji, que quebra no canvas). */
export function drawAetherCrystal(g: SKRSContext2D, x: number, y: number, size: number, color: string = COLORS.aether): void {
  g.save();
  g.beginPath();
  g.moveTo(x, y - size);
  g.lineTo(x + size * 0.75, y);
  g.lineTo(x, y + size);
  g.lineTo(x - size * 0.75, y);
  g.closePath();
  const grad = g.createLinearGradient(x - size, y - size, x + size, y + size);
  grad.addColorStop(0, COLORS.white);
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, COLORS.aetherDeep);
  g.fillStyle = grad;
  g.shadowColor = color;
  g.shadowBlur = 10;
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = COLORS.white;
  g.stroke();
  g.restore();
}
