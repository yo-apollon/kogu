/**
 * Helpers de tempo. As janelas (currentWindow/nextWindowStart/usedInWindow) vivem em
 * src/shared/time.ts (copiado para a dashboard) e sao reexportadas aqui.
 */
export { currentWindow, nextWindowStart, usedInWindow } from "../shared/time.js";


/** Marca de tempo relativa do Discord, ex.: <t:1700000000:R>. */
export function discordRelative(msEpoch: number): string {
  return `<t:${Math.floor(msEpoch / 1000)}:R>`;
}

export function discordTime(msEpoch: number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "f"): string {
  return `<t:${Math.floor(msEpoch / 1000)}:${style}>`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
