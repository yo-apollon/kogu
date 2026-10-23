import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedEntity,
  seedGuild,
  seedMember,
  seedOffer,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

let t: TestDb;
type Offers = typeof import("../../../src/modules/summon/offers.js");
let offers: Offers;

beforeAll(async () => {
  t = await setupTestDb();
  offers = await import("../../../src/modules/summon/offers.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

const keyOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { key?: string }).key ?? `raw:${(e as Error).message}`;
  }
};

async function setup(opts: { users?: number; pactsPerWindow?: number } = {}) {
  const g = uid("g");
  await seedGuild(t.sql, g, { pactsPerWindow: opts.pactsPerWindow ?? 1 });
  const users = Array.from({ length: opts.users ?? 1 }, () => uid("u"));
  for (const u of users) await seedMember(t.sql, g, u);
  return { g, users };
}

describe("claimPact", () => {
  for (const lock of [true, false]) {
    it(`20 claims concorrentes geram exatamente 1 pacto e 1 claim (lock=${lock})`, async () => {
      const { g, users } = await setup({ users: 20 });
      const e = await seedEntity(t.sql, "Target");
      const o = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0] });
      const results = await Promise.allSettled(users.map((u) => offers.claimPact(o, u, { lock })));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) {
        if (r.status === "rejected") expect((r.reason as { key: string }).key).toBe("summon.pact_failed_taken");
      }
      const [{ n }] = await t.sql`SELECT count(*)::int n FROM pacts WHERE guild_id = ${g}`;
      const [off] = await t.sql`SELECT status, pact_id FROM roll_offers WHERE id = ${o}`;
      const [ent] = await t.sql`SELECT claims_count FROM entities WHERE id = ${e}`;
      expect(n).toBe(1);
      expect(off.status).toBe("CLAIMED");
      expect(off.pact_id).not.toBeNull();
      expect(ent.claims_count).toBe(1);
      const [pact] = await t.sql`SELECT awakening_keys, aether_at_bind FROM pacts WHERE guild_id = ${g}`;
      expect(pact.awakening_keys).toBe(1);
      expect(pact.aether_at_bind).toBe(100);
    });
  }

  it("oferta protegida nega terceiros, dono passa, e libera apos a protecao", async () => {
    const { g, users } = await setup({ users: 3, pactsPerWindow: 5 });
    const e1 = await seedEntity(t.sql, "Prot One");
    const o1 = await seedOffer(t.sql, { guildId: g, entityId: e1, ownerUserId: users[0], protectedForMs: 60_000 });
    expect(await keyOf(offers.claimPact(o1, users[1]))).toBe("summon.offer_protected");
    expect(await keyOf(offers.claimPact(o1, users[0]))).toBe("ok");

    const e2 = await seedEntity(t.sql, "Prot Two");
    const o2 = await seedOffer(t.sql, { guildId: g, entityId: e2, ownerUserId: users[0], protectedForMs: -1000 });
    expect(await keyOf(offers.claimPact(o2, users[2]))).toBe("ok");
  });

  it("oferta expirada e inexistente", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "Old");
    const o = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0], expiresInMs: -1000 });
    expect(await keyOf(offers.claimPact(o, users[0]))).toBe("errors.expired");
    expect(await keyOf(offers.claimPact(999_999_999, users[0]))).toBe("errors.expired");
  });

  it("sem cargas de pacto: rollback devolve a oferta e janela nova libera", async () => {
    const { g, users } = await setup({ pactsPerWindow: 1 });
    const [u] = users;
    const e1 = await seedEntity(t.sql, "Charge One");
    const e2 = await seedEntity(t.sql, "Charge Two");
    const o1 = await seedOffer(t.sql, { guildId: g, entityId: e1, ownerUserId: u });
    const o2 = await seedOffer(t.sql, { guildId: g, entityId: e2, ownerUserId: u });
    const now = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(await keyOf(offers.claimPact(o1, u, { now }))).toBe("ok");
    expect(await keyOf(offers.claimPact(o2, u, { now: now + 60_000 }))).toBe("summon.pact_no_charges");
    const [off] = await t.sql`SELECT status FROM roll_offers WHERE id = ${o2}`;
    expect(off.status).toBe("OPEN");
    // 180 min depois: nova janela
    expect(await keyOf(offers.claimPact(o2, u, { now: now + 181 * 60_000 }))).toBe("ok");
  });

  it("duas ofertas da mesma entidade: a segunda falha e nao gasta a carga", async () => {
    const { g, users } = await setup({ users: 2 });
    const e = await seedEntity(t.sql, "Dup");
    const o1 = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0] });
    const o2 = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0] });
    expect(await keyOf(offers.claimPact(o1, users[0]))).toBe("ok");
    expect(await keyOf(offers.claimPact(o2, users[1]))).toBe("summon.pact_already_bound");
    const [m] = await t.sql`SELECT pacts_used FROM guild_members WHERE guild_id = ${g} AND user_id = ${users[1]}`;
    const [off] = await t.sql`SELECT status FROM roll_offers WHERE id = ${o2}`;
    expect(m.pacts_used).toBe(0);
    expect(off.status).toBe("OPEN");
  });

  it("cria o membro de quem clica sem cadastro previo", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "Newbie");
    const o = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0] });
    const stranger = uid("stranger");
    await offers.claimPact(o, stranger, { username: "Estranho" });
    const [u] = await t.sql`SELECT username FROM users WHERE id = ${stranger}`;
    expect(u.username).toBe("Estranho");
  });
});

describe("claimOrb", () => {
  it("absorcao concorrente credita uma vez, com valor do banco", async () => {
    const { g, users } = await setup({ users: 10 });
    const e = await seedEntity(t.sql, "Orb Target");
    const o = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0], orbAether: 77 });
    const results = await Promise.allSettled(users.map((u) => offers.claimOrb(o, u)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<Offers["claimOrb"]>>> => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(ok[0].value.amount).toBe(77);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { key: string }).key).toBe("summon.orb_taken");
    }
    const [{ total }] = await t.sql`SELECT sum(aether_balance)::int total FROM guild_members WHERE guild_id = ${g}`;
    expect(total).toBe(77);
  });

  it("oferta sem orbe nao credita", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "No Orb");
    const o = await seedOffer(t.sql, { guildId: g, entityId: e, ownerUserId: users[0] });
    expect(await keyOf(offers.claimOrb(o, users[0]))).toBe("summon.orb_taken");
  });
});

describe("likeEntity", () => {
  it("like duplicado conta uma vez, mesmo concorrente", async () => {
    const e = await seedEntity(t.sql, "Likeable");
    const u1 = uid("lu");
    const u2 = uid("lu");
    const rs = await Promise.all(Array.from({ length: 6 }, () => offers.likeEntity(u1, e)));
    expect(rs.filter((r) => r.added)).toHaveLength(1);
    expect((await offers.likeEntity(u1, e)).added).toBe(false);
    const second = await offers.likeEntity(u2, e);
    expect(second).toEqual({ added: true, likesCount: 2 });
  });

  it("entidade inexistente", async () => {
    expect(await keyOf(offers.likeEntity(uid("lu"), 987_654_321))).toBe("errors.entity_not_found");
  });
});

describe("incrementAwakening", () => {
  it("despertares concorrentes somam certo e viram soulmate em 10", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "Awake");
    const [{ id }] = await t.sql`
      INSERT INTO pacts (guild_id, user_id, entity_id, awakening_keys)
      VALUES (${g}, ${users[0]}, ${e}, 1) RETURNING id::int AS id`;
    const rs = await Promise.all(Array.from({ length: 25 }, () => offers.incrementAwakening(id)));
    expect(rs.every((r) => r !== null)).toBe(true);
    const [p] = await t.sql`SELECT awakening_keys, is_soulmate FROM pacts WHERE id = ${id}`;
    expect(p.awakening_keys).toBe(26);
    expect(p.is_soulmate).toBe(true);
    expect(await offers.incrementAwakening(999_999_999)).toBeNull();
  });

  it("nao e soulmate antes de 10", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "Awake Early");
    const [{ id }] = await t.sql`
      INSERT INTO pacts (guild_id, user_id, entity_id, awakening_keys)
      VALUES (${g}, ${users[0]}, ${e}, 1) RETURNING id::int AS id`;
    const r = await offers.incrementAwakening(id);
    expect(r?.awakeningKeys).toBe(2);
    expect(r?.isSoulmate).toBe(false);
  });
});

describe("createOffer, sweep e reinicio", () => {
  it("createOffer cria usuario/guild ausentes e setOfferMessage vincula", async () => {
    const g = uid("g-new");
    const e = await seedEntity(t.sql, "Fresh");
    const o = await offers.createOffer({
      guildId: g,
      channelId: "c9",
      entity: { id: e },
      variant: "FOIL",
      aetherValue: 125,
      rolledBy: uid("roller"),
      protectedUntil: null,
      expiresAt: Date.now() + 45_000,
    });
    expect(o.status).toBe("OPEN");
    expect(o.variant).toBe("FOIL");
    await offers.setOfferMessage(o.id, "m1");
    expect((await offers.getOffer(o.id))?.messageId).toBe("m1");
  });

  it("sweepExpiredOffers marca vencidas, devolve e nao repete; ignora abertas e reivindicadas", async () => {
    const { g, users } = await setup({ pactsPerWindow: 5 });
    const mk = async (n: string, expiresInMs: number) =>
      seedOffer(t.sql, { guildId: g, entityId: await seedEntity(t.sql, n), ownerUserId: users[0], expiresInMs });
    const stale = await mk("Sweep A", -5000);
    const fresh = await mk("Sweep B", 60_000);
    const claimed = await mk("Sweep C", 60_000);
    await offers.claimPact(claimed, users[0]);
    await t.sql`UPDATE roll_offers SET expires_at = now() - interval '1 second' WHERE id = ${claimed}`;

    const swept = await offers.sweepExpiredOffers();
    const ids = swept.map((s) => s.id);
    expect(ids).toContain(stale);
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(claimed);
    expect(swept.find((s) => s.id === stale)?.channelId).toBe("c1");
    expect(await offers.sweepExpiredOffers()).toEqual([]);
    const [f] = await t.sql`SELECT status FROM roll_offers WHERE id = ${fresh}`;
    expect(f.status).toBe("OPEN");
  });

  it("oferta sobrevive a reinicio (modulos novos, pool de conexoes novo)", async () => {
    const { g, users } = await setup();
    const e = await seedEntity(t.sql, "Survivor");
    const o = await offers.createOffer({
      guildId: g,
      channelId: "c1",
      entity: { id: e },
      variant: "STANDARD",
      aetherValue: 100,
      rolledBy: users[0],
      expiresAt: Date.now() + 60_000,
    });
    const { closeDb } = await import("../../../src/infra/db/client.js");
    const { closeKV } = await import("../../../src/infra/redis/client.js");
    await closeDb(1);
    await closeKV();
    vi.resetModules();
    const fresh = await import("../../../src/modules/summon/offers.js");
    const claimed = await fresh.claimPact(o.id, users[0]);
    expect(claimed.entityId).toBe(e);
  });
});
