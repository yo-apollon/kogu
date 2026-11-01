import { describe, expect, it } from "vitest";
import {
  matchRecord,
  normalizeFiction,
  normalizePeople,
  parseArgs,
  reviewActor,
  type EntityRow,
} from "../../../src/scripts/importPrestige.js";
import { analyzePrestige, renderAuditMarkdown, type AuditRow } from "../../../src/scripts/auditPrestige.js";

const ent = (id: number, name: string, extra: Partial<EntityRow> = {}): EntityRow => ({
  id,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  name,
  nameNormalized: name.toLowerCase(),
  seriesTitle: null,
  franchiseName: null,
  nicheKey: null,
  prestige: null,
  prestigeSource: null,
  tierFloor: null,
  ...extra,
});

describe("importPrestige: normalizacao", () => {
  it("ficcao: usa prestigeProposal e valida faixa", () => {
    const [ok, bad] = normalizeFiction({
      characters: [
        { catalogId: 1, name: "Rem", series: "Re:ZERO", niche: "anime", prestigeProposal: 76, rationale: "x", reviewed: false },
        { name: "Zed", niche: "anime", prestigeProposal: 140 },
      ],
    });
    expect(ok).toMatchObject({ value: 76, source: "CURATED", catalogId: 1, reviewed: false, tierFloor: null });
    expect(ok.errors).toEqual([]);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("pessoas: piso RARE por padrao, EPIC se eliteActive, tierFloor explicito vence", () => {
    const rec = normalizePeople({
      people: [
        { slug: "a", name: "A", niche: "sport_football", prestigeProposal: 40 },
        { slug: "b", name: "B", niche: "sport_football", prestigeProposal: 40, eliteActive: true },
        { slug: "c", name: "C", niche: "sport_football", prestigeProposal: 40, eliteActive: true, tierFloor: "LEGENDARY" },
        { slug: "d", name: "D", niche: "sport_football", prestigeProposal: 40, tierFloor: "MYTHIC" },
      ],
    });
    expect(rec.map((r) => r.tierFloor)).toEqual(["RARE", "EPIC", "LEGENDARY", null]);
    expect(rec[3].errors[0]).toMatch(/tierFloor/);
  });

  it("override exige motivo e vira OVERRIDE", () => {
    const [ok, noReason] = normalizePeople({
      people: [
        { slug: "a", name: "A", niche: "music_pop", prestigeProposal: 70, override: 90, overrideReason: "decisao do dono" },
        { slug: "b", name: "B", niche: "music_pop", prestigeProposal: 70, override: 90 },
      ],
    });
    expect(ok).toMatchObject({ value: 90, source: "OVERRIDE", reason: "decisao do dono" });
    expect(ok.errors).toEqual([]);
    expect(noReason.errors.join()).toMatch(/overrideReason/);
  });

  it("revisao muda o ator da auditoria; argumentos", () => {
    const [r] = normalizePeople({ people: [{ slug: "a", name: "A", niche: "idol", prestigeProposal: 1, reviewed: true, reviewedBy: "dono" }] });
    expect(reviewActor(r, "catalog:prestige")).toBe("catalog:prestige:reviewed:dono");
    expect(reviewActor({ ...r, reviewed: false }, "x")).toBe("x:unreviewed");
    expect(parseArgs(["--apply", "--niche=idol"])).toMatchObject({ apply: true, niche: "idol" });
    expect(() => parseArgs(["--nada"])).toThrow();
  });
});

describe("importPrestige: casamento", () => {
  const [fic] = normalizeFiction({
    characters: [{ catalogId: 5, name: "Rem", series: "Re:ZERO", niche: "anime", prestigeProposal: 70 }],
  });

  it("catalogId so vale se o nome confere", () => {
    const rows = [ent(5, "Rem", { seriesTitle: "Re:ZERO" })];
    expect(matchRecord(fic, rows)).toMatchObject({ status: "matched", ids: [5], by: "catalogId+nome" });
    // id 5 e outra pessoa: cai para nome, e sem candidato fica nao casado.
    expect(matchRecord(fic, [ent(5, "Outra Pessoa")])).toEqual({ status: "unmatched" });
  });

  it("mesmo nome em series diferentes: usa a serie; sem diferenca fica ambiguo", () => {
    const rows = [
      ent(10, "Rem", { seriesTitle: "Outra Obra" }),
      ent(11, "Rem", { seriesTitle: "Re:ZERO -Starting Life in Another World-" }),
    ];
    const noId = { ...fic, catalogId: undefined };
    expect(matchRecord(noId, rows)).toMatchObject({ status: "matched", ids: [11] });
    const dup = [ent(10, "Rem", { seriesTitle: "Re:ZERO" }), ent(11, "Rem", { seriesTitle: "Re:ZERO" })];
    expect(matchRecord(noId, dup)).toMatchObject({ status: "ambiguous", candidates: [10, 11] });
  });

  it("pessoas: slug, alias, nome parcial (apelidos no nome do seed)", () => {
    const [p] = normalizePeople({
      people: [{ slug: "alex-pereira", name: "Alex Pereira", niche: "sport_mma", prestigeProposal: 70 }],
    });
    expect(matchRecord(p, [ent(1, "Alex Poatan Pereira (Chama)")])).toMatchObject({ status: "matched", ids: [1], by: "nome parcial" });
    const [w] = normalizePeople({
      people: [{ slug: "the-weeknd", name: "The Weeknd", niche: "music_pop", prestigeProposal: 60, aliasSlugs: ["the-weeknd-starboy"] }],
    });
    const rows = [ent(2, "The Weeknd"), { ...ent(3, "The Weeknd (Starboy)"), slug: "the-weeknd-starboy" }];
    const m = matchRecord(w, rows);
    expect(m).toMatchObject({ status: "matched" });
    expect(m.status === "matched" && m.ids.sort()).toEqual([2, 3]);
  });
});

function row(id: number, extra: Partial<AuditRow> = {}): AuditRow {
  return {
    id,
    slug: `e${id}`,
    name: `Carta ${id}`,
    nameNormalized: `carta ${id}`,
    nicheKey: "anime",
    nicheFamily: "fiction",
    prestige: 50,
    prestigeSource: "CURATED",
    tier: "RARE",
    baseAether: 1500,
    edition: null,
    parentId: null,
    seriesId: null,
    seriesTitle: null,
    role: null,
    tierFloor: null,
    lastActor: "catalog:prestige:reviewed:dono",
    ...extra,
  };
}

describe("auditPrestige", () => {
  const clean: AuditRow[] = [
    row(1, { prestige: 96, tier: "MYTHIC", baseAether: 40000, seriesId: 1, role: "MAIN" }),
    row(2, { prestige: 84, tier: "LEGENDARY", baseAether: 15000, seriesId: 1, role: "SUPPORTING" }),
    row(3, { prestige: 70, tier: "EPIC", baseAether: 5000, seriesId: 1, role: "SUPPORTING" }),
    row(4, { prestige: 50, tier: "RARE", baseAether: 1500 }),
    row(5, { prestige: 20, tier: "COMMON", baseAether: 300 }),
  ];

  it("cenario limpo: nenhuma violacao", () => {
    const r = analyzePrestige(clean);
    expect(r.violations).toEqual([]);
    expect(r.niches[0].top.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
    expect(r.niches[0].hasTop).toBe(true);
    expect(renderAuditMarkdown(r)).toContain("Nenhuma.");
  });

  it("cenario sujo: aponta inversao de tier, de preco, de papel, mitica demais, banda, sem nicho e sem revisao", () => {
    const dirty: AuditRow[] = [
      ...clean.slice(0, 3),
      row(4, { prestige: 50, tier: "LEGENDARY", baseAether: 1500 }), // tier acima de quem tem prestigio maior
      row(5, { prestige: 45, tier: "RARE", baseAether: 6000 }), // preco acima de quem tem prestigio maior (id 3 = 5000)
      row(6, { prestige: 97, tier: "MYTHIC", baseAether: 99999 }), // fora da banda
      row(7, { nicheKey: null, nicheFamily: null, prestige: null, prestigeSource: null }),
      row(8, { prestigeSource: "CURATED", lastActor: "catalog:prestige:unreviewed", prestige: 10, tier: "COMMON", baseAether: 100 }),
      row(9, { seriesId: 2, role: "MAIN", prestige: 30, tier: "COMMON", baseAether: 200 }),
      row(10, { seriesId: 2, role: "SUPPORTING", prestige: 35, tier: "COMMON", baseAether: 250 }),
      row(11, { name: "Gemea", nameNormalized: "gemea", prestige: 5, tier: "COMMON", baseAether: 90 }),
      row(12, { name: "Gemea", nameNormalized: "gemea", prestige: 5, tier: "COMMON", baseAether: 90 }),
    ];
    // 60 cartas para ativar o teto de 1% (maximo 1 mitica com 60 cartas): 3 miticas violam.
    const fill = Array.from({ length: 50 }, (_, i) => row(100 + i, { prestige: 1, tier: "COMMON", baseAether: 80 }));
    const r = analyzePrestige([...dirty, ...fill, row(200, { prestige: 98, tier: "MYTHIC", baseAether: 50000 })]);
    const kinds = new Set(r.violations.map((v) => v.kind));
    expect(kinds).toContain("TIER_INVERSION");
    expect(kinds).toContain("PRICE_INVERSION");
    expect(kinds).toContain("SERIES_ROLE");
    expect(kinds).toContain("MYTHIC_CAP");
    expect(kinds).toContain("BAND");
    expect(r.withoutNiche.map((c) => c.id)).toEqual([7]);
    expect(r.unreviewed.map((c) => c.id)).toContain(8);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].members.map((m) => m.id)).toEqual([11, 12]);
  });

  it("inversao causada por piso da curadoria nao e violacao", () => {
    const rows = [
      row(1, { prestige: 99, tier: "MYTHIC", baseAether: 50000, nicheKey: "sport_football", nicheFamily: "people_sport" }),
      row(2, { prestige: 60, tier: "RARE", baseAether: 1500, nicheKey: "sport_football", nicheFamily: "people_sport" }),
      row(3, { prestige: 40, tier: "EPIC", baseAether: 3000, tierFloor: "EPIC", nicheKey: "sport_football", nicheFamily: "people_sport" }),
    ];
    const r = analyzePrestige(rows);
    expect(r.violations).toEqual([]);
    expect(r.floorExceptions).toHaveLength(1);
  });

  it("nicho sem topo e sinalizado; nicho pequeno aceita varias miticas", () => {
    const small = Array.from({ length: 4 }, (_, i) =>
      row(i + 1, { nicheKey: "sport_football", nicheFamily: "people_sport", prestige: 99 - i, tier: "MYTHIC", baseAether: 50000 })
    );
    expect(analyzePrestige(small).violations).toEqual([]);
    const noTop = analyzePrestige([row(1), row(2, { prestige: 40, tier: "COMMON", baseAether: 100 })]);
    expect(noTop.niches[0].hasTop).toBe(false);
  });
});
