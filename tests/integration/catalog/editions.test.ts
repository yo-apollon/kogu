import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, silentLog, type TestDb } from "./testDb.js";
import { FakeSource, mkChar, mkSeries } from "./fakes.js";
import { createJobContext, type JobContext } from "../../../src/catalog/jobs/context.js";
import { anilistTrending } from "../../../src/catalog/jobs/anilistTrending.js";
import { rerankCatalog } from "../../../src/catalog/jobs/rerank.js";
import { runJob } from "../../../src/catalog/jobs/runner.js";
import { findCrossSourceMatch, findSimilarInFranchise } from "../../../src/catalog/dedupe.js";
import { TIER_AETHER_BAND, type EntityTier } from "../../../src/config/gacha.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { generateEditions, parseArgs } from "../../../src/scripts/generateEditions.js";

let t: TestDb;
const kv = new MemoryStore();

beforeAll(async () => {
  t = await startTestDb();
  const [fr] = await t.sql`INSERT INTO franchises (slug, name) VALUES ('ufc-mma', 'UFC / MMA') RETURNING id::int AS id`;
  const [sr] = await t.sql`
    INSERT INTO series (slug, title, universe, franchise_id) VALUES ('s-ed', 'Serie Edicoes', 'ANIME', ${fr.id})
    RETURNING id::int AS id`;
  await t.sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status, source_favorites, franchise_id)
    SELECT 'p' || g, 'Pessoa ' || g, 'pessoa ' || g, CASE WHEN g % 10 = 0 THEN 'GAME' ELSE 'ANIME' END::universe,
           CASE WHEN g = 59 THEN 'UNKNOWN' ELSE 'FEMALE' END::gender, 'ACTIVE', g * 10, ${fr.id}
    FROM generate_series(1, 60) g`;
  await t.sql`INSERT INTO entity_external_ids (source, external_id, entity_id) SELECT 'ANILIST', 'a' || id, id FROM entities`;
  await t.sql`INSERT INTO entity_series (entity_id, series_id, is_primary) SELECT id, ${sr.id}, true FROM entities`;
  // Todas com imagem, menos a 58 (sem imagem primaria ACTIVE).
  await t.sql`
    INSERT INTO entity_images (entity_id, url, is_primary, status)
    SELECT id, 'https://x/' || slug || '.png', true, 'ACTIVE' FROM entities WHERE slug <> 'p58'`;
  await rerankCatalog(t.db);
}, 120_000);

afterAll(async () => {
  await t?.stop();
  await kv.quit();
}, 60_000);

const count = async (where: string) =>
  ((await t.sql.unsafe(`SELECT count(*)::int AS n FROM entities WHERE ${where}`)) as unknown as [{ n: number }])[0].n;

describe("generateEditions", () => {
  it("parseArgs: padroes e validacao", () => {
    expect(parseArgs([])).toEqual({ top: 150, apply: false });
    expect(parseArgs(["--top=5", "--universe=anime", "--niche=ufc-mma", "--apply"])).toMatchObject({
      top: 5,
      universe: "ANIME",
      niche: "ufc-mma",
      apply: true,
    });
    expect(() => parseArgs(["--top=0"])).toThrow();
    expect(() => parseArgs(["--universe=XYZ"])).toThrow();
    expect(() => parseArgs(["--foo"])).toThrow();
  });

  it("dry-run (padrao) nao grava nada", async () => {
    const before = await count("true");
    const r = await generateEditions(t.db, { top: 5, apply: false });
    expect(r.targets).toBe(5);
    expect(r.newAnchors).toBe(5);
    expect(r.editionsCreated).toBe(10);
    expect(await count("true")).toBe(before);
    expect(await count("edition IS NOT NULL")).toBe(0);
  });

  it("apply: ancora BASIC + EPIC + MYTHIC por alvo, copiando campos, serie e imagem", async () => {
    const before = await count("true");
    const r = await generateEditions(t.db, { top: 5, apply: true });
    expect(r.newAnchors).toBe(5);
    expect(r.editionsCreated).toBe(10);
    expect(r.reranked).toBe(true);
    expect(await count("true")).toBe(before + 10);

    // Os 5 mais populares elegiveis: p60..p56 (p59 e UNKNOWN e p58 sem imagem ficam de fora; ver abaixo).
    const anchors = await t.sql`
      SELECT id::int AS id, slug, tier::text AS tier, popularity_rank FROM entities WHERE edition = 'BASIC' ORDER BY slug`;
    expect(anchors).toHaveLength(5);
    expect(anchors.every((a) => a.tier === "COMMON" && a.popularity_rank === null)).toBe(true);
    const slugs = anchors.map((a) => a.slug);
    expect(slugs).not.toContain("p59"); // genero UNKNOWN
    expect(slugs).not.toContain("p58"); // sem imagem

    for (const a of anchors) {
      const kids = await t.sql`
        SELECT e.slug, e.edition, e.tier::text AS tier, e.status::text AS status, e.parent_id::int AS parent_id,
               e.name, e.name_normalized, e.universe::text AS universe, e.gender::text AS gender, e.franchise_id,
               e.popularity_rank, e.popularity_score,
               (SELECT count(*)::int FROM entity_series s WHERE s.entity_id = e.id AND s.is_primary) AS series_primary,
               (SELECT count(*)::int FROM entity_images i WHERE i.entity_id = e.id AND i.is_primary AND i.status = 'ACTIVE') AS imgs,
               (SELECT count(*)::int FROM entity_external_ids x WHERE x.entity_id = e.id) AS ext
        FROM entities e WHERE e.parent_id = ${a.id} ORDER BY e.edition`;
      expect(kids.map((k) => k.edition)).toEqual(["EPIC", "MYTHIC"]);
      const [base] = await t.sql`
        SELECT name, name_normalized, universe::text AS universe, gender::text AS gender, franchise_id, popularity_score
        FROM entities WHERE id = ${a.id}`;
      for (const k of kids) {
        expect(k.slug).toBe(`${a.slug}-${String(k.edition).toLowerCase()}`);
        expect(k.status).toBe("ACTIVE");
        expect(k.name).toBe(base.name);
        expect(k.name_normalized).toBe(base.name_normalized);
        expect(k.universe).toBe(base.universe);
        expect(k.gender).toBe(base.gender);
        expect(k.franchise_id).toBe(base.franchise_id);
        expect(k.series_primary).toBe(1);
        expect(k.imgs).toBe(1);
        expect(k.ext).toBe(0);
        expect(k.popularity_rank).toBeNull();
        expect(k.popularity_score).toBeCloseTo(base.popularity_score as number, 5);
      }
      expect(kids[0].tier).toBe("EPIC");
      expect(kids[1].tier).toBe("MYTHIC");
    }
  });

  it("rerank: edicoes no tier fixo e dentro da faixa; ranks das demais seguem 1..N unico", async () => {
    const eds = await t.sql`SELECT edition, tier::text AS tier, base_aether, popularity_rank FROM entities WHERE edition IS NOT NULL`;
    for (const e of eds) {
      const tier = e.tier as EntityTier;
      expect(tier).toBe(e.edition === "BASIC" ? "COMMON" : e.edition);
      expect(e.base_aether).toBeGreaterThanOrEqual(TIER_AETHER_BAND[tier].min);
      expect(e.base_aether).toBeLessThanOrEqual(TIER_AETHER_BAND[tier].max);
      expect(e.popularity_rank).toBeNull();
    }
    const regular = await t.sql`
      SELECT popularity_rank AS rank, tier::text AS tier FROM entities
      WHERE status = 'ACTIVE' AND edition IS NULL ORDER BY popularity_rank`;
    expect(regular.map((x) => x.rank)).toEqual(Array.from({ length: regular.length }, (_, i) => i + 1));

    // Rerank repetido nao muda nada (edicoes nao distorcem os tiers das demais).
    const snap = () =>
      t.sql`SELECT id, tier::text AS tier, popularity_rank, base_aether, roll_weight FROM entities ORDER BY id`;
    const first = await snap();
    await rerankCatalog(t.db);
    expect(await snap()).toEqual(first);
  });

  it("idempotente: segunda execucao nao cria nem duplica nada", async () => {
    const before = await count("true");
    const r = await generateEditions(t.db, { top: 5, apply: true });
    expect(r.newAnchors).toBe(0);
    expect(r.existingAnchors).toBe(5);
    expect(r.editionsCreated).toBe(0);
    expect(await count("true")).toBe(before);
    expect(await count("edition = 'EPIC'")).toBe(5);
    expect(await count("edition = 'MYTHIC'")).toBe(5);
  });

  it("repara edicao faltante e respeita --universe/--niche", async () => {
    await t.sql`DELETE FROM entities WHERE edition = 'MYTHIC' AND slug LIKE 'p60%'`;
    const r = await generateEditions(t.db, { top: 5, apply: true });
    expect(r.editionsCreated).toBe(1);
    expect(await count("edition = 'MYTHIC'")).toBe(5);

    const dry = await generateEditions(t.db, { top: 3, universe: "GAME", niche: "ufc", apply: false });
    expect(dry.byUniverse).toEqual({ GAME: expect.any(Number) });
    const none = await generateEditions(t.db, { top: 3, niche: "nao-existe", apply: false });
    expect(none.targets).toBe(0);
  });
});

describe("dedupe e sync ignoram edicoes derivadas", () => {
  it("findCrossSourceMatch casa so a ancora; findSimilarInFranchise ignora EPIC/MYTHIC", async () => {
    const [anchor] = await t.sql`
      SELECT e.id::int AS id, e.name, e.name_normalized, e.franchise_id::int AS fr, es.series_id::int AS sid
      FROM entities e JOIN entity_series es ON es.entity_id = e.id AND es.is_primary
      WHERE e.edition = 'BASIC' ORDER BY e.id LIMIT 1`;
    const m = await findCrossSourceMatch(t.db, {
      source: "IGDB",
      nameNormalized: anchor.name_normalized as string,
      seriesIds: [anchor.sid as number],
    });
    expect(m.ambiguous).toEqual([]);
    expect(m.entityId).toBe(anchor.id);

    const sim = await findSimilarInFranchise(t.db, { franchiseId: anchor.fr as number, name: anchor.name as string });
    const ids = sim.map((s) => s.id);
    expect(ids).toContain(anchor.id);
    const derived = await t.sql`SELECT id::int AS id FROM entities WHERE edition IN ('EPIC', 'MYTHIC')`;
    for (const d of derived) expect(ids).not.toContain(d.id);
  });

  it("sync da fonte nao sobrescreve tier/edicao nem cria duplicatas ou suspeitas", async () => {
    const source = new FakeSource("ANILIST", {
      series: [mkSeries("ANILIST", 1)],
      chars: { "1": [mkChar("ANILIST", "1", 0), mkChar("ANILIST", "1", 1)] },
    });
    const ctx: JobContext = createJobContext({ db: t.db, kv, log: silentLog, sources: { ANILIST: source } });
    expect((await runJob(ctx, anilistTrending)).status).toBe("SUCCESS");

    // Gera edicoes para os personagens recem-sincronizados (sem imagem verificada nao entram; checa imagem ativa).
    const [fakeAnchor] = await t.sql`
      SELECT e.id::int AS id FROM entities e
      JOIN entity_external_ids x ON x.entity_id = e.id AND x.external_id = '1-0'
      WHERE e.gender <> 'UNKNOWN' LIMIT 1`;
    await t.sql`UPDATE entities SET popularity_score = 0.999 WHERE id = ${fakeAnchor.id}`;
    await generateEditions(t.db, { top: 6, apply: true });
    expect(await count(`parent_id = ${fakeAnchor.id}`)).toBe(2);
    const snap = () =>
      t.sql`SELECT id, slug, tier::text AS tier, edition, parent_id, status::text AS status, name FROM entities
            WHERE edition IS NOT NULL ORDER BY id`;
    const before = await snap();
    expect(before.length).toBeGreaterThanOrEqual(3 * 5 + 3);
    const totalBefore = await count("true");

    // Segunda passada com dados novos (favoritos e nome alterados) da mesma fonte.
    source.data.chars["1"] = [
      mkChar("ANILIST", "1", 0, { favourites: 999_999 }),
      mkChar("ANILIST", "1", 1, { favourites: 2000 }),
    ];
    expect((await runJob(ctx, anilistTrending)).status).toBe("SUCCESS");

    const after = await snap();
    expect(after.map((r) => [r.id, r.tier, r.edition, r.parent_id, r.status])).toEqual(
      before.map((r) => [r.id, r.tier, r.edition, r.parent_id, r.status])
    );
    expect(await count("true")).toBe(totalBefore);
    const suspects = await t.sql`
      SELECT count(*)::int AS n FROM moderation_queue q
      JOIN entities e ON e.id = q.entity_id WHERE q.reason = 'DUPLICATE_SUSPECT' AND e.edition IS NOT NULL`;
    expect(suspects[0].n).toBe(0);
  });
});
