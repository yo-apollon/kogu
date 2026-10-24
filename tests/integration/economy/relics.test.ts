import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  componentsJson,
  embedText,
  fakeButton,
  fakeCtx,
  fakeUser,
  seedGuild,
  seedMember,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

type Extra = typeof import("../../../src/modules/economy/extra.js");
type Commands = typeof import("../../../src/modules/economy/commands.js");
type Service = typeof import("../../../src/modules/economy/service.js");

let t: TestDb;
let ex: Extra;
let cmds: Commands;
let svc: Service;

beforeAll(async () => {
  t = await setupTestDb();
  ex = await import("../../../src/modules/economy/extra.js");
  cmds = await import("../../../src/modules/economy/commands.js");
  svc = await import("../../../src/modules/economy/service.js");
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

async function member(aether: number, relics: Record<string, number> = {}) {
  const g = uid("g");
  const u = uid("u");
  await seedGuild(t.sql, g);
  await seedMember(t.sql, g, u, aether);
  for (const [name, level] of Object.entries(relics)) {
    await t.sql.unsafe(
      `UPDATE guild_members SET relic_${name} = ${Number(level)} WHERE guild_id = $1 AND user_id = $2`,
      [g, u]
    );
  }
  return { g, u };
}

const row = async (g: string, u: string): Promise<Record<string, any>> => {
  const [m] = await t.sql`
    SELECT aether_balance, relic_bronze, relic_silver, relic_gold, relic_sapphire, relic_ruby, relic_emerald
    FROM guild_members WHERE guild_id = ${g} AND user_id = ${u}`;
  return { ...m, aether_balance: Number(m.aether_balance) };
};

describe("upgradeRelic", () => {
  it("debita o saldo e sobe o nivel, com custo crescente", async () => {
    const { g, u } = await member(2000);
    const a = await ex.upgradeRelic(g, u, "bronze");
    expect(a).toMatchObject({ key: "bronze", fromLevel: 0, toLevel: 1, cost: 500, balance: 1500 });
    expect(a.levels.bronze).toBe(1);
    const b = await ex.upgradeRelic(g, u, "bronze");
    expect(b).toMatchObject({ fromLevel: 1, toLevel: 2, cost: 1000, balance: 500 });
    expect(await row(g, u)).toMatchObject({
      aether_balance: 500,
      relic_bronze: 2,
      relic_silver: 0,
    });
  });

  it("saldo insuficiente: UserError com custo/saldo e nada muda", async () => {
    const { g, u } = await member(499);
    const err = await ex.upgradeRelic(g, u, "bronze", { prefix: "!" }).catch((e) => e);
    expect(err.key).toBe("economy.relic_insufficient");
    expect(err.params).toEqual({ cost: "500", balance: "499", prefix: "!" });
    expect(await row(g, u)).toMatchObject({ aether_balance: 499, relic_bronze: 0 });
  });

  it("nivel maximo: UserError com o nome da reliquia e sem debito", async () => {
    const { g, u } = await member(99_999, { gold: 4 });
    const err = await ex.upgradeRelic(g, u, "gold").catch((e) => e);
    expect(err.key).toBe("economy.relic_max");
    expect(err.params.name).toContain("Ouro");
    expect(await row(g, u)).toMatchObject({ aether_balance: 99_999, relic_gold: 4 });
  });

  it("Rubi no maximo da -25% (bronze nivel 0 custa 375)", async () => {
    const { g, u } = await member(1000, { ruby: 4 });
    const r = await ex.upgradeRelic(g, u, "bronze");
    expect(r.cost).toBe(375);
    expect(r.balance).toBe(625);
  });

  it("membro novo entra com o saldo de boas-vindas e pode evoluir", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const r = await ex.upgradeRelic(g, u, "bronze", { username: "Novata" });
    expect(r.cost).toBe(500);
    expect(r.balance).toBe(svc.WELCOME_AETHER - 500);
    expect(await row(g, u)).toMatchObject({ relic_bronze: 1 });
  });
});

describe("upgradeRelic: atomicidade e concorrencia", () => {
  it("5 evolucoes simultaneas com saldo para uma: exatamente 1 passa", async () => {
    const { g, u } = await member(500);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => keyOf(ex.upgradeRelic(g, u, "bronze")))
    );
    expect(rs.filter((r) => r === "ok")).toHaveLength(1);
    expect(rs.filter((r) => r === "economy.relic_insufficient")).toHaveLength(4);
    expect(await row(g, u)).toMatchObject({ aether_balance: 0, relic_bronze: 1 });
  });

  it("10 simultaneas com saldo de sobra: 4 niveis, 6 recusas e debito exato", async () => {
    const { g, u } = await member(20_000);
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => keyOf(ex.upgradeRelic(g, u, "bronze")))
    );
    expect(rs.filter((r) => r === "ok")).toHaveLength(4);
    expect(rs.filter((r) => r === "economy.relic_max")).toHaveLength(6);
    // 500 + 1000 + 1500 + 2000
    expect(await row(g, u)).toMatchObject({ aether_balance: 15_000, relic_bronze: 4 });
  });

  it("reliquias diferentes em paralelo debitam a soma e nunca deixam o saldo negativo", async () => {
    const { g, u } = await member(1700); // bronze 500 + silver 1000 = 1500; gold (1500) nao cabe junto
    const rs = await Promise.all([
      keyOf(ex.upgradeRelic(g, u, "bronze")),
      keyOf(ex.upgradeRelic(g, u, "silver")),
      keyOf(ex.upgradeRelic(g, u, "gold")),
    ]);
    const final = await row(g, u);
    expect(final.aether_balance).toBeGreaterThanOrEqual(0);
    const bought = final.relic_bronze * 500 + final.relic_silver * 1000 + final.relic_gold * 1500;
    expect(1700 - final.aether_balance).toBe(bought);
    expect(rs.filter((r) => r === "ok").length).toBe(
      final.relic_bronze + final.relic_silver + final.relic_gold
    );
  });

  it("falha depois do debito desfaz o saldo e o nivel (transacao unica)", async () => {
    const { g, u } = await member(6000);
    await t.sql.unsafe(`
      CREATE OR REPLACE FUNCTION arqon_eco_fail() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'falha injetada'; END $$ LANGUAGE plpgsql`);
    await t.sql.unsafe(`
      CREATE TRIGGER arqon_eco_fail BEFORE UPDATE ON guild_members
      FOR EACH ROW WHEN (NEW.relic_emerald > OLD.relic_emerald)
      EXECUTE FUNCTION arqon_eco_fail()`);
    try {
      const outcome = await keyOf(ex.upgradeRelic(g, u, "emerald"));
      expect(outcome).toContain("falha injetada");
      // o debito (executado antes) foi revertido junto
      expect(await row(g, u)).toMatchObject({ aether_balance: 6000, relic_emerald: 0 });
    } finally {
      await t.sql.unsafe(`DROP TRIGGER IF EXISTS arqon_eco_fail ON guild_members`);
      await t.sql.unsafe(`DROP FUNCTION IF EXISTS arqon_eco_fail()`);
    }
    // sem o gatilho a mesma evolucao funciona
    const ok = await ex.upgradeRelic(g, u, "emerald");
    expect(ok).toMatchObject({ cost: 5000, balance: 1000 });
  });
});

describe("comando $k / /relics", () => {
  it("sem argumento abre o altar (cria o membro) com 6 botoes", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const { ctx, replies } = fakeCtx({ guildId: g, user: fakeUser(u), args: {} });
    await cmds.relicsCommand.execute(ctx);
    expect(replies).toHaveLength(1);
    const text = embedText(replies[0]);
    expect(text).toContain("Altar de Relíquias");
    expect(text).toContain(String(svc.WELCOME_AETHER));
    const buttons = componentsJson(replies[0]);
    expect(buttons).toHaveLength(6);
    expect(buttons[0].custom_id).toBe(`ec:rl:bronze:${u}`);
    expect((await row(g, u)).aether_balance).toBe(svc.WELCOME_AETHER);
  });

  it("com argumento evolui e responde com a mensagem de sucesso", async () => {
    const { g, u } = await member(1200);
    const { ctx, replies } = fakeCtx({ guildId: g, user: fakeUser(u), args: { relic: "bronze" } });
    await cmds.relicsCommand.execute(ctx);
    const text = embedText(replies[0]);
    expect(text).toContain("Relíquia Evoluída");
    expect(text).toContain("Nível 1/4");
    expect(text).toContain("700");
    expect(await row(g, u)).toMatchObject({ aether_balance: 700, relic_bronze: 1 });
  });

  it("sem saldo o erro sobe como UserError (o errorBoundary traduz)", async () => {
    const { g, u } = await member(10);
    const { ctx } = fakeCtx({ guildId: g, user: fakeUser(u), args: { relic: "emerald" } });
    const err = await cmds.relicsCommand.execute(ctx).catch((e: any) => e);
    expect(err.key).toBe("economy.relic_insufficient");
    expect(err.params.cost).toBe("5.000");
  });
});

describe("botao ec:rl (componente)", () => {
  it("so o dono usa: outro jogador recebe ephemeral e nada e debitado", async () => {
    const { g, u } = await member(3000);
    const intruder = fakeUser("intruder");
    const click = fakeButton({ customId: `ec:rl:bronze:${u}`, guildId: g, user: intruder });
    await cmds.economyComponent.handle(click as never, ["rl", "bronze", u]);
    expect(click.update).not.toHaveBeenCalled();
    expect((click.reply.mock.calls[0] as unknown[])[0]).toMatchObject({ flags: 64 });
    expect(await row(g, u)).toMatchObject({ aether_balance: 3000, relic_bronze: 0 });
  });

  it("dono: evolui, atualiza o altar e avisa em ephemeral", async () => {
    const { g, u } = await member(3000);
    const click = fakeButton({ customId: `ec:rl:silver:${u}`, guildId: g, user: fakeUser(u) });
    await cmds.economyComponent.handle(click as never, ["rl", "silver", u]);
    expect(await row(g, u)).toMatchObject({ aether_balance: 2000, relic_silver: 1 });

    const updated = (click.update.mock.calls[0] as unknown[])[0] as any;
    expect(embedText(updated)).toContain("2.000");
    const buttons = componentsJson(updated);
    expect(buttons[1].label).toContain("2.000"); // silver nivel 1 -> proximo custo 2000
    const follow = (click.followUp.mock.calls[0] as unknown[])[0] as any;
    expect(follow.flags).toBe(64);
    expect(embedText(follow)).toContain("Relíquia Evoluída");
  });

  it("saldo insuficiente propaga UserError para o roteador responder", async () => {
    const { g, u } = await member(100);
    const click = fakeButton({ customId: `ec:rl:gold:${u}`, guildId: g, user: fakeUser(u) });
    const err = await cmds.economyComponent
      .handle(click as never, ["rl", "gold", u])
      .catch((e: any) => e);
    expect(err.key).toBe("economy.relic_insufficient");
    expect(click.update).not.toHaveBeenCalled();
  });

  it("customId desconhecido ou fora de servidor e ignorado", async () => {
    const { g, u } = await member(3000);
    const bad = fakeButton({ customId: "x", guildId: g, user: fakeUser(u) });
    await cmds.economyComponent.handle(bad as never, ["rl", "platina", u]);
    const dm = fakeButton({ customId: "x", guildId: null, user: fakeUser(u) });
    await cmds.economyComponent.handle(dm as never, ["rl", "bronze", u]);
    expect(bad.update).not.toHaveBeenCalled();
    expect(dm.update).not.toHaveBeenCalled();
    expect((await row(g, u)).aether_balance).toBe(3000);
  });
});
