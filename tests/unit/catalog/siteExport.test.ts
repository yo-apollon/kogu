import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAliases,
  buildMeta,
  hashCards,
  resolveExportDirs,
  serializeCatalog,
  sortAndRank,
  supplyOf,
  writeCatalogFiles,
  type SiteCard,
} from "../../../src/catalog/siteExport.js";

function card(over: Partial<SiteCard> = {}): SiteCard {
  return {
    id: 1,
    slug: "a",
    name: "A",
    seriesTitle: "S",
    universe: "ANIME",
    gender: "FEMALE",
    tier: "COMMON",
    baseAether: 100,
    popularityRank: 1,
    imageUrl: "https://x/a.png",
    niche: "anime",
    nicheLabel: "Anime",
    prestige: 50,
    nicheRank: null,
    edition: null,
    parentSlug: null,
    stats: { atk: 1, def: 2, spd: 3, hp: 4 },
    supply: { max: null, label: null },
    aliases: [],
    art: { mode: "IMAGE", url: "https://x/a.png" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "site-export-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("helpers", () => {
  it("supply deriva de TIER_MAX_SUPPLY", () => {
    expect(supplyOf("MYTHIC")).toEqual({ max: 1, label: "1/1" });
    expect(supplyOf("LEGENDARY")).toEqual({ max: 3, label: "até 3 cópias" });
    expect(supplyOf("COMMON")).toEqual({ max: null, label: null });
  });

  it("aliases: nativo, parenteses e nome base", () => {
    expect(buildAliases("Thanos (O Titã Louco)", "サノス").sort()).toEqual(["O Titã Louco", "Thanos", "サノス"].sort());
    expect(buildAliases("Naruto", null)).toEqual([]);
  });

  it("ordena por nicho e prestigio; nicheRank; edicao herda a ancora", () => {
    const out = sortAndRank([
      card({ id: 1, slug: "b", niche: "game", prestige: 10 }),
      card({ id: 2, slug: "c", niche: "anime", prestige: 90 }),
      card({ id: 3, slug: "d", niche: "anime", prestige: 95 }),
      card({ id: 4, slug: "d-epic", niche: "anime", prestige: 95, parentSlug: "d", edition: "EPIC" }),
      card({ id: 5, slug: "e", niche: null, prestige: null }),
    ]);
    expect(out.map((c) => c.slug)).toEqual(["d", "d-epic", "c", "b", "e"]);
    expect(out.map((c) => c.nicheRank)).toEqual([1, 1, 2, 1, null]);
  });

  it("hash e estavel e ignora updatedAt", () => {
    const a = [card()];
    const b = [card({ updatedAt: "2030-01-01T00:00:00.000Z" })];
    expect(hashCards(a)).toBe(hashCards(b));
    expect(hashCards(a)).not.toBe(hashCards([card({ baseAether: 101 })]));
    expect(hashCards(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("formato: lista JSON, campos antigos e novos, sem campos privados", () => {
    const text = serializeCatalog([card()]);
    const parsed = JSON.parse(text) as Record<string, unknown>[];
    const keys = Object.keys(parsed[0]!);
    for (const k of ["id", "name", "seriesTitle", "universe", "gender", "tier", "baseAether", "popularityRank", "imageUrl"]) {
      expect(keys).toContain(k);
    }
    for (const k of ["slug", "niche", "nicheLabel", "prestige", "edition", "parentSlug", "stats", "supply", "aliases", "art", "updatedAt"]) {
      expect(keys).toContain(k);
    }
    expect(text).not.toMatch(/user|pact|balance|saldo|discord|description/i);
  });

  it("meta: contagens e hash", () => {
    const m = buildMeta([card(), card({ id: 2, slug: "z", tier: "MYTHIC", niche: null })], new Date("2026-02-01T00:00:00Z"));
    expect(m.schemaVersion).toBe(1);
    expect(m.total).toBe(2);
    expect(m.counts.byTier).toEqual({ COMMON: 1, MYTHIC: 1 });
    expect(m.counts.byNiche).toEqual({ anime: 1, none: 1 });
    expect(m.generatedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("resolveExportDirs", () => {
  it("--out vence env; env vence padrao docs", () => {
    expect(resolveExportDirs({ out: ["x"], env: "a;b", cwd: "/p" })).toEqual([path.resolve("/p", "x")]);
    expect(resolveExportDirs({ env: "a; b ;;", cwd: "/p" })).toEqual([path.resolve("/p", "a"), path.resolve("/p", "b")]);
    expect(resolveExportDirs({ env: "", cwd: "/p" })).toEqual([path.resolve("/p", "docs")]);
  });
});

describe("writeCatalogFiles", () => {
  it("escreve atomicamente, nao deixa temporarios e so reescreve se o hash mudou", async () => {
    const r1 = await writeCatalogFiles([card()], [tmp]);
    expect(r1.results[0]!.status).toBe("WRITTEN");
    expect((await fs.readdir(tmp)).sort()).toEqual(["catalog.json", "catalog.meta.json"]);
    const mtime = (await fs.stat(path.join(tmp, "catalog.json"))).mtimeMs;

    const r2 = await writeCatalogFiles([card({ updatedAt: "2031-01-01T00:00:00.000Z" })], [tmp]);
    expect(r2.results[0]!.status).toBe("UNCHANGED");
    expect((await fs.stat(path.join(tmp, "catalog.json"))).mtimeMs).toBe(mtime);

    const r3 = await writeCatalogFiles([card({ baseAether: 5 })], [tmp]);
    expect(r3.results[0]!.status).toBe("WRITTEN");
    const written = JSON.parse(await fs.readFile(path.join(tmp, "catalog.json"), "utf8")) as SiteCard[];
    expect(written[0]!.baseAether).toBe(5);
    const meta = JSON.parse(await fs.readFile(path.join(tmp, "catalog.meta.json"), "utf8")) as { hash: string };
    expect(meta.hash).toBe(hashCards(written));
    expect((await fs.readdir(tmp)).sort()).toEqual(["catalog.json", "catalog.meta.json"]);
  });

  it("dry-run nao escreve", async () => {
    const r = await writeCatalogFiles([card()], [tmp], { dryRun: true });
    expect(r.results[0]!.status).toBe("DRY_RUN");
    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it("recusa destino inexistente, arquivo, raiz e catalogo vazio; nao escreve em nenhum", async () => {
    await expect(writeCatalogFiles([card()], [tmp, path.join(tmp, "nao-existe")])).rejects.toThrow(/nao existe/);
    expect(await fs.readdir(tmp)).toEqual([]);
    const file = path.join(tmp, "f.txt");
    await fs.writeFile(file, "x");
    await expect(writeCatalogFiles([card()], [file])).rejects.toThrow(/nao e uma pasta/);
    await expect(writeCatalogFiles([card()], [path.parse(tmp).root])).rejects.toThrow(/raiz/);
    await expect(writeCatalogFiles([], [tmp])).rejects.toThrow(/vazio/);
    await expect(writeCatalogFiles([card()], [])).rejects.toThrow(/nenhum destino/);
  });
});
