import { describe, expect, it } from "vitest";
import { scoreCatalog, type ScoringInput } from "../../../src/catalog/scoring.js";
import {
  EDITION_LABEL,
  EDITION_TIER,
  ENTITY_EDITIONS,
  TIER_AETHER_BAND,
  TIER_WEIGHT,
} from "../../../src/config/gacha.js";
import { TIER_FRAME_COLOR } from "../../../src/canvas/theme/tiers.js";
import { t } from "../../../src/i18n/index.js";
import { TIER_COLORS, resolveCardEmbedColor } from "../../../src/ui/tokens.js";
import { buildSummonEmbed, type SummonView } from "../../../src/ui/summonEmbed.js";
import { createSeededRng } from "../../../src/modules/summon/variants.js";
import { buildPool, pickFromPool, type PoolRow } from "../../../src/modules/summon/pool.js";

const regulars: ScoringInput[] = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  statsSeed: i * 7919 + 1,
  sources: ["ANILIST"],
  favorites: { ANILIST: (i + 1) * 10 },
}));

/** Ancora BASIC + EPIC + MYTHIC de um personagem com `favs` favoritos. */
function family(baseId: number, favs: number): ScoringInput[] {
  return [
    { id: baseId, statsSeed: baseId * 31, sources: ["ANILIST"], favorites: { ANILIST: favs }, edition: "BASIC" },
    { id: baseId + 1, statsSeed: baseId * 31 + 1, sources: [], favorites: {}, edition: "EPIC", parentId: baseId },
    { id: baseId + 2, statsSeed: baseId * 31 + 2, sources: [], favorites: {}, edition: "MYTHIC", parentId: baseId },
  ];
}

describe("config de edicoes", () => {
  it("cada edicao tem raridade fixa e rotulo i18n nos dois idiomas", () => {
    expect(EDITION_TIER).toEqual({ BASIC: "COMMON", EPIC: "EPIC", MYTHIC: "MYTHIC" });
    for (const ed of ENTITY_EDITIONS) {
      expect(t(EDITION_LABEL[ed], "pt-BR")).not.toBe(EDITION_LABEL[ed]);
      expect(t(EDITION_LABEL[ed], "en-US")).not.toBe(EDITION_LABEL[ed]);
    }
    expect(t(EDITION_LABEL.MYTHIC, "pt-BR")).toBe("Edição Mítica");
    expect(t(EDITION_LABEL.MYTHIC, "en-US")).toBe("Mythic Edition");
  });
});

describe("scoreCatalog com edicoes", () => {
  const extra = [...family(1001, 1500), ...family(2001, 15), ...family(3001, 100000)];
  const all = [...regulars, ...extra];

  it("edicoes ficam na faixa do proprio tier, sem rank, e a ancora e COMMON", () => {
    const out = scoreCatalog(all);
    for (const e of extra) {
      const o = out.find((x) => x.id === e.id)!;
      const tier = EDITION_TIER[e.edition!];
      expect(o.tier).toBe(tier);
      expect(o.popularityRank).toBeNull();
      expect(o.baseAether).toBeGreaterThanOrEqual(TIER_AETHER_BAND[tier].min);
      expect(o.baseAether).toBeLessThanOrEqual(TIER_AETHER_BAND[tier].max);
      expect(o.rollWeight).toBeGreaterThan(TIER_WEIGHT[tier] * 0.999);
    }
    const mythic = out.find((x) => x.id === 3003)!;
    expect(mythic.baseAether).toBeGreaterThanOrEqual(25_000);
    expect(mythic.baseAether).toBeLessThanOrEqual(60_000);
    const basic = out.find((x) => x.id === 1001)!;
    expect(basic.baseAether).toBeGreaterThanOrEqual(80);
    expect(basic.baseAether).toBeLessThanOrEqual(800);
  });

  it("edicoes herdam o score da ancora e o personagem mais popular fica mais caro", () => {
    const out = scoreCatalog(all);
    const byId = (id: number) => out.find((x) => x.id === id)!;
    expect(byId(1002).popularityScore).toBe(byId(1001).popularityScore);
    expect(byId(1003).popularityScore).toBe(byId(1001).popularityScore);
    expect(byId(3003).popularityScore).toBeGreaterThan(byId(2003).popularityScore);
    expect(byId(3003).baseAether).toBeGreaterThan(byId(2003).baseAether);
    expect(byId(3001).popularityScore).toBe(1);
  });

  it("nao altera tiers, ranks nem precos das cartas comuns", () => {
    const without = scoreCatalog(regulars);
    const withEd = scoreCatalog(all).filter((o) => o.popularityRank !== null);
    expect(withEd).toEqual(without);
  });

  it("e deterministico (ordem de entrada nao importa)", () => {
    expect(scoreCatalog(all)).toEqual(scoreCatalog([...all].reverse()));
  });

  it("edicao sem ancora no conjunto usa score 0 e continua no tier fixo", () => {
    const [o] = scoreCatalog([{ id: 9, statsSeed: 5, sources: [], favorites: {}, edition: "MYTHIC", parentId: 777 }]);
    expect(o.tier).toBe("MYTHIC");
    expect(o.popularityScore).toBe(0);
    expect(o.baseAether).toBeGreaterThanOrEqual(25_000);
  });
});

describe("exibicao das edicoes", () => {
  const view = (edition: SummonView["edition"], tier: SummonView["tier"]): SummonView => ({
    name: "Goku",
    franchise: "Dragon Ball",
    gender: "MALE",
    universe: "ANIME",
    aetherValue: 1000,
    tier,
    edition,
    variant: "STANDARD",
    cardColor: resolveCardEmbedColor({ name: "Goku", franchise: "Dragon Ball", tier, edition, variant: "STANDARD" }),
  });

  it("o embed mostra o rotulo da edicao (so quando ha edicao)", () => {
    const mythic = buildSummonEmbed(view("MYTHIC", "MYTHIC"), { locale: "pt-BR" }).embed.toJSON();
    expect(mythic.description).toContain("Edição Mítica");
    const en = buildSummonEmbed(view("EPIC", "EPIC"), { locale: "en-US" }).embed.toJSON();
    expect(en.description).toContain("Epic Edition");
    const plain = buildSummonEmbed(view(null, "COMMON"), { locale: "pt-BR" }).embed.toJSON();
    expect(plain.description).not.toContain("Edição");
  });

  it("as tres edicoes ficam distintas na cor do embed e na moldura da arte", () => {
    const colors = [view("BASIC", "COMMON"), view("EPIC", "EPIC"), view("MYTHIC", "MYTHIC")].map((v) => v.cardColor);
    expect(new Set(colors).size).toBe(3);
    expect(colors).toEqual([TIER_COLORS.COMMON, TIER_COLORS.EPIC, TIER_COLORS.MYTHIC]);
    // Moldura da skin padrao: BASIC (COMMON) branca; EPIC e MYTHIC com cor propria igual a do embed.
    const hex = (n: number) => `#${n.toString(16).padStart(6, "0").toUpperCase()}`;
    expect(TIER_FRAME_COLOR.COMMON).toBeUndefined();
    expect(TIER_FRAME_COLOR.EPIC).toBe(hex(TIER_COLORS.EPIC));
    expect(TIER_FRAME_COLOR.MYTHIC).toBe(hex(TIER_COLORS.MYTHIC));
    expect(TIER_FRAME_COLOR.LEGENDARY).toBe(hex(TIER_COLORS.LEGENDARY));
  });
});

describe("pool de sorteio com edicoes", () => {
  it("EPIC e MYTHIC saem bem mais raramente que a BASIC (rng semeado)", () => {
    const scored = scoreCatalog([...family(10, 500)]);
    const w = (id: number) => scored.find((x) => x.id === id)!.rollWeight;
    const row = (id: number): PoolRow => ({
      id,
      universe: "ANIME",
      gender: "MALE",
      type: "CHARACTER",
      seriesId: null,
      franchiseId: null,
      adult: false,
      weight: w(id),
      window: null,
    });
    const pool = buildPool([row(10), row(11), row(12)]);
    const rng = createSeededRng(12345);
    const counts = new Map<number, number>();
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const r = pickFromPool(pool, {}, { rng, now: 0, boostEnabled: false });
      counts.set(r.id!, (counts.get(r.id!) ?? 0) + 1);
    }
    const basic = counts.get(10) ?? 0;
    const epic = counts.get(11) ?? 0;
    const mythic = counts.get(12) ?? 0;
    expect(basic).toBeGreaterThan(epic * 3);
    expect(epic).toBeGreaterThan(mythic * 5);
    expect(mythic).toBeGreaterThan(0);
    expect(mythic / N).toBeLessThan(0.03);
  });
});
