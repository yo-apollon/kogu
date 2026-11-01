import { describe, expect, it } from "vitest";
import { baseAetherForTier, positionWithinTier, scoreCatalog, tierForPosition } from "../../../src/catalog/scoring.js";
import { ENTITY_TIERS, TIER_AETHER_BAND, TIER_WEIGHT } from "../../../src/config/gacha.js";
import { ORB_MAX_REWARD, orbReward } from "../../../src/modules/summon/variants.js";

describe("faixas de Eter por tier", () => {
  it("as faixas nao se sobrepoem e crescem com a raridade", () => {
    const order = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const;
    for (let i = 1; i < order.length; i++) {
      expect(TIER_AETHER_BAND[order[i]].min).toBeGreaterThan(TIER_AETHER_BAND[order[i - 1]].max);
    }
  });

  it("RARE ou acima comecam em 1000 de Eter", () => {
    for (const tier of ["RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const) {
      expect(TIER_AETHER_BAND[tier].min).toBeGreaterThanOrEqual(1000);
    }
  });

  it("o valor fica sempre dentro da faixa do tier, para qualquer posicao e semente", () => {
    for (const tier of ENTITY_TIERS) {
      const { min, max } = TIER_AETHER_BAND[tier];
      for (let seed = 0; seed < 300; seed += 7) {
        for (const t of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
          const v = baseAetherForTier(tier, t, seed);
          expect(v).toBeGreaterThanOrEqual(min);
          expect(v).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("melhor posicao no tier vale mais; mesma carta (semente) e deterministica", () => {
    expect(baseAetherForTier("EPIC", 1, 42)).toBeGreaterThan(baseAetherForTier("EPIC", 0.2, 42));
    expect(baseAetherForTier("EPIC", 0.6, 99)).toBe(baseAetherForTier("EPIC", 0.6, 99));
  });

  it("cartas vizinhas nao empatam de preco por acaso (variedade)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 40; i++) values.add(baseAetherForTier("RARE", 1 - i / 40, i * 7919));
    expect(values.size).toBeGreaterThan(35);
  });

  it("positionWithinTier vai de 1 (topo do tier) a 0 (fim do tier)", () => {
    const total = 1000;
    let lastTier = tierForPosition(0, total);
    expect(positionWithinTier(0, total)).toBe(1);
    for (let i = 1; i < total; i++) {
      const tier = tierForPosition(i, total);
      if (tier !== lastTier) expect(positionWithinTier(i, total)).toBe(1);
      lastTier = tier;
    }
    expect(positionWithinTier(total - 1, total)).toBe(0);
  });

  it("scoreCatalog: cada tier cai na sua faixa e MYTHIC fica acima de 25 mil", () => {
    const inputs = Array.from({ length: 300 }, (_, i) => ({
      id: i + 1,
      favorites: { ANILIST: 1000 - i },
      sources: ["ANILIST"],
      statsSeed: i * 131 + 7,
    }));
    const out = scoreCatalog(inputs as never);
    for (const row of out) {
      const band = TIER_AETHER_BAND[row.tier];
      expect(row.baseAether).toBeGreaterThanOrEqual(band.min);
      expect(row.baseAether).toBeLessThanOrEqual(band.max);
    }
    expect(out[0].tier).toBe("MYTHIC");
    expect(out[0].baseAether).toBeGreaterThanOrEqual(25_000);
  });
});

describe("sorteio e economia", () => {
  it("quanto mais rara, menor o peso de sorteio", () => {
    expect(TIER_WEIGHT.COMMON).toBeGreaterThan(TIER_WEIGHT.RARE);
    expect(TIER_WEIGHT.RARE).toBeGreaterThan(TIER_WEIGHT.EPIC);
    expect(TIER_WEIGHT.EPIC).toBeGreaterThan(TIER_WEIGHT.LEGENDARY);
    expect(TIER_WEIGHT.LEGENDARY).toBeGreaterThan(TIER_WEIGHT.MYTHIC);
  });

  it("premio do orbe tem teto", () => {
    expect(orbReward(500)).toBe(100);
    expect(orbReward(1_000_000)).toBe(ORB_MAX_REWARD);
  });
});
