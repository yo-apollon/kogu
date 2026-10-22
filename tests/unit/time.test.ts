import { describe, expect, it } from "vitest";
import { currentWindow, nextWindowStart } from "../../src/lib/time.js";

describe("janelas de tempo", () => {
  const hour = 60;

  it("mesma janela dentro do intervalo", () => {
    const base = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(currentWindow(hour, 0, base)).toBe(currentWindow(hour, 0, base + 59 * 60_000));
  });

  it("janela avanca ao cruzar o intervalo", () => {
    const base = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(currentWindow(hour, 0, base + 60 * 60_000)).toBe(currentWindow(hour, 0, base) + 1);
  });

  it("nextWindowStart cai exatamente no inicio da proxima janela", () => {
    const now = Date.UTC(2026, 0, 1, 10, 25, 0);
    const next = nextWindowStart(hour, 0, now);
    expect(next).toBe(Date.UTC(2026, 0, 1, 11, 0, 0));
    expect(currentWindow(hour, 0, next)).toBe(currentWindow(hour, 0, now) + 1);
  });

  it("offset desloca o reset", () => {
    const now = Date.UTC(2026, 0, 1, 10, 25, 0);
    const next = nextWindowStart(hour, 30, now);
    expect(next).toBe(Date.UTC(2026, 0, 1, 10, 30, 0));
  });
});
