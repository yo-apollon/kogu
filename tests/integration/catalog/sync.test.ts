import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, silentLog, type TestDb } from "./testDb.js";
import { FakeSource, mkChar, mkSeries } from "./fakes.js";
import { createJobContext, type JobContext } from "../../../src/catalog/jobs/context.js";
import { anilistTrending } from "../../../src/catalog/jobs/anilistTrending.js";
import { igdbPopular } from "../../../src/catalog/jobs/igdbPopular.js";
import { jikanEnrich } from "../../../src/catalog/jobs/jikanEnrich.js";
import { runJob } from "../../../src/catalog/jobs/runner.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";

let t: TestDb;
let ctx: JobContext;
let anilist: FakeSource;
const kv = new MemoryStore();

beforeAll(async () => {
  t = await startTestDb();
  anilist = new FakeSource("ANILIST", {
    series: [
      mkSeries("ANILIST", 1, { crossIds: { JIKAN: "500" } }),
      mkSeries("ANILIST", 2),
    ],
    chars: {
      "1": [
        mkChar("ANILIST", "1", 0),
        mkChar("ANILIST", "1", 1),
        mkChar("ANILIST", "1", 2, { imageUrl: undefined }),
        mkChar("ANILIST", "1", 3, { gender: "UNKNOWN" }),
      ],
      "2": [
        mkChar("ANILIST", "2", 0, { isRealPerson: true }),
        mkChar("ANILIST", "2", 1, { favourites: 3 }),
      ],
    },
  });
  ctx = createJobContext({ db: t.db, kv, log: silentLog, sources: { ANILIST: anilist } });
}, 120_000);

afterAll(async () => {
  await t?.stop();
  await kv.quit();
}, 60_000);

const one = async <T = Record<string, unknown>>(q: Promise<unknown>): Promise<T> =>
  (await q as T[])[0];

describe("sync com fonte fake", () => {
  it("cria series, entidades, imagens, ids externos e sync_runs SUCCESS", async () => {
    const r = await runJob(ctx, anilistTrending);
    expect(r.status).toBe("SUCCESS");
    expect(r.created).toBe(8); // 2 series + 6 personagens
    expect(r.quarantined).toBe(4);
    expect(r.errors).toBe(0);

    const counts = await one<{ s: number; e: number; i: number; x: number; f: number; sx: number }>(t.sql`
      SELECT (SELECT count(*)::int FROM series) AS s, (SELECT count(*)::int FROM entities) AS e,
             (SELECT count(*)::int FROM entity_images WHERE is_primary AND status = 'ACTIVE') AS i,
             (SELECT count(*)::int FROM entity_external_ids WHERE source = 'ANILIST') AS x,
             (SELECT count(*)::int FROM franchises) AS f,
             (SELECT count(*)::int FROM series_external_ids) AS sx`);
    expect(counts).toEqual({ s: 2, e: 6, i: 5, x: 6, f: 2, sx: 3 }); // sx: 2 anilist + 1 jikan (crossIds)

    const run = await one<{ status: string; items_created: number; items_quarantined: number; finished_at: Date | null }>(
      t.sql`SELECT status::text, items_created, items_quarantined, finished_at FROM sync_runs WHERE id = ${r.runId!}`
    );
    expect(run.status).toBe("SUCCESS");
    expect(run.items_created).toBe(8);
    expect(run.items_quarantined).toBe(4);
    expect(run.finished_at).not.toBeNull();
  });

  it("quarentena: sem imagem, UNKNOWN, pessoa real e poucos favoritos", async () => {
    const rows = await t.sql`
      SELECT e.external_id, ent.status::text AS status, ent.gender::text AS gender,
             (SELECT array_agg(m.reason::text ORDER BY m.reason::text) FROM moderation_queue m
               WHERE m.entity_id = ent.id AND m.status = 'PENDING') AS reasons
      FROM entity_external_ids e JOIN entities ent ON ent.id = e.entity_id
      ORDER BY e.external_id`;
    const by = Object.fromEntries(rows.map((r) => [r.external_id as string, r]));
    expect(by["1-0"]).toMatchObject({ status: "ACTIVE", reasons: null });
    expect(by["1-1"]).toMatchObject({ status: "ACTIVE" });
    expect(by["1-2"]).toMatchObject({ status: "QUARANTINED", reasons: ["NO_IMAGE"] });
    expect(by["1-3"]).toMatchObject({ status: "QUARANTINED", gender: "UNKNOWN", reasons: ["UNKNOWN_GENDER"] });
    expect(by["2-0"]).toMatchObject({ status: "PENDING_REVIEW", reasons: ["REAL_PERSON"] });
    expect(by["2-1"]).toMatchObject({ status: "QUARANTINED", reasons: ["LOW_FAVORITES"] });
  });

  it("segunda execucao com os mesmos dados cria 0 itens e 0 atualizacoes", async () => {
    const before = await one<{ m: number; r: number }>(
      t.sql`SELECT (SELECT count(*)::int FROM moderation_queue) AS m, (SELECT count(*)::int FROM entity_revisions) AS r`
    );
    const r = await runJob(ctx, anilistTrending);
    expect(r.status).toBe("SUCCESS");
    expect(r.created).toBe(0);
    expect(r.updated).toBe(0);
    expect(r.quarantined).toBe(0);
    const after = await one<{ m: number; r: number; e: number }>(
      t.sql`SELECT (SELECT count(*)::int FROM moderation_queue) AS m, (SELECT count(*)::int FROM entity_revisions) AS r,
                   (SELECT count(*)::int FROM entities) AS e`
    );
    expect(after.m).toBe(before.m);
    expect(after.r).toBe(before.r);
    expect(after.e).toBe(6);
  });

  it("imagem que chega depois ativa a entidade e fecha a pendencia NO_IMAGE", async () => {
    anilist.data.chars["1"][2] = mkChar("ANILIST", "1", 2);
    const r = await runJob(ctx, anilistTrending);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    const row = await one<{ status: string }>(
      t.sql`SELECT ent.status::text AS status FROM entities ent
            JOIN entity_external_ids x ON x.entity_id = ent.id WHERE x.external_id = '1-2'`
    );
    expect(row.status).toBe("ACTIVE");
    const m = await one<{ status: string; reviewed_by: string }>(
      t.sql`SELECT m.status::text, m.reviewed_by FROM moderation_queue m
            JOIN entity_external_ids x ON x.entity_id = m.entity_id
            WHERE x.external_id = '1-2' AND m.reason = 'NO_IMAGE'`
    );
    expect(m).toEqual({ status: "APPROVED", reviewed_by: "system" });
  });

  it("aprovacao manual persiste: REAL_PERSON aprovado nao volta para revisao", async () => {
    await t.sql`
      UPDATE moderation_queue SET status = 'APPROVED', reviewed_by = 'mod1'
      WHERE reason = 'REAL_PERSON'`;
    await t.sql`
      UPDATE entities SET status = 'ACTIVE'
      WHERE id = (SELECT entity_id FROM entity_external_ids WHERE external_id = '2-0')`;
    const r = await runJob(ctx, anilistTrending);
    expect(r.quarantined).toBe(0);
    const row = await one<{ status: string }>(
      t.sql`SELECT ent.status::text AS status FROM entities ent
            JOIN entity_external_ids x ON x.entity_id = ent.id WHERE x.external_id = '2-0'`
    );
    expect(row.status).toBe("ACTIVE");
  });

  it("jikan.enrich anexa id e nao cria entidades", async () => {
    const jikan = new FakeSource("JIKAN", {
      series: [],
      chars: {
        "500": [
          {
            source: "JIKAN", externalId: "j1", name: "Silva, Akira", gender: "FEMALE", favourites: 9999,
            seriesExternalId: "500", imageUrl: "https://cdn.myanimelist.net/images/characters/1/1.jpg",
          },
          {
            source: "JIKAN", externalId: "j2", name: "Nobody Here", gender: "MALE", favourites: 50,
            seriesExternalId: "500", imageUrl: "https://cdn.myanimelist.net/images/characters/2/2.jpg",
          },
        ],
      },
    });
    const c2 = createJobContext({ db: t.db, kv, log: silentLog, sources: { ANILIST: anilist, JIKAN: jikan } });
    const r = await runJob(c2, jikanEnrich);
    expect(r.status).toBe("SUCCESS");
    expect(r.created).toBe(0);
    const ids = await t.sql`SELECT external_id FROM entity_external_ids WHERE source = 'JIKAN'`;
    expect(ids.map((x) => x.external_id)).toEqual(["j1"]);
    const e = await one<{ n: number }>(t.sql`SELECT count(*)::int AS n FROM entities`);
    expect(e.n).toBe(6);
    const snap = await one<{ fav: number }>(
      t.sql`SELECT (diff->>'favourites')::int AS fav FROM entity_revisions WHERE reason = 'favourites'`
    );
    expect(snap.fav).toBe(9999);
    // Segunda execucao: nada muda.
    const again = await runJob(c2, jikanEnrich);
    expect(again.updated).toBe(0);
  });

  it("homonimo na mesma franquia vira DUPLICATE_SUSPECT (PENDING_REVIEW)", async () => {
    anilist.data.series = [
      mkSeries("ANILIST", 1, { crossIds: { JIKAN: "500" } }),
      mkSeries("ANILIST", 2),
      mkSeries("ANILIST", 3, { title: "Series 1 Season 2" }),
    ];
    anilist.data.chars["3"] = [mkChar("ANILIST", "3", 0, { name: "Akira  Silva" })];
    const r = await runJob(ctx, anilistTrending);
    expect(r.created).toBe(2); // serie 3 + 1 personagem
    const row = await one<{ status: string; reason: string; other: number | null }>(
      t.sql`SELECT ent.status::text AS status, m.reason::text AS reason, m.other_entity_id::int AS other
            FROM entities ent JOIN entity_external_ids x ON x.entity_id = ent.id
            JOIN moderation_queue m ON m.entity_id = ent.id
            WHERE x.external_id = '3-0'`
    );
    expect(row.status).toBe("PENDING_REVIEW");
    expect(row.reason).toBe("DUPLICATE_SUSPECT");
    expect(row.other).not.toBeNull();
  });

  it("falha de uma fonte nao derruba as outras", async () => {
    const igdb = new FakeSource("IGDB", { series: [], chars: {} });
    igdb.failWith = new Error("IGDB fora do ar");
    const c2 = createJobContext({ db: t.db, kv, log: silentLog, sources: { ANILIST: anilist, IGDB: igdb } });
    const [bad, good] = await Promise.all([runJob(c2, igdbPopular), runJob(c2, anilistTrending)]);
    expect(bad.status).toBe("FAILED");
    expect(bad.error).toContain("IGDB fora do ar");
    expect(good.status).toBe("SUCCESS");
    const row = await one<{ status: string; error: string }>(
      t.sql`SELECT status::text, error FROM sync_runs WHERE id = ${bad.runId!}`
    );
    expect(row.status).toBe("FAILED");
  });

  it("advisory lock: o mesmo job nao roda em paralelo", async () => {
    anilist.delayMs = 150;
    const [a, b] = await Promise.all([runJob(ctx, anilistTrending), runJob(ctx, anilistTrending)]);
    anilist.delayMs = 0;
    expect([a.status, b.status].sort()).toEqual(["SKIPPED", "SUCCESS"]);
  });

  it("fonte indisponivel => SKIPPED", async () => {
    const c2 = createJobContext({ db: t.db, kv, log: silentLog, sources: {} });
    expect((await runJob(c2, anilistTrending)).status).toBe("SKIPPED");
  });
});

describe("janelas de lancamento via ingest", () => {
  it("abre janela para serie estreada ha poucos dias, uma vez so", async () => {
    const src = new FakeSource("ANILIST", {
      series: [mkSeries("ANILIST", 7, { startDate: new Date(Date.now() - 5 * 86_400_000), status: "RELEASING" })],
      chars: { "7": [] },
    });
    const c2 = createJobContext({ db: t.db, kv, log: silentLog, sources: { ANILIST: src } });
    await runJob(c2, anilistTrending);
    await runJob(c2, anilistTrending);
    const rows = await t.sql`SELECT boost, closed_at FROM release_windows`;
    expect(rows).toHaveLength(1);
    expect(rows[0].boost).toBe(2);
    expect(rows[0].closed_at).toBeNull();
  });
});

