import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, silentLog, type TestDb } from "./testDb.js";
import { mergeEntities, MergeError } from "../../../src/catalog/dedupe.js";
import { verifyPrimaryImages } from "../../../src/catalog/images.js";
import { createJobContext, type JobContext } from "../../../src/catalog/jobs/context.js";
import { maintenancePrune } from "../../../src/catalog/jobs/maintenancePrune.js";
import { releaseWindowsExpire } from "../../../src/catalog/jobs/releaseWindowsExpire.js";
import { runJob } from "../../../src/catalog/jobs/runner.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";

let t: TestDb;
let ctx: JobContext;
const kv = new MemoryStore();

beforeAll(async () => {
  t = await startTestDb();
  ctx = createJobContext({ db: t.db, kv, log: silentLog });
}, 120_000);

afterAll(async () => {
  await t?.stop();
  await kv.quit();
}, 60_000);

async function entity(slug: string, status = "ACTIVE"): Promise<number> {
  const [r] = await t.sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status)
    VALUES (${slug}, ${slug}, ${slug}, 'ANIME', 'FEMALE', ${status}) RETURNING id::int AS id`;
  return r.id as number;
}
async function member(guild: string, user: string) {
  await t.sql`INSERT INTO guilds (id) VALUES (${guild}) ON CONFLICT DO NOTHING`;
  await t.sql`INSERT INTO users (id, username) VALUES (${user}, ${user}) ON CONFLICT DO NOTHING`;
  await t.sql`INSERT INTO guild_members (guild_id, user_id) VALUES (${guild}, ${user}) ON CONFLICT DO NOTHING`;
}
async function pact(guild: string, user: string, entityId: number, boundAt: string, aether: number) {
  await t.sql`
    INSERT INTO pacts (guild_id, user_id, entity_id, bound_at, aether_at_bind)
    VALUES (${guild}, ${user}, ${entityId}, ${boundAt}::timestamptz, ${aether})`;
}
const balance = async (g: string, u: string) =>
  Number((await t.sql`SELECT aether_balance FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`)[0].aether_balance);

describe("mergeEntities", () => {
  it("reaponta pactos, resolve conflitos pelo mais antigo e credita o Eter", async () => {
    const w = await entity("winner");
    const l = await entity("loser");
    for (const [g, u] of [["g1", "u1"], ["g1", "u2"], ["g2", "u3"], ["g3", "u1"], ["g3", "u2"]]) await member(g, u);
    // g1: pacto do vencedor e mais antigo => fica; u2 (perdedor) recebe 300.
    await pact("g1", "u1", w, "2026-01-01T00:00:00Z", 200);
    await pact("g1", "u2", l, "2026-02-01T00:00:00Z", 300);
    // g2: so o perdedor => reapontado.
    await pact("g2", "u3", l, "2026-01-05T00:00:00Z", 100);
    // g3: pacto do perdedor e mais antigo => fica (reapontado); u1 (vencedor) recebe 150.
    await pact("g3", "u1", w, "2026-03-01T00:00:00Z", 150);
    await pact("g3", "u2", l, "2026-01-10T00:00:00Z", 400);

    // wishes e likes
    await t.sql`INSERT INTO wishes (guild_id, user_id, entity_id, is_starwish) VALUES ('g1', 'u1', ${w}, false), ('g1', 'u1', ${l}, true), ('g1', 'u2', ${l}, false)`;
    await t.sql`INSERT INTO entity_likes (user_id, entity_id) VALUES ('u1', ${w}), ('u1', ${l}), ('u2', ${l})`;
    // ids externos, imagens e serie
    await t.sql`INSERT INTO entity_external_ids (source, external_id, entity_id) VALUES ('ANILIST', 'w1', ${w}), ('JIKAN', 'l1', ${l})`;
    await t.sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${w}, 'https://s4.anilist.co/w.png', true), (${l}, 'https://s4.anilist.co/l.png', true), (${l}, 'https://s4.anilist.co/w.png', false)`;
    const [s] = await t.sql`INSERT INTO series (slug, title, universe) VALUES ('merge-s', 'Merge S', 'ANIME') RETURNING id::int AS id`;
    await t.sql`INSERT INTO entity_series (entity_id, series_id, is_primary) VALUES (${l}, ${s.id}, true)`;
    await t.sql`INSERT INTO moderation_queue (entity_id, other_entity_id, reason) VALUES (${w}, ${l}, 'DUPLICATE_SUSPECT')`;

    const res = await mergeEntities(t.db, w, l);
    expect(res.pactConflicts).toBe(2);
    expect(res.aetherRefunded).toBe(450);

    // pactos
    const pacts = await t.sql`SELECT guild_id, user_id, entity_id::int AS e FROM pacts ORDER BY guild_id`;
    expect(pacts.map((p) => [p.guild_id, p.user_id, p.e])).toEqual([
      ["g1", "u1", w],
      ["g2", "u3", w],
      ["g3", "u2", w],
    ]);
    expect(await balance("g1", "u2")).toBe(300);
    expect(await balance("g3", "u1")).toBe(150);
    expect(await balance("g1", "u1")).toBe(0);

    // wishes / likes sem duplicar, starwish prevalece
    const wishes = await t.sql`SELECT user_id, entity_id::int AS e, is_starwish FROM wishes ORDER BY user_id`;
    expect(wishes.map((x) => [x.user_id, x.e, x.is_starwish])).toEqual([["u1", w, true], ["u2", w, false]]);
    const likes = await t.sql`SELECT user_id, entity_id::int AS e FROM entity_likes ORDER BY user_id`;
    expect(likes.map((x) => [x.user_id, x.e])).toEqual([["u1", w], ["u2", w]]);
    expect((await t.sql`SELECT likes_count FROM entities WHERE id = ${w}`)[0].likes_count).toBe(2);

    // ids, imagens (duplicada descartada, primaria do vencedor preservada), serie
    const ext = await t.sql`SELECT external_id, entity_id::int AS e FROM entity_external_ids ORDER BY external_id`;
    expect(ext.map((x) => [x.external_id, x.e])).toEqual([["l1", w], ["w1", w]]);
    const imgs = await t.sql`SELECT url, is_primary FROM entity_images WHERE entity_id = ${w} ORDER BY url`;
    expect(imgs.map((x) => [x.url, x.is_primary])).toEqual([
      ["https://s4.anilist.co/l.png", false],
      ["https://s4.anilist.co/w.png", true],
    ]);
    const es = await t.sql`SELECT entity_id::int AS e, is_primary FROM entity_series`;
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ e: w, is_primary: true });

    // perdedor
    const loser = await t.sql`SELECT status::text, merged_into_id::int AS m, popularity_rank FROM entities WHERE id = ${l}`;
    expect(loser[0]).toMatchObject({ status: "MERGED", m: w, popularity_rank: null });
    expect((await t.sql`SELECT status::text FROM moderation_queue`)[0].status).toBe("APPROVED");

    // o perdedor nao pode ser fundido de novo
    await expect(mergeEntities(t.db, w, l)).rejects.toBeInstanceOf(MergeError);
  });
});

describe("images.verify", () => {
  const lookupImpl = async () => [{ address: "93.184.216.34" }];
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const fetchImpl = async (url: string) => {
    if (url.includes("ok")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    if (url.includes("gone")) return new Response("nf", { status: 404 });
    return new Response("err", { status: 500 });
  };

  it("valida, marca BROKEN, promove substituta, quarentena sem imagem e tolera falha transitoria", async () => {
    const mk = async (slug: string, urls: Array<[string, boolean]>) => {
      const id = await entity(slug);
      for (const [u, primary] of urls) {
        await t.sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${id}, ${u}, ${primary})`;
      }
      return id;
    };
    const okId = await mk("img-ok", [["https://s4.anilist.co/ok1.png", true]]);
    const promoteId = await mk("img-promote", [
      ["https://s4.anilist.co/gone1.png", true],
      ["https://s4.anilist.co/ok2.png", false],
    ]);
    const quarId = await mk("img-quar", [["https://s4.anilist.co/gone2.png", true]]);
    const flakyId = await mk("img-flaky", [["https://s4.anilist.co/flaky.png", true]]);

    const rep = await verifyPrimaryImages(t.db, { fetchImpl, lookupImpl });
    expect(rep).toMatchObject({ checked: 5, ok: 1, broken: 2, promoted: 1, quarantined: 1, transient: 2 });

    const ok = await t.sql`SELECT last_verified_at, content_hash FROM entity_images WHERE entity_id = ${okId}`;
    expect(ok[0].last_verified_at).not.toBeNull();
    expect(ok[0].content_hash).toHaveLength(40);

    const promoted = await t.sql`SELECT url, status, is_primary FROM entity_images WHERE entity_id = ${promoteId} ORDER BY url`;
    expect(promoted.map((x) => [x.status, x.is_primary])).toEqual([["BROKEN", false], ["ACTIVE", true]]);

    const quar = await t.sql`SELECT status::text FROM entities WHERE id = ${quarId}`;
    expect(quar[0].status).toBe("QUARANTINED");
    const mod = await t.sql`SELECT reason::text, status::text FROM moderation_queue WHERE entity_id = ${quarId}`;
    expect(mod[0]).toMatchObject({ reason: "NO_IMAGE", status: "PENDING" });

    const flaky = await t.sql`SELECT status, is_primary, fail_count FROM entity_images WHERE entity_id = ${flakyId}`;
    expect(flaky[0]).toMatchObject({ status: "ACTIVE", is_primary: true, fail_count: 1 });

    // Segunda passada: so as que falharam (img-flaky e a primaria da fusao) e a promovida, ainda nao verificada.
    const again = await verifyPrimaryImages(t.db, { fetchImpl, lookupImpl });
    expect(again.checked).toBe(3);
  });
});

describe("releaseWindows.expire e maintenance.prune", () => {
  it("fecha so as janelas vencidas", async () => {
    const [s1] = await t.sql`INSERT INTO series (slug, title, universe) VALUES ('rw1', 'RW1', 'ANIME') RETURNING id::int AS id`;
    const [s2] = await t.sql`INSERT INTO series (slug, title, universe) VALUES ('rw2', 'RW2', 'ANIME') RETURNING id::int AS id`;
    await t.sql`INSERT INTO release_windows (series_id, source, starts_at, ends_at, boost)
      VALUES (${s1.id}, 'ANILIST', now() - interval '40 days', now() - interval '10 days', 2),
             (${s2.id}, 'ANILIST', now() - interval '5 days', now() + interval '25 days', 2)`;
    const r = await runJob(ctx, releaseWindowsExpire);
    expect(r.status).toBe("SUCCESS");
    expect(r.updated).toBe(1);
    const rows = await t.sql`SELECT series_id::int AS s, closed_at FROM release_windows ORDER BY series_id`;
    expect(rows[0].closed_at).not.toBeNull();
    expect(rows[1].closed_at).toBeNull();
  });

  it("prune remove roll_log > 30d e sync_runs/revisions > 90d, preservando o ultimo snapshot de favoritos", async () => {
    const e = await entity("prune-e");
    await member("gp", "up");
    await t.sql`INSERT INTO roll_log (guild_id, user_id, entity_id, rolled_at)
      VALUES ('gp', 'up', ${e}, now() - interval '40 days'), ('gp', 'up', ${e}, now() - interval '1 day')`;
    await t.sql`INSERT INTO sync_runs (source, job, status, started_at)
      VALUES ('ANILIST', 'old', 'SUCCESS', now() - interval '100 days'), ('ANILIST', 'new', 'SUCCESS', now() - interval '1 day')`;
    await t.sql`INSERT INTO entity_revisions (entity_id, source, reason, diff, created_at) VALUES
      (${e}, 'ANILIST', 'sync', '{}', now() - interval '100 days'),
      (${e}, 'JIKAN', 'favourites', '{"favourites": 1}', now() - interval '120 days'),
      (${e}, 'JIKAN', 'favourites', '{"favourites": 2}', now() - interval '100 days'),
      (${e}, 'ANILIST', 'sync', '{}', now() - interval '1 day')`;
    const r = await runJob(ctx, maintenancePrune);
    expect(r.status).toBe("SUCCESS");
    expect(r.meta).toMatchObject({ rollLog: 1, syncRuns: 1, revisions: 2 });
    const left = await t.sql`SELECT reason, diff FROM entity_revisions WHERE entity_id = ${e} ORDER BY id`;
    expect(left.map((x) => x.reason)).toEqual(["favourites", "sync"]);
    expect(left[0].diff).toEqual({ favourites: 2 });
    expect((await t.sql`SELECT count(*)::int AS n FROM roll_log`)[0].n).toBe(1);
  });
});

