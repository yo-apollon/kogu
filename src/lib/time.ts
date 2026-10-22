/**
 * Janelas de tempo discretas usadas para resetar rolls e pactos sem cron.
 * janela = floor((epochMin - offsetMin) / intervalMin)
 */

export function currentWindow(intervalMin: number, offsetMin = 0, now: number = Date.now()): number {
  const epochMin = Math.floor(now / 60_000);
  return Math.floor((epochMin - offsetMin) / intervalMin);
}

/** Instante (ms epoch) em que a janela seguinte comeca. */
export function nextWindowStart(intervalMin: number, offsetMin = 0, now: number = Date.now()): number {
  const w = currentWindow(intervalMin, offsetMin, now);
  return ((w + 1) * intervalMin + offsetMin) * 60_000;
}

/** Marca de tempo relativa do Discord, ex.: <t:1700000000:R>. */
export function discordRelative(msEpoch: number): string {
  return `<t:${Math.floor(msEpoch / 1000)}:R>`;
}

export function discordTime(msEpoch: number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "f"): string {
  return `<t:${Math.floor(msEpoch / 1000)}:${style}>`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
