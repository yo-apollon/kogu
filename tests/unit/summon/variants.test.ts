import { describe, expect, it } from "vitest";
import {
  calculateAetherValue,
  createSeededRng,
  orbReward,
  pactAetherValue,
  rollVariant,
} from "../../../src/modules/summon/variants.js";

// Copia literal de calculateAetherValue em src/engine/summonEngine.ts (codigo antigo, intocado).
function legacyCalculateAetherValue(baseAether: number, variant: string, awakeningKeys = 0) {
  const safeBase = Number(baseAether) || 150;
  let multiplier = 1;
  if (variant === "FOIL") multiplier = 1.25;
  if (variant === "HOLO") multiplier = 1.75;
  if (variant === "ASTRAL") multiplier = 4.0;
  const keys = Number(awakeningKeys) || 0;
  if (keys >= 2) multiplier += 0.1;
  if (keys >= 4) multiplier += 0.1;
  if (keys >= 5) multiplier += 0.1;
  if (keys >= 7) multiplier += 0.1;
  if (keys >= 8) multiplier += 0.1;
  if (keys >= 9) multiplier += 0.1;
  if (keys >= 11) multiplier += (keys - 10) * 0.05;
  return Math.round(safeBase * multiplier);
}

describe("calculateAetherValue", () => {
  it("e identica a formula antiga em toda a grade", () => {
    for (const base of [0, 1, 40, 99, 150, 333, 777, 1200, NaN]) {
      for (const variant of ["STANDARD", "FOIL", "HOLO", "ASTRAL", "X"]) {
        for (let keys = 0; keys <= 60; keys++) {
          expect(calculateAetherValue(base, variant, keys)).toBe(
            legacyCalculateAetherValue(base, variant, keys)
          );
        }
      }
    }
  });
});

describe("rollVariant", () => {
  it("segue 3% ASTRAL, 9% HOLO, 20% FOIL", () => {
    const rng = createSeededRng(42);
    const n = 200_000;
    const c: Record<string, number> = { STANDARD: 0, FOIL: 0, HOLO: 0, ASTRAL: 0 };
    for (let i = 0; i < n; i++) c[rollVariant(rng)]++;
    expect(c.ASTRAL / n).toBeCloseTo(0.03, 2);
    expect(c.HOLO / n).toBeCloseTo(0.09, 2);
    expect(c.FOIL / n).toBeCloseTo(0.2, 2);
    expect(c.STANDARD / n).toBeCloseTo(0.68, 2);
  });

  it("limiares exatos", () => {
    expect(rollVariant(() => 0.0299)).toBe("ASTRAL");
    expect(rollVariant(() => 0.03)).toBe("HOLO");
    expect(rollVariant(() => 0.1199)).toBe("HOLO");
    expect(rollVariant(() => 0.12)).toBe("FOIL");
    expect(rollVariant(() => 0.3199)).toBe("FOIL");
    expect(rollVariant(() => 0.32)).toBe("STANDARD");
  });
});

describe("orbe e valor do pacto", () => {
  it("orbReward tem minimo 25 e 20% do valor", () => {
    expect(orbReward(10)).toBe(25);
    expect(orbReward(1000)).toBe(200);
  });
  it("pactAetherValue nunca fica abaixo do registrado", () => {
    expect(pactAetherValue(100, "STANDARD", 1, 500)).toBe(500);
    expect(pactAetherValue(1000, "STANDARD", 1, 500)).toBe(1000);
  });
});
