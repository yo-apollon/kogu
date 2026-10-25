/** Formatadores baseados em Intl. Puros: recebem o locale por parametro. */

export type FormatLocale = string;

const AETHER_LABEL: Record<string, string> = { "pt-BR": "Éter", "en-US": "Aether" };

export function formatNumber(
  value: number | bigint,
  locale: FormatLocale = "pt-BR",
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCompact(value: number | bigint, locale: FormatLocale = "pt-BR"): string {
  return formatNumber(value, locale, { notation: "compact", maximumFractionDigits: 1 });
}

export function formatPercent(fraction: number, locale: FormatLocale = "pt-BR", digits = 1): string {
  return formatNumber(fraction, locale, { style: "percent", maximumFractionDigits: digits });
}

export function formatAether(
  value: number | bigint,
  locale: FormatLocale = "pt-BR",
  opts: { compact?: boolean; withUnit?: boolean } = {},
): string {
  const { compact = false, withUnit = true } = opts;
  const num = compact ? formatCompact(value, locale) : formatNumber(value, locale);
  return withUnit ? `${num} ${AETHER_LABEL[locale] ?? AETHER_LABEL["pt-BR"]}` : num;
}

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** "ha 3 horas" / "em 2 dias". `now` injetavel para testes. */
export function formatRelative(
  date: Date | number | string,
  locale: FormatLocale = "pt-BR",
  now: Date | number = Date.now(),
): string {
  const target = new Date(date).getTime();
  const diffSec = Math.round((target - new Date(now).getTime()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (abs >= size || unit === "second") {
      return rtf.format(Math.trunc(diffSec / size), unit);
    }
  }
  return rtf.format(0, "second");
}

/** Duracao em segundos -> "1 h 05 min" (ate duas unidades significativas). */
export function formatDuration(totalSeconds: number, locale: FormatLocale = "pt-BR"): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  const parts: Array<[number, Intl.NumberFormatOptions["unit"]]> = [
    [Math.floor(secs / 86_400), "day"],
    [Math.floor((secs % 86_400) / 3_600), "hour"],
    [Math.floor((secs % 3_600) / 60), "minute"],
    [secs % 60, "second"],
  ];
  const nonZero = parts.filter(([n]) => n > 0).slice(0, 2);
  if (nonZero.length === 0) nonZero.push([0, "second"]);
  return nonZero
    .map(([n, unit]) =>
      new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(n),
    )
    .join(" ");
}

export function formatDate(
  date: Date | number | string,
  locale: FormatLocale = "pt-BR",
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(locale, options).format(new Date(date));
}
