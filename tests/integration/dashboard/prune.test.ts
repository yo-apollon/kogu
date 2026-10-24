import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pruneOld } from "../../../src/catalog/jobs/maintenancePrune.js";
import { startTestDb, type TestDb } from "../catalog/testDb.js";

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

describe("maintenance.prune (dashboard)", () => {
  it("poda ofertas nao reivindicadas > 30d, rate limit > 1d e auditoria > 180d", async () => {
    await t.sql`INSERT INTO guilds (id) VALUES ('gpr')`;
    await t.sql`INSERT INTO users (id, username) VALUES ('upr', 'upr')`;
    const [{ id: e }] = await t.sql`
      INSERT INTO entities (slug, name, name_normalized, universe, status)
      VALUES ('pr-e', 'Pr E', 'pr e', 'ANIME', 'ACTIVE') RETURNING id::int AS id`;
    await t.sql`INSERT INTO roll_offers (guild_id, channel_id, owner_user_id, entity_id, status, claimed_by, claimed_at, expires_at, created_at)
      VALUES
        ('gpr', 'c', 'upr', ${e}, 'EXPIRED', NULL, NULL, now() - interval '39 days', now() - interval '40 days'),
        ('gpr', 'c', 'upr', ${e}, 'OPEN', NULL, NULL, now() - interval '39 days', now() - interval '40 days'),
        ('gpr', 'c', 'upr', ${e}, 'CLAIMED', 'upr', now() - interval '39 days', now() - interval '39 days', now() - interval '40 days'),
        ('gpr', 'c', 'upr', ${e}, 'EXPIRED', NULL, NULL, now() - interval '1 day', now() - interval '2 days')`;
    await t.sql`INSERT INTO dashboard_rate_limit (key, window_start, count) VALUES
      ('old', now() - interval '2 days', 3), ('fresh', now() - interval '1 hour', 1)`;
    await t.sql`INSERT INTO dashboard_audit_log (guild_id, actor_user_id, action, created_at) VALUES
      ('gpr', 'upr', 'old', now() - interval '200 days'), ('gpr', 'upr', 'new', now() - interval '10 days')`;

    const r = await pruneOld(t.db, new Date());
    expect(r).toMatchObject({ rollOffers: 2, rateLimits: 1, auditLog: 1 });

    const offers = await t.sql`SELECT status FROM roll_offers ORDER BY id`;
    expect(offers.map((o) => o.status)).toEqual(["CLAIMED", "EXPIRED"]);
    expect((await t.sql`SELECT key FROM dashboard_rate_limit`).map((x) => x.key)).toEqual(["fresh"]);
    expect((await t.sql`SELECT action FROM dashboard_audit_log`).map((x) => x.action)).toEqual(["new"]);
  });
});