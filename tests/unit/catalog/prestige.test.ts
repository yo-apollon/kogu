import { describe, expect, it } from "vitest";
import {
  aetherFromPrestige,
  assignNicheTiers,
  computeFictionPrestige,
  mythicCap,
  parseThresholds,
  roleRank,
  spreadTiedPrices,
  storyScore,
  thresholdsFor,
  tierForPrestige,
  tierRank,
  type FictionMember,
} from "../../../src/catalog/prestige.js";
import { mulberry32, scoreCatalog, type ScoringInput, type ScoringOutput } from "../../../src/catalog/scoring.js";
import {
  ENTITY_TIERS,
  MYTHIC_CAP_MIN_NICHE_SIZE,
  PRESTIGE_THRESHOLDS,
  TIER_AETHER_BAND,
} from "../../../src/config/gacha.js";

const shuffle = <T>(arr: readonly T[], rng: () => number): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

describe("limiares de tier", () => {
  it("ficcao e pessoas usam os limiares da config", () => {
    expect(PRESTIGE_THRESHOLDS.fiction).toEqual({ MYTHIC: 94, LEGENDARY: 82, EPIC: 66, RARE: 45 });
    expect(PRESTIGE_THRESHOLDS.people).toEqual({ MYTHIC: 95, LEGENDARY: 85, EPIC: 70, RARE: 50 });
    expect(tierForPrestige(94, "fiction")).toBe("MYTHIC");
    expect(tierForPrestige(93.99, "fiction")).toBe("LEGENDARY");
    expect(tierForPrestige(94, "people_sport")).toBe("LEGENDARY");
    expect(tierForPrestige(95, "people_music")).toBe("MYTHIC");
    expect(tierForPrestige(44.9, "anime" as never)).toBe("COMMON");
    expect(tierForPrestige(45, "fiction")).toBe("RARE");
    expect(tierForPrestige(50, "people_creator")).toBe("RARE");
    expect(tierForPrestige(49.9, "people_creator")).toBe("COMMON");
  });

  it("perfil de nicho: so aceita limiares validos e decrescentes", () => {
    expect(parseThresholds({ MYTHIC: 90, LEGENDARY: 80, EPIC: 60, RARE: 40 })).toEqual({
      MYTHIC: 90,
      LEGENDARY: 80,
      EPIC: 60,
      RARE: 40,
    });
    expect(parseThresholds({ MYTHIC: 80, LEGENDARY: 90, EPIC: 60, RARE: 40 })).toBeNull();
    expect(parseThresholds({ MYTHIC: 90 })).toBeNull();
    expect(parseThresholds(null)).toBeNull();
  });
});

describe("prestigio computado de ficcao (invariante 2: coerencia na serie)", () => {
  function randomNiche(seed: number): FictionMember[] {
    const rng = mulberry32(seed);
    const members: FictionMember[] = [];
    let id = 1;
    const seriesCount = 3 + Math.floor(rng() * 12);
    for (let s = 1; s <= seriesCount; s++) {
      const size = 1 + Math.floor(rng() * 9);
      const noSignal = rng() < 0.15;
      for (let k = 0; k < size; k++) {
        const r = rng();
        members.push({
          id: id++,
          seriesId: s,
          role: r < 0.3 ? "MAIN" : r < 0.7 ? "SUPPORTING" : r < 0.85 ? "BACKGROUND" : null,
          fame: noSignal ? 0 : Math.round(rng() * 100) / 100,
          favorites: noSignal ? 0 : Math.floor(rng() * 5000),
        });
      }
    }
    for (let k = 0; k < 5; k++) {
      members.push({ id: id++, seriesId: null, role: null, fame: rng(), favorites: 10 + k });
    }
    return members;
  }

  it("papel maior nunca fica abaixo de papel menor, ninguem passa do protagonista, 0..100 (200 nichos)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const members = randomNiche(seed);
      const out = computeFictionPrestige(members);
      expect(out.size).toBe(members.length);
      const bySeries = new Map<number, FictionMember[]>();
      for (const m of members) {
        expect(out.get(m.id)!).toBeGreaterThanOrEqual(0);
        expect(out.get(m.id)!).toBeLessThanOrEqual(100);
        if (m.seriesId === null) continue;
        bySeries.set(m.seriesId, [...(bySeries.get(m.seriesId) ?? []), m]);
      }
      for (const group of bySeries.values()) {
        for (const a of group) {
          for (const b of group) {
            if (roleRank(a.role) > roleRank(b.role)) {
              expect(out.get(a.id)!, `seed ${seed}`).toBeGreaterThanOrEqual(out.get(b.id)!);
            }
          }
        }
        // O protagonista (maior historia) e o teto da serie.
        const top = Math.max(...group.map((m) => out.get(m.id)!));
        const protagonist = [...group]
          .sort((x, y) => y.fame - x.fame || y.favorites - x.favorites || x.id - y.id);
        expect(top).toBeGreaterThanOrEqual(out.get(protagonist[0].id)! - 1e-9);
      }
    }
  });

  it("obra sem sinal fica limitada a 40", () => {
    const out = computeFictionPrestige([
      { id: 1, seriesId: 7, role: "MAIN", fame: 0, favorites: 0 },
      { id: 2, seriesId: 7, role: "SUPPORTING", fame: 0, favorites: 0 },
      { id: 3, seriesId: null, role: null, fame: 0, favorites: 0 },
    ]);
    for (const v of out.values()) expect(v).toBeLessThanOrEqual(40);
    expect(out.get(1)!).toBeGreaterThanOrEqual(out.get(2)!);
  });

  it("formula: 40% fama, 30% serie, 30% historia (sem regras de coerencia ativas)", () => {
    // Uma serie so, um personagem MAIN em 1o: historia 1; serie unica = percentil 0.
    const out = computeFictionPrestige([{ id: 1, seriesId: 1, role: "MAIN", fame: 0.5, favorites: 100 }]);
    expect(out.get(1)).toBeCloseTo(100 * (0.4 * 0.5 + 0.3 * 0 + 0.3 * 1), 2);
    expect(storyScore("MAIN", 1)).toBe(1);
    expect(storyScore("SUPPORTING", 1)).toBe(0.55);
    expect(storyScore(null, 1)).toBe(0.4);
    expect(storyScore("MAIN", 3)).toBeCloseTo(1 / 1.7, 6);
  });

  it("e deterministico e independe da ordem de entrada", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const members = randomNiche(seed);
      const a = computeFictionPrestige(members);
      const b = computeFictionPrestige(shuffle(members, mulberry32(seed * 7)));
      expect([...a].sort((x, y) => x[0] - y[0])).toEqual([...b].sort((x, y) => x[0] - y[0]));
    }
  });
});

describe("quotas por nicho", () => {
  const cards = (values: number[]) => values.map((prestige, i) => ({ id: i + 1, prestige }));

  it("nicho pequeno (< 50): mitica e so quem atinge o limiar, sem teto percentual", () => {
    expect(MYTHIC_CAP_MIN_NICHE_SIZE).toBe(50);
    const tiers = assignNicheTiers(cards([100, 98.8, 84.9, 80, 67, 54, 44]), "people_sport");
    expect(tiers.get(1)).toBe("MYTHIC");
    expect(tiers.get(2)).toBe("MYTHIC");
    expect(tiers.get(3)).toBe("EPIC");
    expect(tiers.get(7)).toBe("COMMON");
  });

  it("nicho grande (>= 50): no maximo ceil(1%) de miticas, excedente vira LEGENDARY pela ordem", () => {
    const values = [99, 98, 97, ...Array.from({ length: 147 }, (_, i) => 60 - i * 0.1)];
    expect(mythicCap(150)).toBe(2);
    expect(mythicCap(49)).toBe(49);
    const tiers = assignNicheTiers(cards(values), "fiction");
    expect(tiers.get(1)).toBe("MYTHIC");
    expect(tiers.get(2)).toBe("MYTHIC");
    expect(tiers.get(3)).toBe("LEGENDARY");
  });

  it("piso de quantidade: sem ninguem no limiar mitico a melhor sobe ate LEGENDARY, nunca MYTHIC", () => {
    const tiers = assignNicheTiers(cards([70, 60, 50, 10]), "fiction");
    expect(tiers.get(1)).toBe("LEGENDARY");
    expect(tiers.get(2)).toBe("RARE");
    // Quem ja e LEGENDARY nao muda; se alguem e MYTHIC o piso nao age.
    expect(assignNicheTiers(cards([90, 60]), "fiction").get(1)).toBe("LEGENDARY");
    expect(assignNicheTiers(cards([97, 90, 60]), "fiction").get(2)).toBe("LEGENDARY");
    expect(assignNicheTiers(cards([97, 60]), "fiction").get(2)).toBe("RARE");
  });

  it("piso por curadoria: o tier final nunca fica abaixo do piso", () => {
    const tiers = assignNicheTiers(
      [
        { id: 1, prestige: 99 },
        { id: 2, prestige: 44.8, floor: "RARE" },
        { id: 3, prestige: 33, floor: "EPIC" },
        { id: 4, prestige: 30 },
      ],
      "people_sport"
    );
    expect(tiers.get(2)).toBe("RARE");
    expect(tiers.get(3)).toBe("EPIC");
    expect(tiers.get(4)).toBe("COMMON");
    // O preco usa a faixa do tier final com t no minimo.
    expect(aetherFromPrestige("EPIC", 33, "people_sport")).toBe(TIER_AETHER_BAND.EPIC.min);
  });

  it("e estavel: reordenar a entrada nao muda nenhum tier (invariante 3)", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = mulberry32(seed);
      const n = 1 + Math.floor(rng() * 120);
      const list = Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        prestige: Math.round(rng() * 10000) / 100,
        tie: Math.floor(rng() * 5),
      }));
      const a = assignNicheTiers(list, "fiction");
      const b = assignNicheTiers(shuffle(list, mulberry32(seed + 1)), "fiction");
      expect([...a].sort((x, y) => x[0] - y[0])).toEqual([...b].sort((x, y) => x[0] - y[0]));
    }
  });
});

describe("preco pelo prestigio", () => {
  it("e monotonico em todo o intervalo 0..100 e fica na faixa do tier", () => {
    for (const family of ["fiction", "people"] as const) {
      const th = thresholdsFor(family);
      for (const tier of ENTITY_TIERS) {
        let last = -1;
        for (let p = 0; p <= 100; p += 0.25) {
          const v = aetherFromPrestige(tier, p, th);
          expect(v).toBeGreaterThanOrEqual(TIER_AETHER_BAND[tier].min);
          expect(v).toBeLessThanOrEqual(TIER_AETHER_BAND[tier].max);
          expect(v).toBeGreaterThanOrEqual(last);
          last = v;
        }
      }
    }
  });

  it("desempate por semente so entre prestigio e tier identicos; nunca reordena prestigios distintos", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = mulberry32(seed);
      const th = thresholdsFor("fiction");
      const cards = Array.from({ length: 60 }, (_, i) => {
        const prestige = Math.round(rng() * 20) * 5 + (rng() < 0.3 ? 0.01 : 0);
        const tier = tierForPrestige(prestige, th);
        return { id: i + 1, tier, prestige, aether: aetherFromPrestige(tier, prestige, th), seed: Math.floor(rng() * 1e6) };
      });
      const spread = spreadTiedPrices(cards);
      for (const a of cards) {
        for (const b of cards) {
          if (a.prestige > b.prestige) expect(spread.get(a.id)!).toBeGreaterThanOrEqual(spread.get(b.id)!);
        }
        const band = TIER_AETHER_BAND[a.tier];
        expect(spread.get(a.id)!).toBeGreaterThanOrEqual(band.min);
        expect(spread.get(a.id)!).toBeLessThanOrEqual(band.max);
      }
    }
  });
});

describe("scoreCatalog com nichos (invariantes 1, 3, 4 e 5 do spec)", () => {
  function randomCatalog(seed: number): ScoringInput[] {
    const rng = mulberry32(seed);
    const keys = [
      { key: "anime", family: "fiction" as const },
      { key: "game", family: "fiction" as const },
      { key: "sport_football", family: "people_sport" as const },
    ];
    const inputs: ScoringInput[] = [];
    let id = 1;
    for (const niche of keys) {
      const n = 3 + Math.floor(rng() * (niche.key === "anime" ? 160 : 40));
      for (let i = 0; i < n; i++) {
        const curated = niche.family !== "fiction" || rng() < 0.4;
        inputs.push({
          id: id++,
          statsSeed: Math.floor(rng() * 2e9),
          sources: ["ANILIST"],
          favorites: { ANILIST: Math.floor(rng() * 20000) },
          niche,
          seriesId: 1 + Math.floor(rng() * 12),
          seriesRole: rng() < 0.3 ? "MAIN" : rng() < 0.6 ? "SUPPORTING" : null,
          ...(curated
            ? { prestige: Math.round(rng() * 10000) / 100, prestigeSource: "CURATED" as const }
            : {}),
        });
      }
    }
    return inputs;
  }

  const byId = (out: ScoringOutput[]) => new Map(out.map((o) => [o.id, o]));

  it("monotonia de tier e preco, faixa de Eter e teto de miticas (150 catalogos aleatorios)", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const inputs = randomCatalog(seed);
      const out = scoreCatalog(inputs);
      const map = byId(out);
      expect(out).toHaveLength(inputs.length);
      const perNiche = new Map<string, ScoringInput[]>();
      for (const e of inputs) perNiche.set(e.niche!.key, [...(perNiche.get(e.niche!.key) ?? []), e]);
      for (const [key, list] of perNiche) {
        const rows = list.map((e) => ({ e, o: map.get(e.id)! }));
        for (const { o } of rows) {
          expect(o.prestige).not.toBeNull();
          expect(o.baseAether).toBeGreaterThanOrEqual(TIER_AETHER_BAND[o.tier].min);
          expect(o.baseAether).toBeLessThanOrEqual(TIER_AETHER_BAND[o.tier].max);
        }
        // Varredura: cada carta nao pode superar tier/preco minimo de quem tem prestigio estritamente maior.
        const desc = [...rows].sort((x, y) => y.o.prestige! - x.o.prestige!);
        let minTier = 99;
        let minPrice = Infinity;
        for (let i = 0; i < desc.length; ) {
          let j = i;
          while (j + 1 < desc.length && desc[j + 1].o.prestige === desc[i].o.prestige) j++;
          for (let k = i; k <= j; k++) {
            expect(tierRank(desc[k].o.tier), `${key} seed ${seed}`).toBeLessThanOrEqual(minTier);
            expect(desc[k].o.baseAether, `${key} seed ${seed}`).toBeLessThanOrEqual(minPrice);
          }
          for (let k = i; k <= j; k++) {
            minTier = Math.min(minTier, tierRank(desc[k].o.tier));
            minPrice = Math.min(minPrice, desc[k].o.baseAether);
          }
          i = j + 1;
        }
        const mythics = rows.filter((r) => r.o.tier === "MYTHIC").length;
        expect(mythics).toBeLessThanOrEqual(mythicCap(rows.length));
        // Piso de quantidade: todo nicho tem topo.
        expect(rows.some((r) => tierRank(r.o.tier) >= tierRank("LEGENDARY"))).toBe(true);
      }
    }
  });

  it("estabilidade: reordenar a entrada ou rodar de novo nao muda nenhum tier nem preco", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const inputs = randomCatalog(seed);
      const a = scoreCatalog(inputs);
      const b = scoreCatalog(shuffle(inputs, mulberry32(seed + 99)));
      expect(a).toEqual(b);
      expect(scoreCatalog(inputs)).toEqual(a);
    }
  });

  it("popularity_rank continua unico (1..N) e CURATED/OVERRIDE vence COMPUTED", () => {
    const inputs = randomCatalog(5);
    const out = scoreCatalog(inputs);
    const ranks = out.map((o) => o.popularityRank!).sort((x, y) => x - y);
    expect(ranks).toEqual(Array.from({ length: inputs.length }, (_, i) => i + 1));
    const map = byId(out);
    for (const e of inputs.filter((x) => x.prestige != null)) {
      expect(map.get(e.id)!.prestige).toBe(e.prestige);
      expect(map.get(e.id)!.prestigeSource).toBe("CURATED");
    }
    const computed = inputs.filter((x) => x.prestige == null);
    expect(computed.length).toBeGreaterThan(0);
    for (const e of computed) expect(map.get(e.id)!.prestigeSource).toBe("COMPUTED");
  });

  it("COMPUTED gravado e ignorado (recalcula); pessoas sem curadoria e entidades sem nicho caem no legado", () => {
    const out = scoreCatalog([
      {
        id: 1, statsSeed: 1, sources: ["ANILIST"], favorites: { ANILIST: 10 },
        niche: { key: "anime", family: "fiction" }, prestige: 99, prestigeSource: "COMPUTED", seriesId: 1, seriesRole: "MAIN",
      },
      { id: 2, statsSeed: 2, sources: ["ANILIST"], favorites: { ANILIST: 50 }, niche: { key: "sport_football", family: "people_sport" } },
      { id: 3, statsSeed: 3, sources: ["ANILIST"], favorites: { ANILIST: 90 } },
    ]);
    const map = byId(out);
    expect(map.get(1)!.prestige).not.toBe(99);
    expect(map.get(2)!.prestige).toBeNull();
    expect(map.get(3)!.prestige).toBeNull();
    expect(map.get(3)!.popularityScore).toBe(1);
  });

  it("piso de curadoria sobe o tier e o preco fica no minimo da faixa do tier final", () => {
    const people = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      statsSeed: i + 1,
      sources: [] as string[],
      favorites: {},
      niche: { key: "sport_football", family: "people_sport" as const },
      prestige: [100, 98, 84, 60, 44.8, 20][i],
      prestigeSource: "CURATED" as const,
      tierFloor: i === 4 ? ("EPIC" as const) : i === 5 ? ("RARE" as const) : null,
    }));
    const map = byId(scoreCatalog(people));
    expect(map.get(5)!.tier).toBe("EPIC");
    expect(map.get(5)!.baseAether).toBe(TIER_AETHER_BAND.EPIC.min);
    expect(map.get(6)!.tier).toBe("RARE");
    expect(map.get(1)!.tier).toBe("MYTHIC");
    expect(map.get(2)!.tier).toBe("MYTHIC");
  });

  it("ancora de edicao usa o prestigio para posicionar o preco; edicoes mantem tier fixo", () => {
    const base = { sources: [] as string[], favorites: {}, niche: { key: "anime", family: "fiction" as const } };
    const out = scoreCatalog([
      { ...base, id: 1, statsSeed: 1, edition: "BASIC", prestige: 90, prestigeSource: "CURATED" },
      { ...base, id: 2, statsSeed: 2, edition: "EPIC", parentId: 1, niche: null },
      { ...base, id: 3, statsSeed: 3, edition: "BASIC", prestige: 10, prestigeSource: "CURATED" },
      { ...base, id: 4, statsSeed: 4, edition: "EPIC", parentId: 3, niche: null },
    ]);
    const map = byId(out);
    expect(map.get(2)!.tier).toBe("EPIC");
    expect(map.get(2)!.popularityScore).toBeCloseTo(0.9, 5);
    expect(map.get(2)!.baseAether).toBeGreaterThan(map.get(4)!.baseAether);
    expect(map.get(1)!.prestige).toBe(90);
    expect(map.get(2)!.prestige).toBeNull();
  });
});
