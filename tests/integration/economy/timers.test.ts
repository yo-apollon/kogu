import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentWindow, discordRelative, nextWindowStart } from "../../../src/lib/time.js";
import {
  componentsJson,
  embedJson,
  embedText,
  fakeCtx,
  fakeUser,
  seedEntity,
  seedFranchise,
  seedGuild,
  seedMember,
  seedPact,
  setupTestDb,
  testGuildConfig,
  uid,
  type TestDb,
} from "./helpers.js";

type Extra = typeof import("../../../src/modules/economy/extra.js");
type Commands = typeof import("../../../src/modules/economy/commands.js");
type Service = typeof import("../../../src/modules/economy/service.js");
type Summon = typeof import("../../../src/modules/summon/service.js");
type Views = typeof import("../../../src/modules/economy/views.js");

let t: TestDb;
let ex: Extra;
let cmds: Commands;
let eco: Service;
let summon: Summon;
let views: Views;

beforeAll(async () => {
  t = await setupTestDb();
  ex = await import("../../../src/modules/economy/extra.js");
  cmds = await import("../../../src/modules/economy/commands.js");
  eco = await import("../../../src/modules/economy/service.js");
  summon = await import("../../../src/modules/summon/service.js");
  views = await import("../../../src/modules/economy/views.js");
}, 120_000);
afterAll(async () => {
  await t?.stop();
}, 60_000);

const T0 = Date.UTC(2026, 0, 1, 10, 25, 0);

describe("timers refletem a janela", () => {
  const cfgOf = (g: string, over = {}) =>
    testGuildConfig(g, { baseRolls: 3, rollIntervalMin: 60, claimIntervalMin: 120, ...over });

  it("getTimersConfig completa pacts_per_window e o intervalo de pacto do banco", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g, { pactsPerWindow: 3, claimCooldownMinutes: 120, baseRolls: 3 });
    const cfg = await ex.getTimersConfig(cfgOf(g));
    expect(cfg).toMatchObject({
      baseRolls: 3,
      rollIntervalMin: 60,
      resetOffsetMin: 0,
      claimCooldownMinutes: 120,
      pactsPerWindow: 3,
      prefix: "$",
    });
    // servidor ainda sem linha em guilds: 1 pacto por janela (padrao)
    expect((await ex.getTimersConfig(cfgOf(uid("novo")))).pactsPerWindow).toBe(1);
  });

  it("uso, reset exato e virada de janela", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 3, claimCooldownMinutes: 120, pactsPerWindow: 2 });
    const cfg = await ex.getTimersConfig(cfgOf(g));

    await summon.consumeRoll(g, u, cfg, { now: T0 });
    await summon.consumeRoll(g, u, cfg, { now: T0 + 1000 });

    const now = await summon.getTimers(g, u, cfg, T0 + 2000);
    expect(now.rolls).toEqual({
      used: 2,
      limit: 3,
      remaining: 1,
      nextResetAt: nextWindowStart(60, 0, T0),
    });
    expect(now.pacts).toMatchObject({ limit: 2, remaining: 2, ready: true });

    // painel com o horario exato do reset
    const embed = views.timersEmbed({ timers: now, locale: "pt-BR", prefix: "$", userName: "Ana" });
    const text = embedText({ embeds: [embed] });
    expect(text).toContain("**1/3**");
    expect(text).toContain(discordRelative(nextWindowStart(60, 0, T0)));

    // 1 ms antes da virada ainda vale; na virada os rolls voltam
    const before = await summon.getTimers(g, u, cfg, nextWindowStart(60, 0, T0) - 1);
    expect(before.rolls.remaining).toBe(1);
    const after = await summon.getTimers(g, u, cfg, nextWindowStart(60, 0, T0));
    expect(after.rolls).toMatchObject({ used: 0, remaining: 3 });
    expect(after.rolls.nextResetAt).toBe(nextWindowStart(60, 0, T0) + 60 * 60_000);
  });

  it("cargas de pacto: gasta na janela e recarrega na janela seguinte", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { claimCooldownMinutes: 120, pactsPerWindow: 2 });
    await seedMember(t.sql, g, u, 0);
    const cfg = await ex.getTimersConfig(cfgOf(g));
    const win = currentWindow(120, 0, T0);

    await t.sql`UPDATE guild_members SET pacts_used = 1, pact_window = ${win} WHERE guild_id = ${g}`;
    expect((await summon.getTimers(g, u, cfg, T0)).pacts).toMatchObject({
      used: 1,
      remaining: 1,
      ready: true,
    });

    await t.sql`UPDATE guild_members SET pacts_used = 2 WHERE guild_id = ${g}`;
    const spent = await summon.getTimers(g, u, cfg, T0);
    expect(spent.pacts).toMatchObject({ remaining: 0, ready: false });
    expect(spent.pacts.nextResetAt).toBe(nextWindowStart(120, 0, T0));
    expect(
      embedText({
        embeds: [
          views.timersEmbed({ timers: spent, locale: "pt-BR", prefix: "$", userName: "Ana" }),
        ],
      })
    ).toContain(discordRelative(nextWindowStart(120, 0, T0)));

    const recharged = await summon.getTimers(g, u, cfg, nextWindowStart(120, 0, T0));
    expect(recharged.pacts).toMatchObject({ used: 0, remaining: 2, ready: true });
  });

  it("offset do servidor desloca o reset exibido", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { resetOffsetMin: 30 });
    const cfg = await ex.getTimersConfig(cfgOf(g, { resetOffsetMin: 30 }));
    const tm = await summon.getTimers(g, u, cfg, Date.UTC(2026, 0, 1, 10, 25, 0));
    expect(tm.rolls.nextResetAt).toBe(Date.UTC(2026, 0, 1, 10, 30, 0));
  });
});

describe("comandos de timers e daily", () => {
  it("$tu mostra rolls usados, empilhados, saldo e daily disponivel", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 3 });
    await seedMember(t.sql, g, u, 777);
    await t.sql`UPDATE guild_members SET stacked_rolls = 4 WHERE guild_id = ${g}`;
    const { ctx, replies } = fakeCtx({
      guildId: g,
      user: fakeUser(u, "Ana"),
      config: { baseRolls: 3 },
    });
    await cmds.timersCommand.execute(ctx);
    const text = embedText(replies[0]);
    expect(text).toContain("Ana");
    expect(text).toContain("**3/3**");
    expect(text).toContain("**4** extras");
    expect(text).toContain("777");
    expect(text).toContain("`$daily`");
    expect(text).toMatch(/<t:\d+:R>/);
  });

  it("$mu, $ru e $ku respondem texto curto", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 5 });
    const run = async (cmd: { execute(ctx: any): Promise<void> }) => {
      const { ctx, replies } = fakeCtx({
        guildId: g,
        user: fakeUser(u, "Ana"),
        config: { baseRolls: 5 },
      });
      await cmd.execute(ctx);
      return replies[0] as string;
    };
    expect(await run(cmds.marryUpCommand)).toContain("pode firmar um Pacto agora");
    const ru = await run(cmds.rollsUpCommand);
    expect(ru).toContain("**5/5**");
    expect(ru).toMatch(/<t:\d+:R>/);
    expect(await run(cmds.kakeraUpCommand)).toContain("Orbes de Éter");
  });

  it("$daily credita, restaura rolls/pacto e o segundo resgate cai no cooldown com horario", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g, { baseRolls: 10 });
    await seedMember(t.sql, g, u, 0);
    await t.sql`UPDATE guild_members SET rolls_used = 9, pacts_used = 1 WHERE guild_id = ${g}`;

    const { ctx, replies } = fakeCtx({ guildId: g, user: fakeUser(u) });
    await cmds.dailyCommand.execute(ctx);
    const text = embedText(replies[0]);
    expect(embedJson(replies[0]).title).toContain("Bônus Dimensional Diário");
    expect(text).toContain("+5 Invocações Empilhadas");
    expect(text).toMatch(/Próximo resgate <t:\d+:R>/);

    const [m] = await t.sql`
      SELECT aether_balance, stacked_rolls, rolls_used, pacts_used FROM guild_members WHERE guild_id = ${g}`;
    expect(Number(m.aether_balance)).toBeGreaterThanOrEqual(350);
    expect(Number(m.aether_balance)).toBeLessThan(600);
    expect(m).toMatchObject({ stacked_rolls: 5, rolls_used: 0, pacts_used: 0 });

    const again = await cmds.dailyCommand
      .execute(fakeCtx({ guildId: g, user: fakeUser(u) }).ctx)
      .catch((e: any) => e);
    expect(again.key).toBe("economy.daily_cooldown");
    expect(again.params.when).toMatch(/^<t:\d+:R>$/);
    expect(again.params.nextAt).toBeGreaterThan(Date.now());

    // $tu agora mostra o daily em cooldown e os 5 empilhados
    const timers = fakeCtx({ guildId: g, user: fakeUser(u) });
    await cmds.timersCommand.execute(timers.ctx);
    const tText = embedText(timers.replies[0]);
    expect(tText).toContain("**5** extras");
    expect(tText).toContain("Próximo resgate");
    expect(tText).not.toContain("Disponível agora");
    expect(eco.DAILY_COOLDOWN_MS).toBeGreaterThan(0);
  });
});

describe("perfil", () => {
  it("getPantheonSummary agrega pactos e escolhe o Lider do Panteao", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 0);
    const franchise = await seedFranchise(t.sql, "Darling in the Franxx");
    const a = await seedEntity(t.sql, `Zero Two ${g}`, { baseAether: 200, franchiseId: franchise });
    const b = await seedEntity(t.sql, `Ichigo ${g}`, { baseAether: 800 });
    // A: Eter na assinatura (350) vale mais que o atual (200 * 1.6 = 320); 10 selos = alma gemea
    await seedPact(t.sql, {
      guildId: g,
      userId: u,
      entityId: a,
      aetherAtBind: 350,
      awakeningKeys: 10,
      sortOrder: 0,
    });
    await seedPact(t.sql, {
      guildId: g,
      userId: u,
      entityId: b,
      aetherAtBind: 100,
      awakeningKeys: 0,
      sortOrder: 5,
    });

    const sum = await ex.getPantheonSummary(g, u);
    expect(sum).toMatchObject({ count: 2, awakeningKeys: 10, soulmates: 1, worth: 350 + 800 });
    // menor sort_order manda: A lidera apesar de valer menos
    expect(sum.leader).toMatchObject({
      name: `Zero Two ${g}`,
      franchise: "Darling in the Franxx",
      aether: 350,
    });
    expect(sum.leader?.imageUrl).toBe(`https://x/${a}.png`);

    // sem sort_order definido o mais valioso lidera
    await t.sql`UPDATE pacts SET sort_order = 0 WHERE guild_id = ${g}`;
    expect((await ex.getPantheonSummary(g, u)).leader?.name).toBe(`Ichigo ${g}`);

    // jogador sem pactos
    const empty = await ex.getPantheonSummary(g, "ninguem");
    expect(empty).toEqual({ count: 0, awakeningKeys: 0, soulmates: 0, worth: 0, leader: null });
  });

  it("getMemberSnapshot le saldo, shards, cor e reliquias; ausente devolve padroes", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 1234);
    await t.sql`UPDATE guild_members SET astral_shards = 7, embed_color = '#112233', relic_gold = 3
                WHERE guild_id = ${g} AND user_id = ${u}`;
    const snap = await ex.getMemberSnapshot(g, u);
    expect(snap).toMatchObject({
      exists: true,
      balance: 1234,
      astralShards: 7,
      embedColor: "#112233",
    });
    expect(snap.relics.gold).toBe(3);
    expect(await ex.getMemberSnapshot(g, "fantasma")).toMatchObject({
      exists: false,
      balance: 0,
      astralShards: 0,
      embedColor: null,
    });
  });

  it("$pr abre o painel (visao geral + select); o proprio perfil cria o membro", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    const { ctx, replies, sent } = fakeCtx({
      guildId: g,
      user: fakeUser(u, "Ana"),
      args: {},
    });
    await cmds.profileCommand.execute(ctx);
    expect(replies).toHaveLength(1);
    const text = embedText(replies[0]);
    expect(text).toContain("Perfil Dimensional — Ana");
    expect(text).toContain(String(eco.WELCOME_AETHER));
    expect(text).toContain("Entidades Seladas: **0**");
    expect(text).toContain("Nenhuma entidade ainda");
    const select = componentsJson(replies[0]).find((c) => String(c.custom_id).startsWith("pn:"));
    expect(select.options.map((o: any) => o.value)).toEqual(["overview", "relics"]);
    expect(sent.edit).not.toHaveBeenCalled();
    const [{ n }] = await t.sql`SELECT count(*)::int n FROM guild_members WHERE guild_id = ${g}`;
    expect(n).toBe(1);
  });

  it("$pr de outro jogador nao cria linha para ele; usuario inexistente da erro", async () => {
    const g = uid("g");
    const u = uid("u");
    const other = "555555555555555555";
    await seedGuild(t.sql, g);
    await seedMember(t.sql, g, u, 10);
    const { ctx, replies } = fakeCtx({
      guildId: g,
      user: fakeUser(u),
      args: { userId: other },
      fetchUser: async (id) => (id === other ? fakeUser(other, "Bia") : null),
    });
    await cmds.profileCommand.execute(ctx);
    const text = embedText(replies[0]);
    expect(text).toContain("Perfil Dimensional — Bia");
    expect(text).toContain("Saldo Atual: **0 Éter**");
    const [{ n }] = await t.sql`SELECT count(*)::int n FROM guild_members WHERE guild_id = ${g}`;
    expect(n).toBe(1); // so o executor

    const missing = fakeCtx({
      guildId: g,
      user: fakeUser(u),
      args: { userId: "666666666666666666" },
      fetchUser: async () => null,
    });
    const err = await cmds.profileCommand.execute(missing.ctx).catch((e: any) => e);
    expect(err.key).toBe("errors.invalid_user");
  });
});
