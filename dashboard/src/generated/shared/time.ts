// GERADO por scripts/sync-shared.mjs â€” NÃƒO EDITE
/**
 * Janelas de tempo discretas usadas para resetar rolls e pactos sem cron (PURO: copiado para a dashboard).
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

/**
 * Quantos itens da janela `window` ja foram usados dado o par gravado (storedWindow, storedUsed).
 * Janela gravada anterior a atual = contador vencido (0); igual ou posterior = vale o gravado.
 */
export function usedInWindow(storedWindow: number, storedUsed: number, window: number): number {
  return storedWindow >= window ? storedUsed : 0;
}