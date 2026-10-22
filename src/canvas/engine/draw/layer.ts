import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { COLORS, rgba } from "../../theme/tokens.js";
import type { Rect } from "./shapes.js";

export type Composite = SKRSContext2D["globalCompositeOperation"];

/** Regiao a proteger (rosto): fracoes do retangulo da camada. */
export interface FaceHole {
  fx: number;
  fy: number;
  /** Raio como fracao da altura. */
  fr: number;
  /** 0..1: quanto do efeito e removido no centro. */
  strength: number;
}

export const DEFAULT_FACE_HOLE: FaceHole = { fx: 0.5, fy: 0.34, fr: 0.3, strength: 0.7 };

export interface LayerOptions {
  composite: Composite;
  alpha: number;
  hole?: FaceHole | null;
}

// Canvas reaproveitados por tamanho: evita alocar ~1 MB por efeito a cada carta.
const free = new Map<string, Canvas[]>();

function acquire(w: number, h: number): Canvas {
  const key = `${w}x${h}`;
  const list = free.get(key);
  const canvas = list?.pop() ?? createCanvas(w, h);
  canvas.getContext("2d").clearRect(0, 0, w, h);
  return canvas;
}

function release(canvas: Canvas): void {
  const key = `${canvas.width}x${canvas.height}`;
  const list = free.get(key) ?? [];
  if (list.length < 4) list.push(canvas);
  free.set(key, list);
}

/**
 * Pinta em uma camada transparente (coordenadas locais 0..w/0..h), apaga o buraco do rosto
 * e compoe sobre `g` com o modo de mistura pedido. Necessario porque modos como color-dodge
 * so interagem com o fundo no momento da composicao final.
 */
export function drawMaskedLayer(
  g: SKRSContext2D,
  rect: Rect,
  paint: (lg: SKRSContext2D, local: Rect) => void,
  opts: LayerOptions
): void {
  const w = Math.ceil(rect.w);
  const h = Math.ceil(rect.h);
  const canvas = acquire(w, h);
  const lg = canvas.getContext("2d");
  paint(lg, { x: 0, y: 0, w, h });

  if (opts.hole) {
    const { fx, fy, fr, strength } = opts.hole;
    const r = fr * h;
    const grad = lg.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, r);
    grad.addColorStop(0, rgba(COLORS.black, strength));
    grad.addColorStop(0.55, rgba(COLORS.black, strength * 0.7));
    grad.addColorStop(1, rgba(COLORS.black, 0));
    lg.save();
    lg.globalCompositeOperation = "destination-out";
    lg.fillStyle = grad;
    lg.fillRect(0, 0, w, h);
    lg.restore();
  }

  g.save();
  g.globalCompositeOperation = opts.composite;
  g.globalAlpha = opts.alpha;
  g.drawImage(canvas, rect.x, rect.y);
  g.restore();
  release(canvas);
}
