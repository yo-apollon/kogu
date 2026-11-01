import { describe, expect, it } from "vitest";
import { buildAuditRows, summarize, toCsv, worstRows, type AuditInput } from "../../../src/scripts/auditCardArt.js";

const A = "https://s4.anilist.co/file/anilistcdn/character/large/b1-a.png";
const POSTER = "https://image.tmdb.org/t/p/w500/p.jpg";

function item(over: Partial<AuditInput>): AuditInput {
  return { name: "X", slug: "x", universe: "ANIME", series: "S", type: "CHARACTER", tier: "COMMON", imageUrl: A, ...over };
}

describe("auditCardArt", () => {
  const rows = buildAuditRows([
    item({ name: "Cloud", slug: "cloud", imageUrl: A }),
    item({ name: "Buster Sword", slug: "buster", type: "WEAPON", imageUrl: A, tier: "EPIC" }),
    item({ name: "Thanos", slug: "thanos", universe: "CINEMA", imageUrl: POSTER, tier: "MYTHIC" }),
    item({ name: "Mjolnir", slug: "mjolnir", type: "WEAPON", imageUrl: POSTER, tier: "LEGENDARY" }),
    item({ name: "Sem Arte", slug: "sem", imageUrl: null }),
  ]);

  it("classifica, conta nomes diferentes que dividem a URL e indica o emblema", () => {
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
    expect(by.cloud).toMatchObject({ kind: "CHARACTER", trusted: true, sharedWithOthers: 1, emblem: "" });
    expect(by.buster).toMatchObject({ trusted: false, sharedWithOthers: 1, emblem: "sword" });
    expect(by.thanos).toMatchObject({ kind: "POSTER", trusted: false, emblem: "character", sharedWithOthers: 1 });
    expect(by.mjolnir).toMatchObject({ emblem: "hammer" });
    expect(by.sem).toMatchObject({ kind: "MISSING", sharedWithOthers: 0, emblem: "character" });
  });

  it("nomes iguais (formas da mesma entidade) nao contam como compartilhamento", () => {
    const r = buildAuditRows([item({ name: "Levi", slug: "a" }), item({ name: "levi", slug: "b" })]);
    expect(r.every((x) => x.sharedWithOthers === 0)).toBe(true);
  });

  it("resumo por classificacao", () => {
    const s = summarize(rows);
    expect(s.total).toBe(5);
    expect(s.byKind).toEqual({ CHARACTER: 2, POSTER: 2, MISSING: 1 });
    expect(s).toMatchObject({ emblemCount: 4, itemEmblems: 2, characterEmblems: 2, sharedImages: 4 });
  });

  it("as piores vem primeiro (nao confiaveis, mais compartilhadas, tier alto)", () => {
    const w = worstRows(rows, 2);
    expect(w).toHaveLength(2);
    expect(w.every((r) => !r.trusted)).toBe(true);
    expect(w[0]!.tier).toBe("MYTHIC");
  });

  it("CSV com cabecalho e escape de virgula e aspas", () => {
    const csv = toCsv(buildAuditRows([item({ name: 'A, "B"', slug: "ab" })]));
    const [head, line] = csv.trim().split("\n");
    expect(head).toBe("name,slug,series,universe,type,tier,url,kind,trusted,shared_with_other_names,emblem,reason");
    expect(line!.startsWith('"A, ""B""",ab,')).toBe(true);
  });
});
