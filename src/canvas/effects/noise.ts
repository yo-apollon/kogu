import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Rect } from "../engine/draw/shapes.js";
import { COLORS, rgba } from "../theme/tokens.js";

/** PRNG deterministico mulberry32. Unica fonte de aleatoriedade das cartas. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits: converte string em semente. */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface GrainOptions {
  /** Pontos por px^2. */
  density?: number;
  /** Alfa maximo de cada ponto. */
  alpha?: number;
  /** Lado do ponto em px. */
  size?: number;
  light?: string;
  dark?: string;
}

/** Granulado fino semeado (pontos claros e escuros). Pure: mesmo seed => mesmos pontos. */
export function drawGrain(g: SKRSContext2D, rect: Rect, seed: number, opts: GrainOptions = {}): void {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const density = opts.density ?? 0.004;
  const alpha = opts.alpha ?? 0.08;
  const size = opts.size ?? 1;
  const count = Math.round(rect.w * rect.h * density);
  const buckets = [
    { color: opts.light ?? COLORS.white, a: alpha, path: [] as number[] },
    { color: opts.dark ?? COLORS.black, a: alpha, path: [] as number[] },
  ];
  for (let i = 0; i < count; i++) {
    const b = buckets[rand() < 0.5 ? 0 : 1]!;
    b.path.push(rect.x + rand() * rect.w, rect.y + rand() * rect.h);
  }
  g.save();
  g.beginPath();
  g.rect(rect.x, rect.y, rect.w, rect.h);
  g.clip();
  for (const b of buckets) {
    g.fillStyle = rgba(b.color, b.a);
    g.beginPath();
    for (let i = 0; i < b.path.length; i += 2) g.rect(b.path[i]!, b.path[i + 1]!, size, size);
    g.fill();
  }
  g.restore();
}
