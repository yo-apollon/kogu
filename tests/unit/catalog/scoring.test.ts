import { describe, expect, it } from "vitest";
import {
  baseAetherFor,
  combineScore,
  distributeStats,
  mulberry32,
  percentiles,
  rollWeightFor,
  scoreCatalog,
  STAT_BUDGET,
  tierCutoffs,
  tierForPosition,
  type ScoringInput,
} from "../../../src/catalog/scoring.js";
import { AETHER_MIN, AETHER_RANGE, TIER_WEIGHT } from "../../../src/config/gacha.js";

describe("percentiles", () => {
  it("maior unico vale 1, menor 0, empates dividem", () => {
    expect(percentiles([10, 30, 20])).toEqual([0, 1, 0.5]);
    expect(percentiles([5, 5, 5])).toEqual([0, 0, 0]);
    expect(percentiles([7])).toEqual([0]);
    expect(percentiles([])).toEqual([]);
  });
});

describe("combineScore", () => {
  it("max + 0.02 por fonte adicional, teto 1", () => {
    expect(combineScore([0.5, 0.8], 2)).toBeCloseTo(0.82);
    expect(combineScore([0.5], 1)).toBe(0.5);
    expect(combineScore([0.99], 3)).toBe(1);
    expect(combineScore([], 0)).toBe(0);
  });
});

describe("tiers", () => {
  it("cortes cumulativos 1/5/15/40%", () => {
    expect(tierCutoffs(200)).toEqual({ MYTHIC: 2, LEGENDARY: 10, EPIC: 30, RARE: 80 });
    expect(tierCutoffs(1000)).toEqual({ MYTHIC: 10, LEGENDARY: 50, EPIC: 150, RARE: 400 });
  });
  it("tier por posicao", () => {
    const t = (i: number) => tierForPosition(i, 200);
    expect([t(0), t(1), t(2), t(9), t(10), t(29), t(30), t(79), t(80), t(199)]).toEqual([
      "MYTHIC", "MYTHIC", "LEGENDARY", "LEGENDARY", "EPIC", "EPIC", "RARE", "RARE", "COMMON", "COMMON",
    ]);
  });
});

describe("aether e peso", () => {
  it("base_aether = round(40 + 1160 * score^2)", () => {
    expect(baseAetherFor(0)).toBe(AETHER_MIN);
    expect(baseAetherFor(1)).toBe(AETHER_MIN + AETHER_RANGE);
    expect(baseAetherFor(0.5)).toBe(Math.round(40 + 1160 * 0.25));
  });
  it("roll_weight = tier * (1 + 0.15 * score)", () => {
    expect(rollWeightFor("COMMON", 0)).toBe(1);
    expect(rollWeightFor("MYTHIC", 1)).toBeCloseTo(TIER_WEIGHT.MYTHIC * 1.15);
  });
});

describe("stats", () => {
  it("mulberry32 e deterministico e em [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = [a(), a(), a()];
    expect(seq).toEqual([b(), b(), b()]);
    expect(seq.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(seq[0]);
  });
  it("mesma semente => mesma forma; tier so escala; nenhum stat zerado", () => {
    const common = distributeStats("COMMON", 123456);
    expect(distributeStats("COMMON", 123456)).toEqual(common);
    const mythic = distributeStats("MYTHIC", 123456);
    expect(mythic.baseAtk).toBeGreaterThan(common.baseAtk);
    expect(mythic.baseAtk / STAT_BUDGET.MYTHIC).toBeCloseTo(common.baseAtk / STAT_BUDGET.COMMON, 1);
    for (const v of Object.values(common)) expect(v).toBeGreaterThan(0);
  });
});

describe("scoreCatalog", () => {
  const inputs: ScoringInput[] = Array.from({ length: 200 }, (_, i) => ({
    id: i + 1,
    statsSeed: i * 7919 + 1,
    sources: ["ANILIST"],
    favorites: { ANILIST: (i + 1) * 10 },
  }));

  it("ranks 1..N unicos, ordenados por favoritos, tiers conforme percentis", () => {
    const out = scoreCatalog(inputs);
    expect(out).toHaveLength(200);
    expect(out.map((o) => o.popularityRank)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(out[0].id).toBe(200);
    const count = (t: string) => out.filter((o) => o.tier === t).length;
    expect([count("MYTHIC"), count("LEGENDARY"), count("EPIC"), count("RARE"), count("COMMON")]).toEqual([2, 8, 20, 50, 120]);
    expect(out[0].popularityScore).toBe(1);
    expect(out[199].popularityScore).toBe(0);
  });

  it("estavel: nova rodada com os mesmos dados da o mesmo resultado", () => {
    expect(scoreCatalog(inputs)).toEqual(scoreCatalog([...inputs].reverse()));
  });

  it("fonte adicional soma 0.02 e percentil e por fonte", () => {
    const out = scoreCatalog([
      { id: 1, statsSeed: 1, sources: ["ANILIST", "JIKAN"], favorites: { ANILIST: 10, JIKAN: 5 } },
      { id: 2, statsSeed: 2, sources: ["ANILIST"], favorites: { ANILIST: 100 } },
      { id: 3, statsSeed: 3, sources: ["IGDB"], favorites: { IGDB: 1 } },
      { id: 4, statsSeed: 4, sources: ["IGDB"], favorites: { IGDB: 2 } },
    ]);
    const by = new Map(out.map((o) => [o.id, o]));
    expect(by.get(2)!.popularityScore).toBe(1);
    expect(by.get(4)!.popularityScore).toBe(1);
    expect(by.get(1)!.popularityScore).toBeCloseTo(0.02);
  });
});
