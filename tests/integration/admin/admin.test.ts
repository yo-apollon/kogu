import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Message } from "discord.js";
import { seedEntity, seedGuild, seedMember, seedPact, setupTestDb, uid, type TestDb } from "./helpers.js";

type Svc = typeof import("../../../src/modules/admin/service.js");
type Db = typeof import("../../../src/infra/db/client.js").db;

let t: TestDb;
let svc: Svc;
let db: Db;
const savedOwners = process.env.OWNER_IDS;

beforeAll(async () => {
  // Antes de qualquer import de src/config/env.js (o valor fica em cache).
  process.env.OWNER_IDS = "owner-boss";
  t = await setupTestDb();
  svc = await import("../../../src/modules/admin/service.js");
  db = (await import("../../../src/infra/db/client.js")).db;
}, 120_000);
afterAll(async () => {
  await t?.stop();
  if (savedOwners === undefined) delete process.env.OWNER_IDS;
  else process.env.OWNER_IDS = savedOwners;
}, 60_000);

const one = async <T = any>(q: PromiseLike<readonly unknown[]>): Promise<T> => (await q)[0] as T;

describe("setVipTier", () => {
  it("cria o usuario, atualiza o tier e tier 0 remove o VIP", async () => {
    const id = uid("vip");
    expect(await svc.setVipTier(db, { id, username: "Bob" }, 2)).toEqual({ id, tier: 2, isVip: true });
    expect(await one(t.sql`SELECT username, vip_tier, is_vip FROM users WHERE id = ${id}`)).toEqual({
      username: "Bob",
      vip_tier: 2,
      is_vip: true,
    });
    await svc.setVipTier(db, { id }, 3);
    expect(await one(t.sql`SELECT username, vip_tier, is_vip FROM users WHERE id = ${id}`)).toMatchObject({
      username: "Bob", // sem username novo, preserva
      vip_tier: 3,
      is_vip: true,
    });
    await svc.setVipTier(db, { id }, 0);
    expect(await one(t.sql`SELECT vip_tier, is_vip FROM users WHERE id = ${id}`)).toEqual({ vip_tier: 0, is_vip: false });
  });

  it("tier fora de 0..3 lanca e nao grava; nao mexe em outros usuarios", async () => {
    const id = uid("vip");
    const other = uid("vip");
    await svc.setVipTier(db, { id: other }, 1);
    for (const bad of [-1, 4, 1.5, Number.NaN]) {
      await expect(svc.setVipTier(db, { id }, bad)).rejects.toThrow(RangeError);
    }
    expect(await t.sql`SELECT 1 FROM users WHERE id = ${id}`).toHaveLength(0);
    expect((await one(t.sql`SELECT vip_tier FROM users WHERE id = ${other}`)).vip_tier).toBe(1);
  });
});

describe("restoreRolls", () => {
  const cfg = { baseRolls: 10, rollIntervalMin: 60, resetOffsetMin: 0, claimIntervalMin: 180 };
  const NOW = Date.UTC(2026, 0, 1, 10, 25, 0);

  it("cria o membro e deixa rolls_used=0, pacts_used=0 e stacked_rolls=50 na janela atual", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const out = await svc.restoreRolls(db, { guildId: g, userId: u, username: "dono", ...cfg, now: NOW });
    expect(out).toEqual({ rolls: 10, stacked: 50, rollsUsed: 0 });
    const m = await one(
      t.sql`SELECT rolls_used, rolls_window, pacts_used, pact_window, stacked_rolls, aether_balance::int AS aether
            FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`
    );
    expect(m).toMatchObject({
      rolls_used: 0,
      rolls_window: Math.floor(Math.floor(NOW / 60_000) / 60),
      pacts_used: 0,
      pact_window: Math.floor(Math.floor(NOW / 60_000) / 180),
      stacked_rolls: 50,
    });
  });

  it("restaura de verdade: depois de esgotar os rolls da janela, o consumo volta a funcionar", async () => {
    const summon = await import("../../../src/modules/summon/service.js");
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u);
    const c = { baseRolls: 3, rollIntervalMin: 60, resetOffsetMin: 0 };
    for (let i = 0; i < 3; i++) await summon.consumeRoll(g, u, c, { now: NOW });
    expect(await summon.consumeRoll(g, u, c, { now: NOW }).then(() => "ok", (e) => e.key)).toBe("summon.rolls_exhausted");
    await t.sql`UPDATE guild_members SET pacts_used = 1, stacked_rolls = 0 WHERE guild_id = ${g} AND user_id = ${u}`;

    await svc.restoreRolls(db, { guildId: g, userId: u, ...cfg, baseRolls: 3, now: NOW });
    const m = await one(t.sql`SELECT rolls_used, pacts_used, stacked_rolls FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`);
    expect(m).toEqual({ rolls_used: 0, pacts_used: 0, stacked_rolls: 50 });
    for (let i = 0; i < 3; i++) {
      expect((await summon.consumeRoll(g, u, c, { now: NOW })).source).toBe("window");
    }
    expect((await summon.consumeRoll(g, u, c, { now: NOW })).source).toBe("stacked");
  });

  it("[n] menor que o limite deixa so n; maior vira empilhado", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    expect(await svc.restoreRolls(db, { guildId: g, userId: u, ...cfg, rolls: 3, now: NOW })).toEqual({
      rolls: 3,
      stacked: 50,
      rollsUsed: 7,
    });
    expect((await one(t.sql`SELECT rolls_used FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`)).rolls_used).toBe(7);
    expect(await svc.restoreRolls(db, { guildId: g, userId: u, ...cfg, rolls: 25, now: NOW })).toEqual({
      rolls: 25,
      stacked: 65,
      rollsUsed: 0,
    });
    expect((await one(t.sql`SELECT stacked_rolls FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`)).stacked_rolls).toBe(65);
  });

  it("so afeta o membro e o servidor pedidos", async () => {
    const g = uid("g");
    const me = uid("u");
    const other = uid("u");
    await seedMember(t.sql, g, other);
    await t.sql`UPDATE guild_members SET rolls_used = 8, stacked_rolls = 2 WHERE guild_id = ${g} AND user_id = ${other}`;
    await svc.restoreRolls(db, { guildId: g, userId: me, ...cfg, now: NOW });
    expect(await one(t.sql`SELECT rolls_used, stacked_rolls FROM guild_members WHERE guild_id = ${g} AND user_id = ${other}`)).toEqual({
      rolls_used: 8,
      stacked_rolls: 2,
    });
  });
});

describe("cleanuser", () => {
  it("libera todos os pactos do usuario no servidor e so eles", async () => {
    const g1 = uid("g");
    const g2 = uid("g");
    const a = uid("u");
    const b = uid("u");
    for (let i = 0; i < 3; i++) await seedPact(t.sql, g1, a, await seedEntity(t.sql, `Clean A${uid("e")}`));
    await seedPact(t.sql, g1, b, await seedEntity(t.sql, `Clean B${uid("e")}`));
    await seedPact(t.sql, g2, a, await seedEntity(t.sql, `Clean C${uid("e")}`));

    expect(await svc.countUserPacts(db, g1, a)).toBe(3);
    expect(await svc.releaseUserPacts(db, g1, a)).toBe(3);
    expect(await svc.countUserPacts(db, g1, a)).toBe(0);
    expect(await svc.countUserPacts(db, g1, b)).toBe(1);
    expect(await svc.countUserPacts(db, g2, a)).toBe(1);
    expect(await svc.releaseUserPacts(db, g1, a)).toBe(0);
  });
});

describe("thanos", () => {
  async function fill(g: string, unkeyed: number, keyed: number) {
    const u = uid("u");
    for (let i = 0; i < unkeyed; i++) await seedPact(t.sql, g, u, await seedEntity(t.sql, `Thanos U${uid("e")}`));
    for (let i = 0; i < keyed; i++) await seedPact(t.sql, g, u, await seedEntity(t.sql, `Thanos K${uid("e")}`), { keys: 2 });
  }
  const count = async (g: string, keyed?: boolean) =>
    (
      await one<{ n: number }>(
        t.sql`SELECT count(*)::int AS n FROM pacts WHERE guild_id = ${g} ${
          keyed === undefined ? t.sql`` : keyed ? t.sql`AND awakening_keys > 0` : t.sql`AND awakening_keys = 0`
        }`
      )
    ).n;

  it("remove cerca de metade dos pactos SEM Selos, so no servidor pedido", async () => {
    const g = uid("g");
    const other = uid("g");
    await fill(g, 20, 4);
    await fill(other, 6, 1);
    expect(await svc.countThanosCandidates(db, g)).toBe(20);

    let i = 0;
    const alternating = () => (i++ % 2 === 0 ? 0.1 : 0.9); // metade exata
    const out = await svc.snapThanos(db, g, alternating);
    expect(out).toEqual({ eligible: 20, removed: 10 });
    expect(await count(g, false)).toBe(10);
    expect(await count(g, true)).toBe(4); // com Selos: intactos
    expect(await count(other)).toBe(7); // outro servidor: intacto
  });

  it("sorteio sem vitimas nao remove nada", async () => {
    const g = uid("g");
    await fill(g, 5, 0);
    expect(await svc.snapThanos(db, g, () => 0.99)).toEqual({ eligible: 5, removed: 0 });
    expect(await count(g)).toBe(5);
  });

  it("e transacional: falha no meio nao remove nada", async () => {
    const g = uid("g");
    await fill(g, 6, 0);
    let n = 0;
    const boom = () => {
      if (++n === 4) throw new Error("falha no sorteio");
      return 0.1;
    };
    await expect(svc.snapThanos(db, g, boom)).rejects.toThrow("falha no sorteio");
    expect(await count(g)).toBe(6);
  });

  it("rng padrao: resultado entre 0 e o total e coerente com a contagem", async () => {
    const g = uid("g");
    await fill(g, 30, 2);
    const out = await svc.snapThanos(db, g);
    expect(out.eligible).toBe(30);
    expect(out.removed).toBeGreaterThanOrEqual(0);
    expect(out.removed).toBeLessThanOrEqual(30);
    expect(await count(g)).toBe(32 - out.removed);
  });
});

describe("$setvip e $adminreset so para OWNER_IDS (pipeline real de comandos)", () => {
  const TARGET = "123456789012345678";

  async function run(commandName: "setvip" | "adminreset", content: string, userId: string, isAdmin: boolean) {
    const { createCommandPipeline, createPrefixInvocation } = await import("../../../src/core/context.js");
    const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
    const { adminCommands } = await import("../../../src/modules/admin/commands.js");
    const command = adminCommands.find((c) => c.name === commandName)!;
    const guild = { id: uid("g") };
    const config = {
      id: guild.id,
      prefix: "$",
      locale: "pt-BR" as const,
      baseRolls: 10,
      rollIntervalMin: 60,
      resetOffsetMin: 0,
      claimIntervalMin: 180,
      claimWindowSeconds: 45,
      snipeProtectionLevel: 0,
      snipeProtectionSeconds: 8,
      pactLimit: 8100,
      releaseBoostEnabled: true,
      allowAdult: false,
    };
    const sent: any[] = [];
    const message = {
      content,
      author: { id: userId, username: `n-${userId}`, bot: false },
      guild,
      member: { permissions: { has: vi.fn(() => isAdmin) } },
      mentions: { users: new Map([[TARGET, { id: TARGET, username: "alvo" }]]) },
      channel: { send: vi.fn(async (p: unknown) => (sent.push(p), { id: "s" })), sendTyping: vi.fn() },
      reply: vi.fn(async (p: unknown) => (sent.push(p), { id: "r" })),
    } as unknown as Message<true>;
    const pipeline = createCommandPipeline({
      kv: new MemoryStore(),
      guildConfigs: { get: async () => config },
    });
    const tokens = content.split(/\s+/).slice(1);
    await pipeline(createPrefixInvocation(message, command, tokens, commandName, config));
    const text = sent
      .flatMap((p) => (p.embeds ?? []).map((e: any) => e.toJSON().description))
      .join("\n");
    return { text, guildId: guild.id };
  }

  it("administrador de servidor que nao e owner e negado e nada e gravado", async () => {
    const r = await run("setvip", `$setvip <@${TARGET}> 3`, uid("admin"), true);
    expect(r.text).toContain("Apenas o criador do bot");
    expect(await t.sql`SELECT 1 FROM users WHERE id = ${TARGET}`).toHaveLength(0);
  });

  it("owner define o VIP", async () => {
    const r = await run("setvip", `$setvip <@${TARGET}> 3`, "owner-boss", false);
    expect(r.text).toContain("Tier 3");
    expect(await one(t.sql`SELECT vip_tier, is_vip, username FROM users WHERE id = ${TARGET}`)).toEqual({
      vip_tier: 3,
      is_vip: true,
      username: "alvo",
    });
  });

  it("$godmode de administrador nao-owner e negado; do owner restaura", async () => {
    const denied = await run("adminreset", "$godmode 4", uid("admin"), true);
    expect(denied.text).toContain("Apenas o criador do bot");
    expect(await t.sql`SELECT 1 FROM guild_members WHERE guild_id = ${denied.guildId}`).toHaveLength(0);

    const ok = await run("adminreset", "$resetme 4", "owner-boss", false);
    expect(ok.text).toContain("restaurados para **4**");
    const m = await one(
      t.sql`SELECT rolls_used, stacked_rolls FROM guild_members WHERE guild_id = ${ok.guildId} AND user_id = 'owner-boss'`
    );
    expect(m).toEqual({ rolls_used: 6, stacked_rolls: 50 });
  });
});
