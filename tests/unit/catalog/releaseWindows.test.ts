import { describe, expect, it } from "vitest";
import { currentBoost, shouldOpenWindow } from "../../../src/catalog/releaseWindows.js";

const DAY = 86_400_000;
const start = new Date("2026-01-01T00:00:00Z");
const w = { startsAt: start, endsAt: new Date(start.getTime() + 30 * DAY), boost: 3 };

describe("currentBoost", () => {
  it("decai linearmente de boost ate 1", () => {
    expect(currentBoost(w, start)).toBe(3);
    expect(currentBoost(w, new Date(start.getTime() + 15 * DAY))).toBeCloseTo(2);
    expect(currentBoost(w, w.endsAt)).toBe(1);
    expect(currentBoost(w, new Date(w.endsAt.getTime() + DAY))).toBe(1);
  });
  it("antes do inicio vale cheio; fechada vale 1", () => {
    expect(currentBoost(w, new Date(start.getTime() - DAY))).toBe(3);
    expect(currentBoost({ ...w, closedAt: start }, start)).toBe(1);
  });
});

describe("shouldOpenWindow", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  it("ultimos 30 dias e +7d", () => {
    expect(shouldOpenWindow({ startDate: new Date(now.getTime() - 10 * DAY) }, now)).toBe(true);
    expect(shouldOpenWindow({ startDate: new Date(now.getTime() - 40 * DAY) }, now)).toBe(false);
    expect(shouldOpenWindow({ startDate: new Date(now.getTime() + 5 * DAY) }, now)).toBe(true);
    expect(shouldOpenWindow({ startDate: new Date(now.getTime() + 20 * DAY) }, now)).toBe(false);
    expect(shouldOpenWindow({}, now)).toBe(false);
  });
});
