import type { SKRSContext2D } from "@napi-rs/canvas";

/**
 * Pilhas de fonte. Famílias registradas em engine/fonts.ts; 'Noto Sans JP' cobre CJK
 * por fallback de glifo, entao toda pilha a inclui.
 */
export const FONT_SANS = "Inter, 'Noto Sans JP', sans-serif";
export const FONT_SERIF = "Cinzel, 'Noto Sans JP', serif";

export type FontWeight = 400 | 600 | 700;

export function setFont(g: SKRSContext2D, weight: FontWeight, size: number, stack: string = FONT_SANS): void {
  g.font = `${weight} ${size}px ${stack}`;
}

/** Corta `text` com reticencias para caber em maxW (usa a fonte atual do contexto). Seguro para CJK/emoji. */
export function truncateToWidth(g: SKRSContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + "…";
    if (g.measureText(candidate).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("").trimEnd() + "…";
}

export interface FitOptions {
  weight?: FontWeight;
  /** letterSpacing (px) que sera usado no desenho: entra na medicao. */
  tracking?: number;
  size: number;
  minSize?: number;
  stack?: string;
}

/**
 * Ajusta a fonte para caber em maxW: reduz ate minSize e so entao trunca.
 * Deixa a fonte final aplicada no contexto e devolve o texto a desenhar.
 */
export function fitText(g: SKRSContext2D, text: string, maxW: number, opts: FitOptions): string {
  const weight = opts.weight ?? 700;
  const minSize = opts.minSize ?? Math.max(10, Math.floor(opts.size * 0.7));
  let size = opts.size;
  setFont(g, weight, size, opts.stack);
  const prev = g.letterSpacing;
  if (opts.tracking) g.letterSpacing = `${opts.tracking}px`;
  while (size > minSize && g.measureText(text).width > maxW) {
    size -= 1;
    setFont(g, weight, size, opts.stack);
  }
  const out = truncateToWidth(g, text, maxW);
  g.letterSpacing = prev;
  return out;
}

/** Texto com tracking (letterSpacing nativo). Restaura o valor anterior. */
export function withTracking(g: SKRSContext2D, px: number, fn: () => void): void {
  const prev = g.letterSpacing;
  g.letterSpacing = `${px}px`;
  fn();
  g.letterSpacing = prev;
}

/** Iniciais para o fallback do retrato (primeiro grafema de ate 2 palavras; CJK usa 1-2 caracteres). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = (w: string) => Array.from(w)[0] ?? "";
  if (words.length === 1) {
    const chars = Array.from(words[0]!);
    const isLatin = /^[\p{Script=Latin}]/u.test(chars[0] ?? "");
    return (isLatin ? chars.slice(0, 1) : chars.slice(0, 2)).join("").toUpperCase();
  }
  return (first(words[0]!) + first(words[1]!)).toUpperCase();
}
