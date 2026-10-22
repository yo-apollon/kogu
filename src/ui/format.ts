/** Formatadores puros de texto para embeds e mensagens. */
import { DEFAULT_LOCALE, type Locale } from "../config/constants.js";
import { emoji, genderEmoji } from "./emojis.js";

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Formata inteiros/decimais com separador de milhar do idioma (1.234 / 1,234). */
export function formatNumber(n: number, locale: Locale | string = DEFAULT_LOCALE): string {
  let fmt = numberFormats.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    numberFormats.set(locale, fmt);
  }
  return fmt.format(Number.isFinite(n) ? n : 0);
}

export interface ProgressBarOptions {
  filled?: string;
  empty?: string;
}

/** Barra de progresso de `width` celulas; `value` e limitado a [0, max]. */
export function progressBar(
  value: number,
  max: number,
  width = 10,
  opts: ProgressBarOptions = {}
): string {
  const cells = Math.max(0, Math.floor(width));
  const ratio = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * cells);
  return (opts.filled ?? "█").repeat(filled) + (opts.empty ?? "░").repeat(cells - filled);
}

/** Corta em `n` caracteres (code points), terminando com reticencias quando cortar. */
export function truncate(s: string, n: number, ellipsis = "…"): string {
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  const keep = Math.max(0, n - Array.from(ellipsis).length);
  return chars.slice(0, keep).join("") + ellipsis;
}

/** Escapa os caracteres de markdown do Discord para exibir texto de usuario literalmente. */
export function escapeMarkdown(s: string): string {
  return s.replace(/[\\*_~`|>[\]()#]/g, "\\$&").replace(/^(\s*)-/gm, "$1\\-");
}

export type TimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

/** Marcador de timestamp do Discord para um instante em ms (epoch). */
export function discordTimestamp(ms: number, style: TimestampStyle = "R"): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** `<t:..:R>` ("em 5 minutos" / "ha 2 horas") para um instante em ms (epoch). */
export function relativeTime(ms: number): string {
  return discordTimestamp(ms, "R");
}

/** Duracao compacta: 3_725_000 -> "1h 02m"; abaixo de 1 min -> "45s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Escolhe singular/plural (`count === 1` -> singular). Para textos traduzidos
 * prefira `tPlural`; isto serve a rotulos simples e a idiomas com plural em "s".
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export interface AetherOptions {
  locale?: Locale | string;
  bold?: boolean;
}

/** "1.234 💠" (ou "**1.234** 💠"). */
export function formatAether(n: number, opts: AetherOptions = {}): string {
  const num = formatNumber(n, opts.locale);
  return `${opts.bold ? `**${num}**` : num} ${emoji("aether")}`;
}

/** Simbolo de genero: FEMALE -> ♀, MALE -> ♂, demais -> ⚧. */
export function genderSymbol(gender: string | null | undefined): string {
  return genderEmoji(gender);
}
