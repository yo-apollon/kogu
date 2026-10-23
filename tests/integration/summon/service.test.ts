import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextWindowStart } from "../../../src/lib/time.js";
import {
  seedEntity,
  seedGuild,
  seedMember,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

let t: TestDb;
type Svc = typeof import("../../../src/modules/summon/service.js");
type Eco = typeof import("../../../src/modules/economy/service.js");
let svc: Svc;
let eco: Eco;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/summon/service.js");
  eco = await import("../../../src/modules/economy/service.js");
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

const T0 = Date.UTC(2026, 0, 1, 10, 25, 0);
const cfg = (o: Partial<{ baseRolls: number; rollIntervalMin: number; resetOffsetMin: number }> = {}) => ({
  baseRolls: 3,
  rollIntervalMin: 60,
  resetOffsetMin: 0,
  ...o,
});

describe("consumeRoll", () => {
  it("respeita o limite, informa o reset exato e reinicia ao mudar a janela", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const a = await svc.consumeRoll(g, u, cfg(), { now: T0 });
    expect(a).toMatchObject({ source: "window", used: 1, remaining: 2, limit: 3 });
    await svc.consumeRoll(g, u, cfg(), { now: T0 + 1000 });
    await svc.consumeRoll(g, u, cfg(), { now: T0 + 2000 });
    const err = await svc.consumeRoll(g, u, cfg(), { now: T0 + 3000 }).catch((e) => e);
    expect(err.key).toBe("summon.rolls_exhausted");
    expect(err.params.nextWindowStart).toBe(nextWindowStart(60, 0, T0));
    // exatamente na virada
    const next = nextWindowStart(60, 0, T0);
    expect(await svc.consumeRoll(g, u, cfg(), { now: next - 1 }).catch((e) => e.key)).toBe("summon.rolls_exhausted");
    const b = await svc.consumeRoll(g, u, cfg(), { now: next });
    expect(b).toMatchObject({ used: 1, remaining: 2 });
  });

  it("offset desloca a virada", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const c = cfg({ baseRolls: 1, resetOffsetMin: 30 });
    await svc.consumeRoll(g, u, c, { now: T0 }); // 10:25
    expect(await keyOf(svc.consumeRoll(g, u, c, { now: Date.UTC(2026, 0, 1, 10, 29, 59) }))).toBe("summon.rolls_exhausted");
    expect(await keyOf(svc.consumeRoll(g, u, c, { now: Date.UTC(2026, 0, 1, 10, 30, 0) }))).toBe("ok");
  });

  it("10 consumos concorrentes com limite 5 deixam passar exatamente 5 (membro novo)", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => keyOf(svc.consumeRoll(g, u, cfg({ baseRolls: 5 }), { now: T0 })))
    );
    expect(rs.filter((r) => r === "ok")).toHaveLength(5);
    expect(rs.filter((r) => r === "summon.rolls_exhausted")).toHaveLength(5);
    const [m] = await t.sql`SELECT rolls_used, aether_balance FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`;
    expect(m.rolls_used).toBe(5);
    expect(Number(m.aether_balance)).toBe(eco.WELCOME_AETHER);
  });

  it("usa rolls empilhados quando a janela esgota e refundRoll devolve", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    await t.sql`UPDATE guild_members SET stacked_rolls = 2 WHERE guild_id = ${g}`;
    const c = cfg({ baseRolls: 1 });
    expect((await svc.consumeRoll(g, u, c, { now: T0 })).source).toBe("window");
    const s1 = await svc.consumeRoll(g, u, c, { now: T0 });
    expect(s1).toMatchObject({ source: "stacked", stacked: 1 });
    await svc.consumeRoll(g, u, c, { now: T0 });
    expect(await keyOf(svc.consumeRoll(g, u, c, { now: T0 }))).toBe("summon.rolls_exhausted");
    await svc.refundRoll(g, u, s1);
    expect((await svc.consumeRoll(g, u, c, { now: T0 })).source).toBe("stacked");
  });

  it("getTimers reflete uso, reset exato e janela nova", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await svc.consumeRoll(g, u, cfg(), { now: T0 });
    await svc.consumeRoll(g, u, cfg(), { now: T0 });
    const full = { ...cfg(), claimCooldownMinutes: 180, pactsPerWindow: 1 };
    const tm = await svc.getTimers(g, u, full, T0);
    expect(tm.rolls).toEqual({ used: 2, limit: 3, remaining: 1, nextResetAt: nextWindowStart(60, 0, T0) });
    expect(tm.pacts.ready).toBe(true);
    expect(tm.daily.available).toBe(true);
    const later = await svc.getTimers(g, u, full, T0 + 3600_000);
    expect(later.rolls.remaining).toBe(3);
  });
});

describe("economy", () => {
  it("credit/debit seguros: nunca negativo sob concorrencia", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 500);
    const rs = await Promise.all(Array.from({ length: 10 }, () => keyOf(eco.debit(g, u, 100))));
    expect(rs.filter((r) => r === "ok")).toHaveLength(5);
    expect(rs.filter((r) => r === "errors.insufficient_aether")).toHaveLength(5);
    expect(await eco.getBalance(g, u)).toBe(0);
    expect(await eco.credit(g, u, 40)).toBe(40);
    const e = await eco.debit(g, u, 41).catch((x) => x);
    expect(e.params).toEqual({ cost: 41, balance: 40 });
  });

  it("claimDaily e atomico: 5 simultaneos, 1 vale; segundo cai no cooldown", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 0);
    await t.sql`UPDATE guild_members SET rolls_used = 9, pacts_used = 1 WHERE guild_id = ${g}`;
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () => eco.claimDaily(g, u)));
    const ok = rs.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<Eco["claimDaily"]>>> => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(ok[0].value.reward).toBeGreaterThanOrEqual(350);
    expect(ok[0].value.reward).toBeLessThan(600);
    for (const r of rs) {
      if (r.status === "rejected") expect((r.reason as { key: string }).key).toBe("economy.daily_cooldown");
    }
    const [m] = await t.sql`SELECT aether_balance, stacked_rolls, rolls_used, pacts_used FROM guild_members WHERE guild_id = ${g}`;
    expect(Number(m.aether_balance)).toBe(ok[0].value.reward);
    expect(m).toMatchObject({ stacked_rolls: 5, rolls_used: 0, pacts_used: 0 });
  });

  it("dissolvePact devolve o valor uma vez so", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 0);
    const e = await seedEntity(t.sql, "Dissolvable", { baseAether: 200 });
    const [{ id }] = await t.sql`
      INSERT INTO pacts (guild_id, user_id, entity_id, aether_at_bind, awakening_keys)
      VALUES (${g}, ${u}, ${e}, 350, 1) RETURNING id::int AS id`;
    const rs = await Promise.allSettled([eco.dissolvePact(g, u, id), eco.dissolvePact(g, u, id)]);
    const ok = rs.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(await eco.getBalance(g, u)).toBe(350); // max(valor atual 200, aether_at_bind 350)
    const [{ n }] = await t.sql`SELECT count(*)::int n FROM pacts WHERE guild_id = ${g}`;
    expect(n).toBe(0);
  });
});

describe("performSummon", () => {
  const guildCfg = (id: string) => ({
    id,
    ...cfg({ baseRolls: 5 }),
    claimCooldownMinutes: 180,
    pactsPerWindow: 1,
    claimWindowSeconds: 45,
    snipeProtectionLevel: 1,
    snipeProtectionSeconds: 8,
    aetherSnipeProtectionLevel: 0,
    aetherSnipeProtectionSeconds: 8,
    releaseBoostEnabled: true,
    allowAdult: false,
  });

  it("fluxo completo: oferta com protecao; dono rolando o proprio ganha selo e orbe", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 5 });
    const e = await seedEntity(t.sql, "Only One", { baseAether: 100, type: "DOMAIN", gender: "ITEM" });
    const filter = { type: "DOMAIN" as const };
    const now = Date.now(); // o banco compara expires_at com now() real
    const r1 = await svc.performSummon({ guild: guildCfg(g), userId: u, channelId: "c1", filter, now });
    expect(r1.entity.id).toBe(e);
    expect(r1.offer.protectedUntil?.getTime()).toBe(now + 8000);
    expect(r1.orbAether).toBeNull();

    const claimed = await (await import("../../../src/modules/summon/offers.js")).claimPact(r1.offer.id, u, { now });
    expect(claimed.entityId).toBe(e);

    const r2 = await svc.performSummon({ guild: guildCfg(g), userId: u, channelId: "c1", filter, now });
    expect(r2.awardedKey).toBe(true);
    expect(r2.awakeningKeys).toBe(2);
    expect(r2.variant).toBe(r1.variant);
    expect(r2.orbAether).toBeGreaterThanOrEqual(25);
    expect(r2.entity.pact?.userId).toBe(u);
    expect(r2.consumption.used).toBe(2);
  });

  it("sem entidade elegivel: erro e o roll volta", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 5 });
    await seedMember(t.sql, g, u);
    // outro universo/filtro sem nenhuma entidade
    const err = await svc
      .performSummon({ guild: guildCfg(g), userId: u, channelId: "c1", filter: { universe: "CINEMA" }, now: T0 })
      .catch((e) => e);
    expect(err.key).toBe("summon.no_entity");
    const [m] = await t.sql`SELECT rolls_used FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`;
    expect(m.rolls_used).toBe(0);
  });
});
