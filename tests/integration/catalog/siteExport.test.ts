import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectSiteSchema, exportSiteCatalog, loadSiteCatalog, type SiteCard } from "../../../src/catalog/siteExport.js";
import { startTestDb, type TestDb } from "./testDb.js";

let t: TestDb;
const noOverrides: never[] = [];

async function entity(o: {
  slug: string;
  name?: string;
  type?: string;
  gender?: string;
  status?: string;
  adult?: boolean;
  tier?: string;
  rank?: number | null;
  aether?: number;
  image?: string | null;
  series?: string;
  nicheId?: number | null;
  prestige?: number | null;
  parentId?: number | null;
  edition?: string | null;
  nameNative?: string | null;
}): Promise<number> {
  const [e] = await t.sql`
    INSERT INTO entities (slug, name, name_native, name_normalized, universe, type, gender, status, is_adult, tier, popularity_rank,
                          base_aether, parent_id, edition)
    VALUES (${o.slug}, ${o.name ?? o.slug}, ${o.nameNative ?? null}, ${o.slug}, 'ANIME', ${o.type ?? "CHARACTER"},
            ${o.gender ?? "FEMALE"}, ${o.status ?? "ACTIVE"}, ${o.adult ?? false}, ${o.tier ?? "COMMON"},
            ${o.rank ?? null}, ${o.aether ?? 100}, ${o.parentId ?? null}, ${o.edition ?? null})
    RETURNING id`;
  const id = e!.id as number;
  if (o.nicheId !== undefined && o.nicheId !== null) {
    await t.sql`UPDATE entities SET niche_id = ${o.nicheId}, prestige = ${o.prestige ?? null} WHERE id = ${id}`;
  }
  if (o.image) {
    await t.sql`INSERT INTO entity_images (entity_id, url, status, is_primary) VALUES (${id}, ${o.image}, 'ACTIVE', true)`;
  }
  if (o.series) {
    const [s] = await t.sql`
      INSERT INTO series (slug, title, universe) VALUES (${"s-" + o.slug}, ${o.series}, 'ANIME') RETURNING id`;
    await t.sql`INSERT INTO entity_series (entity_id, series_id, is_primary) VALUES (${id}, ${s!.id}, true)`;
  }
  return id;
}

const bySlug = (cards: SiteCard[], slug: string) => cards.find((c) => c.slug === slug);

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);

afterAll(async () => {
  await t?.stop();
}, 60_000);

describe("site export (com nicho e prestigio)", () => {
  let cards: SiteCard[];
  let nicheLabel = "";

  beforeAll(async () => {
    // A migration 0005 ja semeia os nichos; usa o existente.
    const [n] = await t.sql`SELECT id, label_pt FROM niches WHERE key = 'anime'`;
    const nicheId = n!.id as number;
    nicheLabel = n!.label_pt as string;
    const hero = await entity({
      slug: "hero",
      name: "Hero (O Escolhido)",
      nameNative: "Héroi",
      tier: "MYTHIC",
      rank: 1,
      aether: 30000,
      image: "https://s4.anilist.co/file/anilistcdn/character/large/b1-x.png",
      series: "Obra A",
      nicheId,
      prestige: 97,
    });
    await entity({
      slug: "hero-epic",
      name: "Hero (O Escolhido)",
      tier: "EPIC",
      aether: 5000,
      image: "https://s4.anilist.co/file/anilistcdn/character/large/b1-x.png",
      series: "Obra A",
      nicheId,
      prestige: 97,
      parentId: hero,
      edition: "EPIC",
    });
    await entity({
      slug: "side",
      tier: "RARE",
      rank: 2,
      image: "https://s4.anilist.co/file/anilistcdn/character/large/b2-x.png",
      series: "Obra A",
      nicheId,
      prestige: 60,
    });
    await entity({
      slug: "poster-guy",
      gender: "MALE",
      image: "https://image.tmdb.org/t/p/w500/abc.jpg",
      series: "Filme B",
    });
    await entity({
      slug: "cover-girl",
      image: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1.jpg",
    });
    await entity({ slug: "iron-sword", name: "Espada de Ferro", type: "WEAPON", gender: "ITEM", image: null });
    await entity({ slug: "own-photo", image: "./assets/cards/own-photo.jpg" });
    await entity({ slug: "adult-one", adult: true, image: "https://s4.anilist.co/file/anilistcdn/character/large/b3-x.png" });
    await entity({ slug: "inactive-one", status: "QUARANTINED", image: "https://s4.anilist.co/file/anilistcdn/character/large/b4-x.png" });
    await entity({ slug: "unknown-gender", gender: "UNKNOWN", image: "https://s4.anilist.co/file/anilistcdn/character/large/b5-x.png" });
    cards = await loadSiteCatalog(t.db, { overrides: noOverrides });
  });

  it("detecta o schema completo", async () => {
    expect(await detectSiteSchema(t.db)).toEqual({ niche: true, prestige: true, edition: true });
  });

  it("exclui adultas, inativas e genero desconhecido", () => {
    const slugs = cards.map((c) => c.slug);
    expect(slugs).not.toContain("adult-one");
    expect(slugs).not.toContain("inactive-one");
    expect(slugs).not.toContain("unknown-gender");
    expect(slugs).toContain("hero");
  });

  it("poster, capa e item sem arte viram EMBLEM; imageUrl nulo", () => {
    for (const slug of ["poster-guy", "cover-girl", "iron-sword"]) {
      const c = bySlug(cards, slug)!;
      expect(c.art.mode).toBe("EMBLEM");
      expect(c.imageUrl).toBeNull();
    }
    expect(bySlug(cards, "iron-sword")!.gender).toBe("OTHER");
  });

  it("arte de personagem confiavel e foto propria absoluta ficam IMAGE", () => {
    const hero = bySlug(cards, "hero")!;
    expect(hero.art).toEqual({ mode: "IMAGE", url: "https://s4.anilist.co/file/anilistcdn/character/large/b1-x.png" });
    expect(hero.imageUrl).toBe(hero.art.mode === "IMAGE" ? hero.art.url : null);
    const own = bySlug(cards, "own-photo")!;
    expect(own.art).toEqual({ mode: "IMAGE", url: "https://yo-apollon.github.io/kogu/assets/cards/own-photo.jpg" });
  });

  it("campos novos: nicho, prestigio, edicao, parent, supply, aliases, stats", () => {
    const hero = bySlug(cards, "hero")!;
    expect(hero).toMatchObject({
      niche: "anime",
      prestige: 97,
      nicheRank: 1,
      tier: "MYTHIC",
      seriesTitle: "Obra A",
      supply: { max: 1, label: "1/1" },
      edition: null,
      parentSlug: null,
    });
    expect(hero.nicheLabel).toBe(nicheLabel);
    expect(hero.aliases.sort()).toEqual(["Hero", "O Escolhido", "Héroi"].sort());
    expect(Object.keys(hero.stats).sort()).toEqual(["atk", "def", "hp", "spd"]);
    const epic = bySlug(cards, "hero-epic")!;
    expect(epic).toMatchObject({ edition: "EPIC", parentSlug: "hero", nicheRank: 1, tier: "EPIC" });
    expect(bySlug(cards, "side")!.nicheRank).toBe(2);
  });

  it("ordena por nicho e prestigio", () => {
    const anime = cards.filter((c) => c.niche === "anime").map((c) => c.slug);
    expect(anime.slice(0, 3)).toEqual(["hero", "hero-epic", "side"]);
    expect(cards.findIndex((c) => c.niche === null)).toBeGreaterThan(anime.length - 1);
  });

  it("exporta para pasta temporaria com meta consistente e sem campos privados", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-int-"));
    try {
      const r = await exportSiteCatalog(t.db, [dir], { overrides: noOverrides });
      expect(r.results[0]!.status).toBe("WRITTEN");
      const meta = JSON.parse(await fs.readFile(path.join(dir, "catalog.meta.json"), "utf8"));
      expect(meta.total).toBe(r.cards.length);
      expect(meta.counts.byTier.MYTHIC).toBe(1);
      const text = await fs.readFile(path.join(dir, "catalog.json"), "utf8");
      expect(text).not.toMatch(/guild|user_id|pact|balance|description/i);
      const again = await exportSiteCatalog(t.db, [dir], { overrides: noOverrides });
      expect(again.results[0]!.status).toBe("UNCHANGED");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("override curado vira IMAGE", async () => {
    const out = await loadSiteCatalog(t.db, {
      overrides: [{ slug: "poster-guy", url: "https://upload.wikimedia.org/x.png", kind: "CHARACTER", source: "wiki" }],
    });
    expect(bySlug(out, "poster-guy")!.art).toEqual({ mode: "IMAGE", url: "https://upload.wikimedia.org/x.png" });
  });
});

describe("site export (sem colunas de nicho/prestigio)", () => {
  it("funciona sem niche_id, prestige e a tabela niches", async () => {
    await t.sql`ALTER TABLE entities DROP COLUMN niche_id, DROP COLUMN prestige`;
    await t.sql`DROP TABLE niches`;
    const info = await detectSiteSchema(t.db);
    expect(info).toEqual({ niche: false, prestige: false, edition: true });
    const cards = await loadSiteCatalog(t.db, { overrides: noOverrides });
    expect(cards.length).toBeGreaterThan(0);
    const hero = bySlug(cards, "hero")!;
    expect(hero.niche).toBeNull();
    expect(hero.prestige).toBeNull();
    expect(hero.nicheRank).toBeNull();
    // Ordem cai para popularity_rank.
    expect(cards[0]!.slug).toBe("hero");
  });
});
