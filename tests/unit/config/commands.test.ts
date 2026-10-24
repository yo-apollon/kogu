import { PermissionFlagsBits } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkCommandPermissions } from "../../../src/core/middleware/permissions.js";
import { parseCommandArgs } from "../../../src/core/context.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { hasKey } from "../../../src/i18n/index.js";
import { UserError } from "../../../src/lib/errors.js";
import type { DisabledEntry, GuildSettings } from "../../../src/modules/config/service.js";
import { embedText, fakeAutocomplete, fakeCtx, fakeSlashOptions } from "./helpers.js";

vi.mock("../../../src/infra/redis/client.js", async () => {
  const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
  const kv = new MemoryStore();
  return { getKV: vi.fn(async () => kv) };
});

vi.mock("../../../src/modules/config/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/config/service.js")>();
  return {
    ...actual,
    applyGuildSetting: vi.fn(),
    disableTarget: vi.fn(),
    enableTarget: vi.fn(),
    listDisabled: vi.fn(),
    resolveTarget: vi.fn(),
    getGuildSettings: vi.fn(),
    autocompleteDisabled: vi.fn(),
    autocompleteTargets: vi.fn(),
  };
});

import * as service from "../../../src/modules/config/service.js";
import * as commands from "../../../src/modules/config/commands.js";
import { commands as moduleCommands, components } from "../../../src/modules/config/index.js";

const mocked = vi.mocked(service);

const MANAGE_GUILD_ONLY = { permissions: { has: (p: bigint) => (p & PermissionFlagsBits.ManageGuild) !== 0n } };
const NO_PERMS = { permissions: { has: () => false } };

function settings(over: Partial<GuildSettings> = {}): GuildSettings {
  return {
    id: "g1",
    prefix: "$",
    locale: "pt-BR",
    gamemode: 1,
    baseRolls: 10,
    rollIntervalMin: 60,
    resetOffsetMin: 0,
    claimCooldownMinutes: 180,
    pactsPerWindow: 1,
    claimWindowSeconds: 45,
    snipeProtectionLevel: 0,
    snipeProtectionSeconds: 8,
    aetherSnipeProtectionLevel: 0,
    aetherSnipeProtectionSeconds: 8,
    pactLimit: 8100,
    releaseBoostEnabled: true,
    allowAdult: false,
    ...over,
  };
}

function entry(over: Partial<DisabledEntry> = {}): DisabledEntry {
  return { kind: "series", id: 1, name: "Sousou no Frieren", serverWide: false, createdAt: new Date(0), ...over };
}

beforeEach(() => {
  for (const fn of [
    mocked.applyGuildSetting,
    mocked.disableTarget,
    mocked.enableTarget,
    mocked.listDisabled,
    mocked.resolveTarget,
    mocked.getGuildSettings,
    mocked.autocompleteDisabled,
    mocked.autocompleteTargets,
  ]) {
    fn.mockReset();
  }
});

describe("registro", () => {
  it("todos os aliases do bot antigo resolvem no registry", () => {
    const registry = new CommandRegistry();
    for (const cmd of moduleCommands) registry.register(cmd);

    const table: Array<[string, string]> = [
      ["settings", "settings"],
      ["serversettings", "settings"],
      ["config", "settings"],
      ["setrolls", "setrolls"],
      ["settimer", "settimer"],
      ["setclaim", "setclaim"],
      ["gamemode", "gamemode"],
      ["prefix", "prefix"],
      ["prefixo", "prefix"],
      ["lang", "lang"],
      ["idioma", "lang"],
      ["set", "set"],
      ["disable", "disable"],
      ["antidisable", "antidisable"],
      ["ad", "antidisable"],
      ["disablelist", "disablelist"],
      ["dl", "disablelist"],
      ["DL", "disablelist"],
    ];
    for (const [token, name] of table) {
      expect(registry.resolve(token)?.cmd.name, token).toBe(name);
    }
  });

  it("o modulo exporta comandos e nenhum componente proprio; categoria e descricao validas", () => {
    expect(components).toEqual([]);
    expect(moduleCommands).toHaveLength(11);
    for (const cmd of moduleCommands) {
      expect(cmd.category).toBe("config");
      // `help.commands.set` ainda nao existe em locales/*.json (ver relatorio): so confere o resto
      if (cmd.name !== "set") expect(hasKey(cmd.descriptionKey, "pt-BR"), cmd.descriptionKey).toBe(true);
    }
  });

  it("nao colide com os comandos de wishlist ao registrar tudo junto", async () => {
    const { commands: wishlist } = await import("../../../src/modules/wishlist/index.js");
    const registry = new CommandRegistry();
    for (const cmd of [...moduleCommands, ...wishlist]) registry.register(cmd);
    expect(registry.size).toBe(moduleCommands.length + wishlist.length);
  });
});

describe("permissoes", () => {
  const needManage = ["setrolls", "settimer", "setclaim", "gamemode", "prefix", "lang", "set"];

  it.each(needManage)("%s exige Gerenciar Servidor", (name) => {
    const cmd = moduleCommands.find((c) => c.name === name)!;
    expect(cmd.permissions).toBe(PermissionFlagsBits.ManageGuild);
    expect(() => checkCommandPermissions(cmd, "u1", NO_PERMS)).toThrowError(
      expect.objectContaining({ key: "errors.missing_manage_guild" })
    );
    expect(() => checkCommandPermissions(cmd, "u1", null)).toThrowError(UserError);
    expect(() => checkCommandPermissions(cmd, "u1", MANAGE_GUILD_ONLY)).not.toThrow();
  });

  it.each(["settings", "disable", "antidisable", "disablelist"])(
    "%s e livre (o servidor inteiro e protegido dentro do comando)",
    (name) => {
      const cmd = moduleCommands.find((c) => c.name === name)!;
      expect(cmd.permissions).toBeUndefined();
      expect(() => checkCommandPermissions(cmd, "u1", NO_PERMS)).not.toThrow();
    }
  );
});

describe("slash", () => {
  const registry = new CommandRegistry();
  for (const cmd of moduleCommands) registry.register(cmd);
  const payload = registry.buildSlashPayload() as any[];
  const byName = (name: string) => payload.find((p) => p.name === name);

  it("registra /settings, /set e /disable", () => {
    expect(payload.map((p) => p.name).sort()).toEqual(["disable", "set", "settings"]);
    expect(byName("settings").description).toBeTruthy();
  });

  it("/set tem uma subcomando por configuracao, com faixas validas e permissao padrao", () => {
    const set = byName("set");
    expect(set.options.map((o: any) => o.name)).toEqual([
      "rolls",
      "timer",
      "claim",
      "gamemode",
      "prefix",
      "lang",
    ]);
    expect(set.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
    const range = (name: string) => {
      const opt = set.options.find((o: any) => o.name === name).options[0];
      return [opt.min_value, opt.max_value];
    };
    expect(range("rolls")).toEqual([1, 50]);
    expect(range("timer")).toEqual([30, 360]);
    expect(range("claim")).toEqual([10, 120]);
    expect(range("gamemode")).toEqual([1, 2]);
    const prefix = set.options.find((o: any) => o.name === "prefix").options[0];
    expect([prefix.min_length, prefix.max_length]).toEqual([1, 5]);
    const lang = set.options.find((o: any) => o.name === "lang").options[0];
    expect(lang.choices.map((c: any) => c.value)).toEqual(["pt-br", "en"]);
    for (const sub of set.options) {
      expect(sub.options[0]).toMatchObject({ name: "value", required: true });
      expect(sub.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("/disable add|remove|list com autocomplete em `series` e opcao `server` opcional", () => {
    const disable = byName("disable");
    expect(disable.options.map((o: any) => o.name)).toEqual(["add", "remove", "list"]);
    for (const sub of disable.options.slice(0, 2)) {
      expect(sub.options[0]).toMatchObject({ name: "series", required: true, autocomplete: true });
      expect(sub.options[1]).toMatchObject({ name: "server" });
      expect(sub.options[1].required).toBeFalsy();
    }
    expect(disable.options[2].options.map((o: any) => o.name)).toEqual(["server"]);
  });
});

describe("tokens de prefixo", () => {
  it.each([
    [[], { setting: undefined, value: undefined }],
    [["rolls", "15"], { setting: "rolls", value: "15" }],
    [["SETROLLS", "15"], { setting: "rolls", value: "15" }],
    [["prefixo", "!"], { setting: "prefix", value: "!" }],
    [["idioma", "en"], { setting: "lang", value: "en" }],
    [["foo", "1"], { setting: "foo", value: "1" }],
  ] as const)("$set %j", (tokens, expected) => {
    expect(commands.parseSetTokens([...tokens])).toEqual(expected);
  });

  it.each([
    [[], "add", { action: "list", server: false }],
    [["Frieren"], "add", { action: "add", query: "Frieren", server: false }],
    [["Sousou", "no", "Frieren"], "add", { action: "add", query: "Sousou no Frieren", server: false }],
    [["--server", "Frieren"], "add", { action: "add", query: "Frieren", server: true }],
    [["Frieren", "--SERVIDOR"], "add", { action: "add", query: "Frieren", server: true }],
    [["--server"], "add", { action: "list", server: true }],
    [["Frieren"], "remove", { action: "remove", query: "Frieren", server: false }],
    [[], "remove", { action: "remove", query: undefined, server: false }],
    [["ignorado"], "list", { action: "list", server: false }],
    [["--server"], "list", { action: "list", server: true }],
  ] as const)("%j (%s)", (tokens, action, expected) => {
    expect(commands.parseDisableTokens([...tokens], action)).toEqual(expected);
  });
});

describe("argumentos (zod)", () => {
  it("$set exige a configuracao e rejeita nomes desconhecidos", () => {
    const parse = (raw: unknown) => parseCommandArgs(commands.setCommand, raw, "$set");
    expect(() => parse({ value: "1" })).toThrowError(expect.objectContaining({ key: "errors.missing_argument" }));
    expect(() => parse({ setting: "foo", value: "1" })).toThrowError(
      expect.objectContaining({ key: "errors.invalid_argument" })
    );
    expect(parse({ setting: "rolls" })).toEqual({ setting: "rolls" });
    expect(parse({ setting: "rolls", value: 20 })).toEqual({ setting: "rolls", value: 20 });
  });

  it("$disable add/remove exigem texto; list nao", () => {
    const parse = (raw: unknown) => parseCommandArgs(commands.disableCommand, raw, "$disable");
    for (const action of ["add", "remove"]) {
      expect(() => parse({ action })).toThrowError(
        expect.objectContaining({ key: "errors.missing_argument", params: expect.objectContaining({ arg: "query" }) })
      );
    }
    expect(parse({ action: "list" })).toEqual({ action: "list", server: false });
    expect(parse({ action: "add", query: " Frieren ", server: true })).toEqual({
      action: "add",
      query: "Frieren",
      server: true,
    });
  });
});

describe("slashArgs", () => {
  it("/set mapeia subcomando e valor (numero ou texto)", () => {
    expect(
      commands.setCommand.slashArgs!(fakeSlashOptions({ subcommand: "rolls", values: { value: 15 } }))
    ).toEqual({ setting: "rolls", value: 15 });
    expect(
      commands.setCommand.slashArgs!(fakeSlashOptions({ subcommand: "prefix", values: { value: "!" } }))
    ).toEqual({ setting: "prefix", value: "!" });
  });

  it("/disable mapeia acao, serie e server", () => {
    expect(
      commands.disableCommand.slashArgs!(
        fakeSlashOptions({ subcommand: "add", strings: { series: "s:4" }, booleans: { server: true } })
      )
    ).toEqual({ action: "add", query: "s:4", server: true });
    expect(commands.disableCommand.slashArgs!(fakeSlashOptions({ subcommand: "list" }))).toEqual({
      action: "list",
      query: undefined,
      server: false,
    });
  });
});

describe("configuracoes (execute)", () => {
  it("$setrolls chama o servico com o texto bruto e o prefixo atual e confirma", async () => {
    mocked.applyGuildSetting.mockResolvedValue({ key: "rolls", value: 15, windowsReset: false });
    const { ctx, replies } = fakeCtx({ args: { value: "15" }, prefix: "!" });

    await commands.setRollsCommand.execute(ctx);

    expect(mocked.applyGuildSetting).toHaveBeenCalledWith("g1", "rolls", "15", { prefix: "!" });
    expect(embedText(replies[0])).toContain("15");
  });

  const confirmations = [
    { name: "settimer", command: commands.setTimerCommand, key: "timer", value: 120, snippet: "120 minutos" },
    { name: "setclaim", command: commands.setClaimCommand, key: "claim", value: 60, snippet: "60 segundos" },
    { name: "gamemode", command: commands.gamemodeCommand, key: "gamemode", value: 2, snippet: "Modo 2" },
    { name: "prefix", command: commands.prefixCommand, key: "prefix", value: "!!", snippet: "!!" },
  ] as const;

  it.each(confirmations)("$name confirma no idioma do servidor", async (c) => {
    mocked.applyGuildSetting.mockResolvedValue({
      key: c.key,
      value: c.value,
      windowsReset: c.key === "timer",
    } as any);
    const { ctx, replies } = fakeCtx({ args: { value: String(c.value) } });
    await c.command.execute(ctx);
    expect(mocked.applyGuildSetting).toHaveBeenCalledWith("g1", c.key, String(c.value), { prefix: "$" });
    expect(embedText(replies[0])).toContain(c.snippet);
  });

  it("$lang confirma ja no idioma NOVO", async () => {
    mocked.applyGuildSetting.mockResolvedValue({ key: "lang", value: "en-US", windowsReset: false });
    const { ctx, replies } = fakeCtx({ args: { value: "en" }, locale: "pt-BR" });
    await commands.langCommand.execute(ctx);
    expect(embedText(replies[0])).toContain("Server language updated to **en-US**");
  });

  it("valor invalido propaga o UserError de uso e nao responde", async () => {
    mocked.applyGuildSetting.mockRejectedValue(
      new UserError("config.setrolls_invalid", { min: 1, max: 50, prefix: "$" })
    );
    const { ctx, replies } = fakeCtx({ args: { value: "999" } });
    const err = await commands.setRollsCommand.execute(ctx).catch((e) => e);
    expect(err.key).toBe("config.setrolls_invalid");
    expect(replies).toHaveLength(0);
  });

  it("$prefix sem argumento passa undefined (a mensagem de uso vem do servico)", async () => {
    mocked.applyGuildSetting.mockRejectedValue(new UserError("config.prefix_invalid", { max: 5, prefix: "$" }));
    const { ctx } = fakeCtx({ args: { value: undefined } });
    await expect(commands.prefixCommand.execute(ctx)).rejects.toMatchObject({ key: "config.prefix_invalid" });
    expect(mocked.applyGuildSetting).toHaveBeenCalledWith("g1", "prefix", undefined, { prefix: "$" });
  });

  it("$set <config> <valor> usa o mesmo servico", async () => {
    mocked.applyGuildSetting.mockResolvedValue({ key: "timer", value: 90, windowsReset: true });
    const { ctx, replies } = fakeCtx({ args: { setting: "timer", value: "90" } });
    await commands.setCommand.execute(ctx);
    expect(mocked.applyGuildSetting).toHaveBeenCalledWith("g1", "timer", "90", { prefix: "$" });
    expect(embedText(replies[0])).toContain("90");
  });
});

describe("$settings", () => {
  it("abre o painel com as secoes e a configuracao atual", async () => {
    mocked.getGuildSettings.mockResolvedValue(settings({ prefix: "!", baseRolls: 25, gamemode: 2 }));
    mocked.listDisabled.mockResolvedValue([]);
    const { ctx, replies } = fakeCtx();

    await commands.settingsCommand.execute(ctx);

    expect(mocked.getGuildSettings).toHaveBeenCalledWith("g1");
    const payload = replies[0];
    const text = embedText(payload);
    expect(text).toContain("Guilda \\*Teste\\*");
    expect(text).toContain("`!`");
    expect(text).toContain("`25`");
    expect(text).toContain("Modo `2`");
    expect(text).toContain("8100");
    const select = payload.components[0].toJSON().components[0];
    expect(select.custom_id).toMatch(/^pn:[0-9a-f]+:select$/);
    expect(select.options.map((o: any) => o.value)).toEqual([
      "overview",
      "rolls",
      "timers",
      "locale",
      "advanced",
      "disabled",
    ]);
    expect(select.options.find((o: any) => o.default).value).toBe("overview");
  });
});

describe("$disable / $antidisable / $disablelist", () => {
  const frieren = { kind: "series" as const, id: 1, name: "Sousou no Frieren" };

  it("add (usuario): resolve, grava e responde com o nome", async () => {
    mocked.resolveTarget.mockResolvedValue(frieren);
    mocked.disableTarget.mockResolvedValue({ created: true });
    const { ctx, replies } = fakeCtx({ args: { action: "add", query: "frieren", server: false } });

    await commands.disableCommand.execute(ctx);

    expect(mocked.resolveTarget).toHaveBeenCalledWith("frieren");
    expect(mocked.disableTarget).toHaveBeenCalledWith({
      guildId: "g1",
      userId: "u1",
      username: "alice",
      target: frieren,
      serverWide: false,
    });
    expect(embedText(replies[0])).toContain("Sousou no Frieren");
    expect(embedText(replies[0])).toContain("suas invocações");
  });

  it("add repetido responde que ja esta desativada", async () => {
    mocked.resolveTarget.mockResolvedValue(frieren);
    mocked.disableTarget.mockResolvedValue({ created: false });
    const { ctx, replies } = fakeCtx({ args: { action: "add", query: "frieren", server: false } });
    await commands.disableCommand.execute(ctx);
    expect(embedText(replies[0])).toContain("Sousou no Frieren");
    expect(embedText(replies[0])).not.toContain("suas invocações");
  });

  it("serie inexistente: erro (texto local enquanto a chave nao esta nos locales) e nada gravado", async () => {
    mocked.resolveTarget.mockResolvedValue(null);
    const { ctx, replies } = fakeCtx({ args: { action: "add", query: "zzz", server: false } });
    const result = await commands.disableCommand.execute(ctx).catch((e) => e);
    expect(mocked.disableTarget).not.toHaveBeenCalled();
    if (hasKey("config.disable_series_not_found", "pt-BR")) {
      expect(result.key).toBe("config.disable_series_not_found");
    } else {
      expect(result).toBeUndefined();
      expect(embedText(replies[0])).toContain("zzz");
    }
  });

  it("server-wide por nao-admin: errors.missing_administrator, sem escrever nem resolver", async () => {
    const { ctx, replies } = fakeCtx({
      args: { action: "add", query: "frieren", server: true },
      isAdmin: false,
    });
    const err = await commands.disableCommand.execute(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.key).toBe("errors.missing_administrator");
    expect(mocked.resolveTarget).not.toHaveBeenCalled();
    expect(mocked.disableTarget).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });

  it("server-wide por admin: grava com serverWide e usa a mensagem do servidor", async () => {
    mocked.resolveTarget.mockResolvedValue(frieren);
    mocked.disableTarget.mockResolvedValue({ created: true });
    const { ctx, replies } = fakeCtx({
      args: { action: "add", query: "frieren", server: true },
      isAdmin: true,
    });
    await commands.disableCommand.execute(ctx);
    expect(mocked.disableTarget).toHaveBeenCalledWith(expect.objectContaining({ serverWide: true }));
    expect(ctx.member.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
    expect(embedText(replies[0])).toContain("Sousou no Frieren");
    expect(embedText(replies[0])).toMatch(/servidor/);
  });

  it("remove (usuario): acha na lista, reativa e responde", async () => {
    mocked.listDisabled.mockResolvedValue([entry(), entry({ id: 2, name: "Fate/Zero" })]);
    mocked.enableTarget.mockResolvedValue(1);
    const { ctx, replies } = fakeCtx({ args: { action: "remove", query: "fate", server: false } });

    await commands.antiDisableCommand.execute(ctx);

    expect(mocked.listDisabled).toHaveBeenCalledWith("g1", "u1", false);
    expect(mocked.enableTarget).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: "g1", userId: "u1", serverWide: false, target: expect.objectContaining({ id: 2 }) })
    );
    expect(embedText(replies[0])).toContain("Fate/Zero");
  });

  it("remove fora da lista: UserError config.disable_not_found", async () => {
    mocked.listDisabled.mockResolvedValue([entry()]);
    const { ctx } = fakeCtx({ args: { action: "remove", query: "naruto", server: false } });
    const err = await commands.antiDisableCommand.execute(ctx).catch((e) => e);
    expect(err.key).toBe("config.disable_not_found");
    expect(mocked.enableTarget).not.toHaveBeenCalled();
  });

  it("remove server-wide por nao-admin e negado", async () => {
    const { ctx } = fakeCtx({ args: { action: "remove", query: "frieren", server: true }, isAdmin: false });
    const err = await commands.antiDisableCommand.execute(ctx).catch((e) => e);
    expect(err.key).toBe("errors.missing_administrator");
    expect(mocked.listDisabled).not.toHaveBeenCalled();
  });

  it("list vazia usa o prefixo; list com itens pagina", async () => {
    mocked.listDisabled.mockResolvedValue([]);
    const empty = fakeCtx({ args: { action: "list", server: false }, prefix: "%" });
    await commands.disableListCommand.execute(empty.ctx);
    expect(embedText(empty.replies[0])).toContain("%disable");

    mocked.listDisabled.mockResolvedValue([entry(), entry({ kind: "franchise", id: 2, name: "Fate" })]);
    const some = fakeCtx({ args: { action: "list", server: false } });
    await commands.disableListCommand.execute(some.ctx);
    const text = embedText(some.replies[0]);
    expect(text).toContain("(2)");
    expect(text).toContain("1. 📜 **Sousou no Frieren**");
    expect(text).toContain("2. 📋 **Fate**");
    expect(some.replies[0].components).toEqual([]);

    const many = Array.from({ length: service.DISABLE_PAGE_SIZE + 1 }, (_, i) =>
      entry({ id: 100 + i, name: `Serie ${i}` })
    );
    mocked.listDisabled.mockResolvedValue(many);
    const paged = fakeCtx({ args: { action: "list", server: false } });
    await commands.disableListCommand.execute(paged.ctx);
    expect(embedText(paged.replies[0])).toContain("Página 1/2");
    expect(paged.replies[0].components).toHaveLength(1);
  });

  it("list --server mostra o titulo do servidor e nao exige admin", async () => {
    mocked.listDisabled.mockResolvedValue([entry({ serverWide: true })]);
    const { ctx, replies } = fakeCtx({ args: { action: "list", server: true }, isAdmin: false });
    await commands.disableListCommand.execute(ctx);
    expect(mocked.listDisabled).toHaveBeenCalledWith("g1", "u1", true);
    expect(embedText(replies[0])).toContain("Sousou no Frieren");
  });
});

describe("autocomplete de /disable", () => {
  it("add: catalogo (series e franquias) com valor s:N / f:N", async () => {
    mocked.autocompleteTargets.mockResolvedValue([
      { kind: "series", id: 4, name: "Sousou no Frieren" },
      { kind: "franchise", id: 9, name: "Fate" },
    ]);
    const { interaction, respond } = fakeAutocomplete({
      focused: { name: "series", value: "fr" },
      subcommand: "add",
    });
    await commands.disableCommand.autocomplete!(interaction);
    expect(mocked.autocompleteTargets).toHaveBeenCalledWith(expect.anything(), "fr");
    expect(respond).toHaveBeenCalledWith([
      { name: "📜 Sousou no Frieren", value: "s:4" },
      { name: "📋 Fate", value: "f:9" },
    ]);
  });

  it("remove: so o que o usuario desativou (respeita a opcao server)", async () => {
    mocked.autocompleteDisabled.mockResolvedValue([entry({ kind: "franchise", id: 9, name: "Fate" })]);
    const { interaction, respond } = fakeAutocomplete({
      focused: { name: "series", value: "fa" },
      subcommand: "remove",
      booleans: { server: true },
    });
    await commands.disableCommand.autocomplete!(interaction);
    expect(mocked.autocompleteDisabled).toHaveBeenCalledWith("g1", "u1", true, "fa");
    expect(mocked.autocompleteTargets).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith([{ name: "📋 Fate", value: "f:9" }]);
  });

  it("opcao desconhecida ou DM: lista vazia", async () => {
    const a = fakeAutocomplete({ focused: { name: "server", value: "" }, subcommand: "add" });
    await commands.disableCommand.autocomplete!(a.interaction);
    expect(a.respond).toHaveBeenCalledWith([]);
    const b = fakeAutocomplete({ focused: { name: "series", value: "x" }, guildId: null });
    await commands.disableCommand.autocomplete!(b.interaction);
    expect(b.respond).toHaveBeenCalledWith([]);
  });

  it("trunca nomes longos em 100 caracteres e limita a 25 opcoes", async () => {
    mocked.autocompleteTargets.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ kind: "series" as const, id: i + 1, name: "N".repeat(150) }))
    );
    const { interaction, respond } = fakeAutocomplete({
      focused: { name: "series", value: "nn" },
      subcommand: "add",
    });
    await commands.disableCommand.autocomplete!(interaction);
    const choices = respond.mock.calls[0]![0] as Array<{ name: string }>;
    expect(choices).toHaveLength(25);
    expect(Array.from(choices[0]!.name)).toHaveLength(100);
  });
});
