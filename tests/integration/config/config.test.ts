import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  embedText,
  fakeCtx,
  seedFranchise,
  seedGuild,
  seedMember,
  seedSeries,
  setupTestDb,
  uid,
  type TestDb,
} from "./helpers.js";

type Svc = typeof import("../../../src/modules/config/service.js");
type Cmds = typeof import("../../../src/modules/config/commands.js");
type KvClient = typeof import("../../../src/infra/redis/client.js");
type PubSub = typeof import("../../../src/infra/redis/pubsub.js");
type RollEngine = typeof import("../../../src/modules/summon/rollEngine.js");
type GuildCfg = typeof import("../../../src/core/middleware/guildConfig.js");

let t: TestDb;
let svc: Svc;
let cmds: Cmds;
let kvClient: KvClient;
let pubsub: PubSub;
let rollEngine: RollEngine;
let guildCfg: GuildCfg;

beforeAll(async () => {
  t = await setupTestDb();
  svc = await import("../../../src/modules/config/service.js");
  cmds = await import("../../../src/modules/config/commands.js");
  kvClient = await import("../../../src/infra/redis/client.js");
  pubsub = await import("../../../src/infra/redis/pubsub.js");
  rollEngine = await import("../../../src/modules/summon/rollEngine.js");
  guildCfg = await import("../../../src/core/middleware/guildConfig.js");
}, 120_000);

afterAll(async () => {
  await t?.stop();
}, 60_000);

const errOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e as { key?: string; params?: Record<string, unknown>; message: string };
  }
};

/** Escuta o canal de invalidacao do KV do processo (MemoryStore nos testes). */
async function listenInvalidations() {
  const kv = await kvClient.getKV();
  const events: string[] = [];
  const off = await pubsub.subscribeEvent(kv, "guild:config:invalidate", (p) => {
    events.push(p.guildId);
  });
  return { kv, events, off };
}

async function guildRow(id: string) {
  const [row] = await t.sql`
    SELECT prefix, language, gamemode, base_rolls AS "baseRolls",
           claim_cooldown_minutes AS "claimCooldownMinutes", claim_window_seconds AS "claimWindowSeconds"
    FROM guilds WHERE id = ${id}`;
  return row;
}

describe("applyGuildSetting", () => {
  it("setrolls valida a faixa 1-50 e nao grava valores invalidos", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    for (const bad of [0, 51, "abc", "", "10x", -3, 2.5, undefined, null, "1e2"]) {
      const err = await errOf(svc.applyGuildSetting(g, "rolls", bad, { prefix: "$" }));
      expect(err?.key, String(bad)).toBe("config.setrolls_invalid");
      expect(err?.params).toEqual({ min: 1, max: 50, prefix: "$" });
    }
    expect((await guildRow(g))!.baseRolls).toBe(10);

    for (const good of ["1", 50, " 15 "]) {
      await svc.applyGuildSetting(g, "rolls", good, { prefix: "$" });
    }
    expect((await guildRow(g))!.baseRolls).toBe(15);
  });

  it("setrolls grava e invalida o cache: apaga a chave do KV e publica guild:config:invalidate", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const { kv, events, off } = await listenInvalidations();
    await kv.set(guildCfg.guildConfigKey(g), JSON.stringify({ stale: true }), { px: 60_000 });

    const applied = await svc.applyGuildSetting(g, "rolls", "25", { prefix: "$" });
    expect(applied).toEqual({ key: "rolls", value: 25, windowsReset: false });
    expect((await guildRow(g))!.baseRolls).toBe(25);
    expect(await kv.get(guildCfg.guildConfigKey(g))).toBeNull();
    await vi.waitFor(() => expect(events).toContain(g));
    await off();
  });

  it("setrolls nao zera as janelas dos membros; settimer zera so as da propria guilda", async () => {
    const g = uid("g");
    const other = uid("g");
    await seedGuild(t.sql, g);
    await seedGuild(t.sql, other);
    await seedMember(t.sql, g, uid("u"), { rollsWindow: 7, pactWindow: 9 });
    await seedMember(t.sql, g, uid("u"), { rollsWindow: 8, pactWindow: 10 });
    await seedMember(t.sql, other, uid("u"), { rollsWindow: 7, pactWindow: 9 });
    const windows = async (guildId: string) =>
      t.sql`SELECT rolls_window::int AS r, pact_window::int AS p FROM guild_members
            WHERE guild_id = ${guildId} ORDER BY user_id`;

    await svc.applyGuildSetting(g, "rolls", 12, { prefix: "$" });
    expect(await windows(g)).toEqual([
      { r: 7, p: 9 },
      { r: 8, p: 10 },
    ]);

    const { events, off } = await listenInvalidations();
    const applied = await svc.applyGuildSetting(g, "timer", "120", { prefix: "$" });
    expect(applied).toEqual({ key: "timer", value: 120, windowsReset: true });
    expect((await guildRow(g))!.claimCooldownMinutes).toBe(120);
    expect(await windows(g)).toEqual([
      { r: -1, p: -1 },
      { r: -1, p: -1 },
    ]);
    expect(await windows(other)).toEqual([{ r: 7, p: 9 }]);
    await vi.waitFor(() => expect(events).toContain(g));
    await off();
  });

  it("settimer (30-360) e setclaim (10-120) validam a faixa", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    for (const bad of [29, 361, "x"]) {
      const err = await errOf(svc.applyGuildSetting(g, "timer", bad, { prefix: "!" }));
      expect(err?.key).toBe("config.settimer_invalid");
      expect(err?.params).toEqual({ min: 30, max: 360, prefix: "!" });
    }
    for (const bad of [9, 121]) {
      const err = await errOf(svc.applyGuildSetting(g, "claim", bad, { prefix: "$" }));
      expect(err?.key).toBe("config.setclaim_invalid");
    }
    await svc.applyGuildSetting(g, "claim", 60, { prefix: "$" });
    expect((await guildRow(g))!.claimWindowSeconds).toBe(60);
    expect((await guildRow(g))!.claimCooldownMinutes).toBe(180);
  });

  it("prefix muda a coluna e publica a invalidacao; invalido nao publica", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const { events, off } = await listenInvalidations();

    for (const bad of ["", "abcdefg", "a b", "`", undefined]) {
      const err = await errOf(svc.applyGuildSetting(g, "prefix", bad, { prefix: "$" }));
      expect(err?.key, String(bad)).toBe("config.prefix_invalid");
      expect(err?.params).toMatchObject({ max: 5 });
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(events).not.toContain(g);
    expect((await guildRow(g))!.prefix).toBe("$");

    await svc.applyGuildSetting(g, "prefix", "!!", { prefix: "$" });
    expect((await guildRow(g))!.prefix).toBe("!!");
    await vi.waitFor(() => expect(events).toContain(g));
    await off();
  });

  it("o GuildConfigService enxerga a mudanca depois da invalidacao (prefixo e idioma)", async () => {
    const { db } = await import("../../../src/infra/db/client.js");
    const kv = await kvClient.getKV();
    const service = guildCfg.createGuildConfigService({ kv, db });
    await service.start();
    const g = uid("g");
    expect(await service.get(g)).toMatchObject({ prefix: "$", locale: "pt-BR" });

    await svc.applyGuildSetting(g, "prefix", "?", { prefix: "$" });
    await svc.applyGuildSetting(g, "lang", "en", { prefix: "?" });
    await vi.waitFor(async () => {
      expect(await service.get(g)).toMatchObject({ prefix: "?", locale: "en-US" });
    });
    await service.stop();
  });

  it("gamemode aceita 1 e 2; lang aceita aliases e rejeita idiomas nao suportados", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    expect((await errOf(svc.applyGuildSetting(g, "gamemode", 3, { prefix: "$" })))?.key).toBe(
      "config.gamemode_invalid"
    );
    await svc.applyGuildSetting(g, "gamemode", "2", { prefix: "$" });
    expect((await guildRow(g))!.gamemode).toBe(2);

    const es = await errOf(svc.applyGuildSetting(g, "lang", "es", { prefix: "$" }));
    expect(es?.key).toBe("config.lang_usage");
    for (const [input, stored] of [
      ["en", "en-US"],
      ["EN-us", "en-US"],
      ["pt-br", "pt-BR"],
      ["pt", "pt-BR"],
    ] as const) {
      const applied = await svc.applyGuildSetting(g, "lang", input, { prefix: "$" });
      expect(applied.value).toBe(stored);
      expect((await guildRow(g))!.language).toBe(stored);
    }
  });

  it("cria a linha da guilda se ela ainda nao existir", async () => {
    const g = uid("g");
    await svc.applyGuildSetting(g, "rolls", 7, { prefix: "$" });
    expect(await guildRow(g)).toMatchObject({ baseRolls: 7, prefix: "$" });
  });

  it("getGuildSettings devolve a configuracao completa (cria a linha com padroes)", async () => {
    const g = uid("g");
    const settings = await svc.getGuildSettings(g);
    expect(settings).toMatchObject({
      id: g,
      prefix: "$",
      locale: "pt-BR",
      gamemode: 1,
      baseRolls: 10,
      rollIntervalMin: 60,
      claimCooldownMinutes: 180,
      claimWindowSeconds: 45,
      pactLimit: 8100,
      releaseBoostEnabled: true,
      allowAdult: false,
    });
  });
});

describe("comandos de configuracao (execute com banco real)", () => {
  it("$setrolls responde no idioma do servidor e $lang responde no idioma NOVO", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const rolls = fakeCtx({ guildId: g, userId: "admin", args: { value: "20" } });
    await cmds.setRollsCommand.execute(rolls.ctx);
    expect(embedText(rolls.replies[0])).toContain("20");
    expect((await guildRow(g))!.baseRolls).toBe(20);

    const lang = fakeCtx({ guildId: g, userId: "admin", args: { value: "en" } });
    await cmds.langCommand.execute(lang.ctx);
    expect(embedText(lang.replies[0])).toContain("Server language updated to **en-US**");
  });

  it("valor invalido propaga o UserError de uso (o errorBoundary responde)", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const bad = fakeCtx({ guildId: g, userId: "admin", args: { value: "99" } });
    const err = await errOf(cmds.setRollsCommand.execute(bad.ctx));
    expect(err?.key).toBe("config.setrolls_invalid");
    expect(bad.replies).toHaveLength(0);
  });

  it("$set <config> <valor> usa o mesmo caminho", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const ctx = fakeCtx({ guildId: g, userId: "admin", args: { setting: "timer", value: "90" } });
    await cmds.setCommand.execute(ctx.ctx);
    expect((await guildRow(g))!.claimCooldownMinutes).toBe(90);
  });

  it("$settings abre o painel com todas as secoes", async () => {
    const g = uid("g");
    await seedGuild(t.sql, g);
    const ctx = fakeCtx({ guildId: g, userId: "admin", args: {} });
    await cmds.settingsCommand.execute(ctx.ctx);
    const payload = ctx.replies[0];
    const text = embedText(payload);
    expect(text).toContain("Guilda de Teste");
    expect(text).toContain("`$`");
    expect(text).toContain("8100");
    const select = payload.components[0].toJSON().components[0];
    expect(select.options.map((o: any) => o.value)).toEqual([
      "overview",
      "rolls",
      "timers",
      "locale",
      "advanced",
      "disabled",
    ]);
  });
});

describe("series desativadas", () => {
  let frieren: number;
  let fateZero: number;
  let fateStay: number;
  let pokemon: number;
  let fate: number;

  beforeAll(async () => {
    fate = await seedFranchise(t.sql, "Fate");
    frieren = await seedSeries(t.sql, "Sousou no Frieren");
    fateZero = await seedSeries(t.sql, "Fate/Zero", fate);
    fateStay = await seedSeries(t.sql, "Fate/stay night", fate);
    pokemon = await seedSeries(t.sql, "Pokémon");
    for (let i = 0; i < 30; i++) await seedSeries(t.sql, `Serie bulk ${i}`);
  });

  const target = (kind: "series" | "franchise", id: number, name: string) => ({ kind, id, name });

  it("busca series e franquias: parcial, ordem, exata primeiro, similaridade e LIMIT 25", async () => {
    const frierenHits = await svc.searchTargets("frieren");
    expect(frierenHits).toEqual([target("series", frieren, "Sousou no Frieren")]);
    expect((await svc.searchTargets("sousou frieren"))[0]!.id).toBe(frieren);

    const fateHits = await svc.searchTargets("fate");
    expect(fateHits[0]).toEqual(target("franchise", fate, "Fate"));
    expect(fateHits.map((h) => h.id)).toEqual(expect.arrayContaining([fateZero, fateStay]));

    expect((await svc.searchTargets("fate zero"))[0]).toEqual(target("series", fateZero, "Fate/Zero"));
    expect((await svc.searchTargets("pokemon"))[0]!.id).toBe(pokemon);
    expect((await svc.searchTargets("bulk")).length).toBe(25);
    expect(await svc.searchTargets("")).toEqual([]);
    expect(await svc.searchTargets("%%%")).toEqual([]);
  });

  it("resolveTarget: s:N, f:N e texto; id inexistente devolve null", async () => {
    expect(await svc.resolveTarget(`s:${frieren}`)).toEqual(target("series", frieren, "Sousou no Frieren"));
    expect(await svc.resolveTarget(`f:${fate}`)).toEqual(target("franchise", fate, "Fate"));
    expect((await svc.resolveTarget("stay night"))?.id).toBe(fateStay);
    expect(await svc.resolveTarget("s:999999")).toBeNull();
    expect(await svc.resolveTarget("zzzqqq")).toBeNull();
  });

  it("autocompleteTargets: cache de 60 s no KV e consulta curta nao busca", async () => {
    const kv = await kvClient.getKV();
    const search = vi.fn(svc.searchTargets);
    const a = await svc.autocompleteTargets(kv, "frieren", { search });
    const b = await svc.autocompleteTargets(kv, "FRIEREN", { search });
    expect(b).toEqual(a);
    expect(search).toHaveBeenCalledTimes(1);
    expect(await svc.autocompleteTargets(kv, "f", { search })).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("disableTarget/enableTarget por usuario: idempotente, invalida o cache e o roll enxerga a mudanca", async () => {
    const g = uid("g");
    const u = uid("u");
    const kv = await kvClient.getKV();
    await seedGuild(t.sql, g);

    await kv.set(rollEngine.disabledUserKey(g, u), JSON.stringify({ series: [], franchises: [] }), {
      px: 60_000,
    });
    const frierenTarget = target("series", frieren, "Sousou no Frieren");
    expect(await svc.disableTarget({ guildId: g, userId: u, target: frierenTarget })).toEqual({
      created: true,
    });
    expect(await kv.get(rollEngine.disabledUserKey(g, u))).toBeNull();
    expect(await svc.disableTarget({ guildId: g, userId: u, target: frierenTarget })).toEqual({
      created: false,
    });
    await svc.disableTarget({ guildId: g, userId: u, target: target("franchise", fate, "Fate") });

    const sets = await rollEngine.loadDisabledSets(kv, g, u);
    expect(sets.series).toEqual([frieren]);
    expect(sets.franchises).toEqual([fate]);
    // outro usuario nao e afetado
    expect(await rollEngine.loadDisabledSets(kv, g, uid("u"))).toEqual({ series: [], franchises: [] });

    const list = await svc.listDisabled(g, u);
    expect(list.map((e) => e.name)).toEqual(["Sousou no Frieren", "Fate"]);

    expect(await svc.enableTarget({ guildId: g, userId: u, target: frierenTarget })).toBe(1);
    expect(await svc.enableTarget({ guildId: g, userId: u, target: frierenTarget })).toBe(0);
    expect((await rollEngine.loadDisabledSets(kv, g, u)).series).toEqual([]);
  });

  it("$disable / $antidisable / $disablelist pelo comando", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);

    const add = fakeCtx({ guildId: g, userId: u, args: { action: "add", query: "frieren", server: false } });
    await cmds.disableCommand.execute(add.ctx);
    expect(embedText(add.replies[0])).toContain("Sousou no Frieren");

    const again = fakeCtx({ guildId: g, userId: u, args: { action: "add", query: `s:${frieren}`, server: false } });
    await cmds.disableCommand.execute(again.ctx);
    expect(embedText(again.replies[0])).toContain("Sousou no Frieren");
    expect(await svc.listDisabled(g, u)).toHaveLength(1);

    const list = fakeCtx({ guildId: g, userId: u, args: { action: "list", server: false } });
    await cmds.disableListCommand.execute(list.ctx);
    expect(embedText(list.replies[0])).toContain("Sousou no Frieren");

    const remove = fakeCtx({ guildId: g, userId: u, args: { action: "remove", query: "frieren", server: false } });
    await cmds.antiDisableCommand.execute(remove.ctx);
    expect(await svc.listDisabled(g, u)).toHaveLength(0);

    const missing = fakeCtx({ guildId: g, userId: u, args: { action: "remove", query: "frieren", server: false } });
    expect((await errOf(cmds.antiDisableCommand.execute(missing.ctx)))?.key).toBe("config.disable_not_found");

    const nothing = fakeCtx({ guildId: g, userId: u, args: { action: "add", query: "zzzqqq", server: false } });
    expect((await errOf(cmds.runDisable(nothing.ctx)))?.key).toBe("config.disable_series_not_found");

    const empty = fakeCtx({ guildId: g, userId: u, args: { action: "list", server: false } });
    await cmds.disableListCommand.execute(empty.ctx);
    expect(embedText(empty.replies[0])).toContain("$disable");
  });

  it("server-wide exige Administrador, invalida o cache do servidor e vale para todos os usuarios", async () => {
    const g = uid("g");
    const admin = uid("admin");
    const member = uid("u");
    const kv = await kvClient.getKV();
    await seedGuild(t.sql, g);
    await kv.set(rollEngine.disabledServerKey(g), JSON.stringify({ series: [], franchises: [] }), {
      px: 60_000,
    });

    const denied = fakeCtx({
      guildId: g,
      userId: member,
      isAdmin: false,
      args: { action: "add", query: "frieren", server: true },
    });
    expect((await errOf(cmds.disableCommand.execute(denied.ctx)))?.key).toBe("errors.missing_administrator");
    expect(await t.sql`SELECT 1 FROM disabled_series WHERE guild_id = ${g}`).toHaveLength(0);
    expect(await kv.get(rollEngine.disabledServerKey(g))).not.toBeNull();

    const allowed = fakeCtx({
      guildId: g,
      userId: admin,
      isAdmin: true,
      args: { action: "add", query: "frieren", server: true },
    });
    await cmds.disableCommand.execute(allowed.ctx);
    expect(embedText(allowed.replies[0])).toContain("Sousou no Frieren");
    expect(await kv.get(rollEngine.disabledServerKey(g))).toBeNull();
    const rows = await t.sql`SELECT user_id, is_server_wide FROM disabled_series WHERE guild_id = ${g}`;
    expect(rows).toEqual([{ user_id: admin, is_server_wide: true }]);

    const seenByOthers = await rollEngine.loadDisabledSets(kv, g, member);
    expect(seenByOthers.series).toEqual([frieren]);

    // outro admin repete: continua uma entrada so na lista do servidor
    await svc.disableTarget({
      guildId: g,
      userId: uid("admin"),
      target: target("series", frieren, "Sousou no Frieren"),
      serverWide: true,
    });
    expect(await svc.listDisabled(g, member, true)).toHaveLength(1);
    // a lista pessoal do membro continua vazia
    expect(await svc.listDisabled(g, member, false)).toHaveLength(0);

    const undenied = fakeCtx({
      guildId: g,
      userId: member,
      isAdmin: false,
      args: { action: "remove", query: "frieren", server: true },
    });
    expect((await errOf(cmds.antiDisableCommand.execute(undenied.ctx)))?.key).toBe(
      "errors.missing_administrator"
    );

    const lift = fakeCtx({
      guildId: g,
      userId: admin,
      isAdmin: true,
      args: { action: "remove", query: "frieren", server: true },
    });
    await cmds.antiDisableCommand.execute(lift.ctx);
    expect(await svc.listDisabled(g, member, true)).toHaveLength(0);
    expect((await rollEngine.loadDisabledSets(kv, g, member)).series).toEqual([]);
  });

  it("autocompleteDisabled lista so o que o usuario desativou", async () => {
    const g = uid("g");
    const u = uid("u");
    await seedGuild(t.sql, g);
    await svc.disableTarget({ guildId: g, userId: u, target: target("series", fateZero, "Fate/Zero") });
    await svc.disableTarget({ guildId: g, userId: u, target: target("series", pokemon, "Pokémon") });
    expect((await svc.autocompleteDisabled(g, u, false, "")).map((e) => e.name)).toEqual([
      "Fate/Zero",
      "Pokémon",
    ]);
    expect((await svc.autocompleteDisabled(g, u, false, "fate")).map((e) => e.id)).toEqual([fateZero]);
    expect(await svc.autocompleteDisabled(g, u, true, "")).toEqual([]);
  });
});
