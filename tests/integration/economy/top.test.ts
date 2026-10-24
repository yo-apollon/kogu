import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  componentsJson,
  embedJson,
  embedText,
  fakeButton,
  fakeCtx,
  fakeUser,
  seedEntity,
  seedGuild,
  seedMember,
  seedPact,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

type Extra = typeof import("../../../src/modules/economy/extra.js");
type Commands = typeof import("../../../src/modules/economy/commands.js");
type Redis = typeof import("../../../src/infra/redis/client.js");

let t: TestDb;
let ex: Extra;
let cmds: Commands;
let redis: Redis;

beforeAll(async () => {
  t = await setupTestDb();
  ex = await import("../../../src/modules/economy/extra.js");
  cmds = await import("../../../src/modules/economy/commands.js");
  redis = await import("../../../src/infra/redis/client.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

/** Servidor com jogadores de Eter conhecido (ids ordenaveis para o desempate). */
async function seedRanking(balances: Record<string, number>) {
  const g = uid("g");
  await seedGuild(t.sql, g);
  for (const [user, aether] of Object.entries(balances)) await seedMember(t.sql, g, user, aether);
  return g;
}

describe("getTopPage: Eter", () => {
  it("ordena por Eter decrescente com desempate por user_id e pagina", async () => {
    const g = await seedRanking({ m03: 100, m01: 9000, m05: 3000, m02: 9000, m04: 500 });
    const p1 = await ex.getTopPage(g, "aether", 1, 2);
    expect(p1.total).toBe(5);
    expect(p1.rows).toEqual([
      { rank: 1, userId: "m01", value: 9000 },
      { rank: 2, userId: "m02", value: 9000 },
    ]);
    const p2 = await ex.getTopPage(g, "aether", 2, 2);
    expect(p2.rows).toEqual([
      { rank: 3, userId: "m05", value: 3000 },
      { rank: 4, userId: "m04", value: 500 },
    ]);
    const p3 = await ex.getTopPage(g, "aether", 3, 2);
    expect(p3.rows).toEqual([{ rank: 5, userId: "m03", value: 100 }]);
    expect((await ex.getTopPage(g, "aether", 4, 2)).rows).toEqual([]);
  });

  it("isola por servidor", async () => {
    const a = await seedRanking({ a1: 10, a2: 20 });
    const b = await seedRanking({ b1: 99 });
    expect((await ex.getTopPage(a, "aether", 1, 10)).rows.map((r) => r.userId)).toEqual([
      "a2",
      "a1",
    ]);
    expect((await ex.getTopPage(b, "aether", 1, 10)).total).toBe(1);
  });

  it("servidor vazio devolve lista vazia", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    expect(await ex.getTopPage(g, "aether", 1, 10)).toEqual({ rows: [], total: 0 });
    expect(await ex.getTopPage(g, "pacts", 1, 10)).toEqual({ rows: [], total: 0 });
  });
});

describe("getTopPage: pactos", () => {
  it("conta pactos por jogador, ignora quem nao tem e desempata por user_id", async () => {
    const g = await seedRanking({ p01: 0, p02: 0, p03: 0, p04: 0 });
    const other = await seedRanking({ o01: 0 });
    const give = async (guild: string, user: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const e = await seedEntity(t.sql, `Ent ${user} ${i} ${guild}`);
        await seedPact(t.sql, { guildId: guild, userId: user, entityId: e });
      }
    };
    await give(g, "p03", 3);
    await give(g, "p01", 3);
    await give(g, "p02", 1);
    await give(other, "o01", 9); // outro servidor nao entra

    const page = await ex.getTopPage(g, "pacts", 1, 10);
    expect(page.total).toBe(3); // p04 nao tem pacto
    expect(page.rows).toEqual([
      { rank: 1, userId: "p01", value: 3 },
      { rank: 2, userId: "p03", value: 3 },
      { rank: 3, userId: "p02", value: 1 },
    ]);
    const second = await ex.getTopPage(g, "pacts", 2, 2);
    expect(second.rows).toEqual([{ rank: 3, userId: "p02", value: 1 }]);
    expect(second.total).toBe(3);
  });
});

describe("comando $top", () => {
  it("lista o ranking por Eter com mencoes e a linha de criterio", async () => {
    const g = await seedRanking({ t01: 700, t02: 9100 });
    const { ctx, replies } = fakeCtx({
      guildId: g,
      user: fakeUser("t01"),
      args: { mode: "aether" },
    });
    await cmds.topCommand.execute(ctx);
    const text = embedText(replies[0]);
    expect(text).toContain("**#1** <@t02> — **9.100 Éter 💠**");
    expect(text).toContain("**#2** <@t01> — **700 Éter 💠**");
    const buttons = componentsJson(replies[0]);
    expect(buttons.map((b) => b.custom_id)).toEqual(["ec:top:aether:t01", "ec:top:pacts:t01"]);
    expect(buttons[0].disabled).toBe(true);
  });

  it("pagina em 10 por pagina com navegacao do paginador", async () => {
    const balances = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`r${String(i).padStart(2, "0")}`, 10_000 - i])
    );
    const g = await seedRanking(balances);
    const kv = await redis.getKV();
    const paginator = await cmds.buildTopPaginator({
      kv,
      guildId: g,
      mode: "aether",
      ownerId: "r00",
      locale: "pt-BR",
    });
    try {
      expect(paginator.totalPages).toBe(3);
      const lines = embedJson(paginator.payload).description.split("\n");
      expect(lines).toHaveLength(10);
      expect(lines[0]).toContain("**#1** <@r00>");
      expect(embedJson(paginator.payload).footer.text).toBe("Página 1/3");
      const ids = componentsJson(paginator.payload).map((c) => c.custom_id as string);
      expect(ids.some((id) => id.startsWith("pg:"))).toBe(true);
      expect(ids).toContain("ec:top:pacts:r00");
    } finally {
      await paginator.stop();
    }
  });

  it("botao ec:top: dono troca para pactos; intruso e barrado", async () => {
    const g = await seedRanking({ b01: 5, b02: 6 });
    const e = await seedEntity(t.sql, `Botao ${g}`);
    await seedPact(t.sql, { guildId: g, userId: "b01", entityId: e });

    const intruder = fakeButton({
      customId: "ec:top:pacts:b01",
      guildId: g,
      user: fakeUser("zzz"),
    });
    await cmds.economyComponent.handle(intruder as never, ["top", "pacts", "b01"]);
    expect(intruder.update).not.toHaveBeenCalled();
    expect((intruder.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });

    const owner = fakeButton({ customId: "ec:top:pacts:b01", guildId: g, user: fakeUser("b01") });
    await cmds.economyComponent.handle(owner as never, ["top", "pacts", "b01"]);
    const payload = (owner.update.mock.calls[0] as unknown[])[0] as any;
    const text = embedText(payload);
    expect(text).toContain("Ranking de Pactos");
    expect(text).toContain("**#1** <@b01> — **1 pacto**");
    const buttons = componentsJson(payload);
    expect(buttons.find((b) => b.custom_id === "ec:top:pacts:b01").disabled).toBe(true);
    expect(buttons.find((b) => b.custom_id === "ec:top:aether:b01").disabled).toBe(false);
  });
});
