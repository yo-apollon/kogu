import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, silentLog, type TestDb } from "./testDb.js";
import { createJobContext, type JobContext } from "../../../src/catalog/jobs/context.js";
import { catalogRerank } from "../../../src/catalog/jobs/rerank.js";
import { runJob } from "../../../src/catalog/jobs/runner.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { subscribeEvent } from "../../../src/infra/redis/pubsub.js";

let t: TestDb;
let ctx: JobContext;
const kv = new MemoryStore();

beforeAll(async () => {
  t = await startTestDb();
  ctx = createJobContext({ db: t.db, kv, log: silentLog });
  await t.sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status, source_favorites)
    SELECT 'e' || g, 'Entity ' || g, 'entity ' || g, 'ANIME', 'FEMALE', 'ACTIVE', g * 10
    FROM generate_series(1, 200) g`;
  await t.sql`
    INSERT INTO entity_external_ids (source, external_id, entity_id)
    SELECT 'ANILIST', 'a' || id, id FROM entities`;
  // Fora do pool, mas com rank antigo que precisa ser zerado.
  await t.sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status, popularity_rank)
    VALUES ('quar', 'Quarantined One', 'one quarantined', 'ANIME', 'FEMALE', 'QUARANTINED', 777)`;
}, 120_000);

afterAll(async () => {
  await t?.stop();
  await kv.quit();
}, 60_000);

describe("catalog.rerank", () => {
  it("ranks unicos 1..N, tiers pelos percentis e evento catalog:updated", async () => {
    const events: unknown[] = [];
    const off = await subscribeEvent(kv, "catalog:updated", (p) => void events.push(p));
    const r = await runJob(ctx, catalogRerank);
    expect(r.status).toBe("SUCCESS");
    await new Promise((res) => setTimeout(res, 20));
    await off();
    expect(events).toHaveLength(1);

    const rows = await t.sql`
      SELECT popularity_rank AS rank, tier::text AS tier, popularity_score AS score, roll_weight, base_aether, like_rank, claim_rank
      FROM entities WHERE status = 'ACTIVE' ORDER BY popularity_rank`;
    expect(rows.map((x) => x.rank)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    expect(rows.map((x) => x.like_rank).sort((a, b) => a - b)).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
    const count = (tier: string) => rows.filter((x) => x.tier === tier).length;
    expect(["MYTHIC", "LEGENDARY", "EPIC", "RARE", "COMMON"].map(count)).toEqual([2, 8, 20, 50, 120]);
    expect(rows[0].tier).toBe("MYTHIC");
    expect(rows[0].score).toBe(1);
    expect(rows[199].tier).toBe("COMMON");
    expect(rows[0].roll_weight).toBeCloseTo(0.12 * 1.15, 4);
    expect(rows[0].base_aether).toBe(1200);

    const quar = await t.sql`SELECT popularity_rank, like_rank FROM entities WHERE slug = 'quar'`;
    expect(quar[0].popularity_rank).toBeNull();
    expect(quar[0].like_rank).toBeNull();
  });

  it("stats estaveis entre reranks (mesmo stats_seed)", async () => {
    const snap = () => t.sql`SELECT id, base_atk, base_def, base_spd, base_hp FROM entities WHERE status = 'ACTIVE' ORDER BY id`;
    const before = await snap();
    await runJob(ctx, catalogRerank);
    expect(await snap()).toEqual(before);
  });

  it("quem deixa de ser ACTIVE perde o rank e os demais sao reatribuidos sem colisao", async () => {
    await t.sql`UPDATE entities SET status = 'QUARANTINED' WHERE slug = 'e200'`;
    const r = await runJob(ctx, catalogRerank);
    expect(r.status).toBe("SUCCESS");
    const gone = await t.sql`SELECT popularity_rank, like_rank FROM entities WHERE slug = 'e200'`;
    expect(gone[0].popularity_rank).toBeNull();
    expect(gone[0].like_rank).toBeNull();
    const ranks = await t.sql`SELECT popularity_rank AS r FROM entities WHERE popularity_rank IS NOT NULL ORDER BY 1`;
    expect(ranks.map((x) => x.r)).toEqual(Array.from({ length: 199 }, (_, i) => i + 1));
    const top = await t.sql`SELECT slug FROM entities WHERE popularity_rank = 1`;
    expect(top[0].slug).toBe("e199");
  });
});
