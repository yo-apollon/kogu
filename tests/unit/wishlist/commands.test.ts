import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCommandArgs } from "../../../src/core/context.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { hasKey } from "../../../src/i18n/index.js";
import { UserError } from "../../../src/lib/errors.js";
import type { EntityHit, WishEntry } from "../../../src/modules/wishlist/service.js";
import { embedText, fakeAutocomplete, fakeCtx, fakeSlashOptions } from "./helpers.js";

vi.mock("../../../src/infra/redis/client.js", async () => {
  const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
  const kv = new MemoryStore();
  return { getKV: vi.fn(async () => kv) };
});

vi.mock("../../../src/modules/wishlist/service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/wishlist/service.js")>();
  return {
    ...actual,
    resolveEntity: vi.fn(),
    addWish: vi.fn(),
    toggleWish: vi.fn(),
    removeWish: vi.fn(),
    listWishes: vi.fn(),
    autocompleteEntities: vi.fn(),
    autocompleteWishes: vi.fn(),
    guildAllowsAdult: vi.fn(),
  };
});

import * as service from "../../../src/modules/wishlist/service.js";
import * as commands from "../../../src/modules/wishlist/commands.js";
import { commands as moduleCommands, components } from "../../../src/modules/wishlist/index.js";

const mocked = vi.mocked(service);

const entity: EntityHit = { id: 7, name: "Zero Two", seriesTitle: "Darling in the FranXX", baseAether: 900 };

function wishEntry(over: Partial<WishEntry> = {}): WishEntry {
  return {
    entityId: 7,
    name: "Zero Two",
    seriesTitle: "Darling in the FranXX",
    franchiseName: null,
    baseAether: 900,
    isStarwish: false,
    createdAt: new Date(0),
    ...over,
  };
}

beforeEach(() => {
  // mockReset so nos mocks do servico: o mock de getKV precisa manter a implementacao.
  for (const fn of [
    mocked.resolveEntity,
    mocked.addWish,
    mocked.toggleWish,
    mocked.removeWish,
    mocked.listWishes,
    mocked.autocompleteEntities,
    mocked.autocompleteWishes,
    mocked.guildAllowsAdult,
  ]) {
    fn.mockReset();
  }
  mocked.guildAllowsAdult.mockResolvedValue(false);
});

describe("registro", () => {
  it("todos os aliases do bot antigo resolvem no registry", () => {
    const registry = new CommandRegistry();
    for (const cmd of moduleCommands) registry.register(cmd);

    const table: Array<[string, string]> = [
      ["wish", "wish"],
      ["wl", "wishlist"],
      ["wishlist", "wishlist"],
      ["sw", "starwish"],
      ["starwish", "starwish"],
      ["WL", "wishlist"],
    ];
    for (const [token, name] of table) {
      expect(registry.resolve(token)?.cmd.name, token).toBe(name);
    }
    expect(registry.resolve("wishh")).toBeUndefined();
  });

  it("o modulo exporta comandos e nenhum componente proprio", () => {
    expect(moduleCommands.map((c) => c.name)).toEqual(["wish", "wishlist", "starwish"]);
    expect(components).toEqual([]);
    for (const cmd of moduleCommands) {
      expect(cmd.category).toBe("wishlist");
      expect(hasKey(cmd.descriptionKey, "pt-BR"), cmd.descriptionKey).toBe(true);
      expect(hasKey(cmd.descriptionKey, "en-US")).toBe(true);
    }
  });

  it("gera os slash /wish add|remove|list e /starwish com autocomplete em `entity`", () => {
    const registry = new CommandRegistry();
    for (const cmd of moduleCommands) registry.register(cmd);
    const payload = registry.buildSlashPayload() as any[];
    expect(payload.map((p) => p.name).sort()).toEqual(["starwish", "wish"]);

    const wish = payload.find((p) => p.name === "wish");
    expect(wish.description).toBeTruthy();
    expect(wish.options.map((o: any) => o.name)).toEqual(["add", "remove", "list"]);
    const [add, remove, list] = wish.options;
    for (const sub of [add, remove]) {
      expect(sub.type).toBe(1);
      expect(sub.options).toHaveLength(1);
      expect(sub.options[0]).toMatchObject({
        name: "entity",
        required: true,
        autocomplete: true,
        max_length: 100,
      });
      expect(sub.description_localizations["en-US"]).toBeTruthy();
    }
    expect(list.options ?? []).toEqual([]);

    const star = payload.find((p) => p.name === "starwish");
    expect(star.options[0]).toMatchObject({ name: "entity", autocomplete: true, required: true });
  });
});

describe("parseWishTokens", () => {
  const plain = { star: false };
  it.each([
    [[], plain, { action: "list", star: false }],
    [["Zero", "Two"], plain, { action: "toggle", query: "Zero Two", star: false }],
    [["Zero", "Two"], { star: true }, { action: "toggle", query: "Zero Two", star: true }],
    [["add", "Zero", "Two"], plain, { action: "add", query: "Zero Two", star: false }],
    [["ADD", "Rem"], { star: true }, { action: "add", query: "Rem", star: true }],
    [["remove", "Rem"], plain, { action: "remove", query: "Rem", star: false }],
    [["rm", "Rem"], plain, { action: "remove", query: "Rem", star: false }],
    [["list"], plain, { action: "list", star: false }],
    [["list", "ignorado"], { star: true }, { action: "list", star: false }],
    [["add"], plain, { action: "add", query: undefined, star: false }],
  ] as const)("%j (%j)", (tokens, opts, expected) => {
    expect(commands.parseWishTokens([...tokens], opts)).toEqual(expected);
  });
});

describe("argumentos (zod)", () => {
  const parse = (raw: unknown) => parseCommandArgs(commands.wishCommand, raw, "$wish");

  it("add/remove/toggle exigem query: erro de argumento ausente", () => {
    for (const action of ["add", "remove", "toggle"]) {
      const err = (() => {
        try {
          parse({ action });
        } catch (e) {
          return e as UserError;
        }
      })();
      expect(err?.key, action).toBe("errors.missing_argument");
      expect(err?.params).toMatchObject({ arg: "query" });
    }
  });

  it("list nao exige query e star assume false", () => {
    expect(parse({ action: "list" })).toEqual({ action: "list", star: false });
  });

  it("query e aparada e limitada a 100 caracteres", () => {
    expect(parse({ action: "add", query: "  Rem  " })).toMatchObject({ query: "Rem" });
    expect(() => parse({ action: "add", query: "x".repeat(101) })).toThrow(UserError);
  });
});

describe("slashArgs", () => {
  it("/wish mapeia subcomando e entidade", () => {
    expect(
      commands.wishCommand.slashArgs!(fakeSlashOptions({ subcommand: "add", strings: { entity: "id:7" } }))
    ).toEqual({ action: "add", query: "id:7", star: false });
    expect(commands.wishCommand.slashArgs!(fakeSlashOptions({ subcommand: "list" }))).toEqual({
      action: "list",
      query: undefined,
      star: false,
    });
  });

  it("/starwish adiciona como estelar", () => {
    expect(commands.starwishCommand.slashArgs!(fakeSlashOptions({ strings: { entity: "Rem" } }))).toEqual({
      action: "add",
      query: "Rem",
      star: true,
    });
  });
});

describe("execute", () => {
  it("add: resolve (respeitando allowAdult), grava e responde com o nome e a obra", async () => {
    mocked.resolveEntity.mockResolvedValue(entity);
    mocked.addWish.mockResolvedValue({ status: "added", isStarwish: false, total: 1 });
    const { ctx, replies } = fakeCtx({ args: { action: "add", query: "zero two", star: false }, allowAdult: true });

    await commands.wishCommand.execute(ctx);

    expect(mocked.resolveEntity).toHaveBeenCalledWith("zero two", { allowAdult: true });
    expect(mocked.addWish).toHaveBeenCalledWith(
      { guildId: "g1", userId: "u1", username: "alice" },
      7,
      { starwish: false }
    );
    expect(mocked.toggleWish).not.toHaveBeenCalled();
    expect(embedText(replies[0])).toContain("Zero Two");
    expect(embedText(replies[0])).toContain("Darling in the FranXX");
  });

  it("toggle ($wish nome): usa toggleWish e responde removido quando ja existia", async () => {
    mocked.resolveEntity.mockResolvedValue(entity);
    mocked.toggleWish.mockResolvedValue({ status: "removed", isStarwish: false, total: 0 });
    const { ctx, replies } = fakeCtx({ args: { action: "toggle", query: "zero", star: false } });

    await commands.wishCommand.execute(ctx);

    expect(mocked.toggleWish).toHaveBeenCalledWith(expect.anything(), 7, { starwish: false });
    expect(embedText(replies[0])).toContain("removido");
  });

  it("$sw: toggle com starwish e mensagem de Desejo Estelar", async () => {
    mocked.resolveEntity.mockResolvedValue(entity);
    mocked.toggleWish.mockResolvedValue({ status: "added", isStarwish: true, total: 1 });
    const { ctx, replies } = fakeCtx({ args: { action: "toggle", query: "zero", star: true } });

    await commands.starwishCommand.execute(ctx);

    expect(mocked.toggleWish).toHaveBeenCalledWith(expect.anything(), 7, { starwish: true });
    expect(embedText(replies[0])).toContain("Desejo Estelar Definido");
  });

  it("entidade nao encontrada: UserError wishlist.not_found com consulta escapada e prefixo", async () => {
    mocked.resolveEntity.mockResolvedValue(null);
    const { ctx, replies } = fakeCtx({
      args: { action: "add", query: "x*y", star: false },
      prefix: "!",
    });
    const err = await commands.wishCommand.execute(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.key).toBe("wishlist.not_found");
    expect(err.params).toEqual({ query: "x\\*y", prefix: "!" });
    expect(replies).toHaveLength(0);
    expect(mocked.addWish).not.toHaveBeenCalled();
  });

  it("limite da lista: o UserError do servico chega ao errorBoundary", async () => {
    mocked.resolveEntity.mockResolvedValue(entity);
    mocked.addWish.mockRejectedValue(new UserError("wishlist.limit_reached", { max: 10 }));
    const { ctx, replies } = fakeCtx({ args: { action: "add", query: "zero", star: false } });
    const err = await commands.wishCommand.execute(ctx).catch((e) => e);
    expect(err.key).toBe("wishlist.limit_reached");
    expect(err.params).toEqual({ max: 10 });
    expect(replies).toHaveLength(0);
  });

  it("limite de estelares: chave ainda sem locale vira resposta com o texto local", async () => {
    mocked.resolveEntity.mockResolvedValue(entity);
    mocked.toggleWish.mockRejectedValue(new UserError("wishlist.starwish_limit_reached", { max: 3 }));
    const { ctx, replies } = fakeCtx({ args: { action: "toggle", query: "zero", star: true } });

    const result = await commands.starwishCommand.execute(ctx).catch((e) => e);

    if (hasKey("wishlist.starwish_limit_reached", "pt-BR")) {
      expect(result).toBeInstanceOf(UserError);
    } else {
      expect(result).toBeUndefined();
      expect(embedText(replies[0])).toContain("3/3");
      expect(replies[0].ephemeral).toBe(true);
    }
  });

  it("remove: acha na propria lista, remove e responde; nao achando, wishlist.not_in_list", async () => {
    mocked.listWishes.mockResolvedValue([wishEntry(), wishEntry({ entityId: 8, name: "Rem" })]);
    mocked.removeWish.mockResolvedValue(true);
    const ok = fakeCtx({ args: { action: "remove", query: "rem", star: false } });
    await commands.wishCommand.execute(ok.ctx);
    expect(mocked.removeWish).toHaveBeenCalledWith("g1", "u1", 8);
    expect(embedText(ok.replies[0])).toContain("Rem");

    const byId = fakeCtx({ args: { action: "remove", query: "id:7", star: false } });
    await commands.wishCommand.execute(byId.ctx);
    expect(mocked.removeWish).toHaveBeenLastCalledWith("g1", "u1", 7);

    mocked.removeWish.mockClear();
    const none = fakeCtx({ args: { action: "remove", query: "emilia", star: false } });
    const result = await commands.wishCommand.execute(none.ctx).catch((e) => e);
    expect(mocked.removeWish).not.toHaveBeenCalled();
    if (hasKey("wishlist.not_in_list", "pt-BR")) {
      expect(result.key).toBe("wishlist.not_in_list");
    } else {
      // chave ainda fora de locales/*.json: o modulo responde com o texto local
      expect(result).toBeUndefined();
      expect(embedText(none.replies[0])).toContain("emilia");
    }
  });

  it("list vazia: mensagem com o prefixo do servidor", async () => {
    mocked.listWishes.mockResolvedValue([]);
    const { ctx, replies } = fakeCtx({ args: { action: "list", star: false }, prefix: "%" });
    await commands.wishlistCommand.execute(ctx);
    expect(embedText(replies[0])).toContain("%wish");
  });

  it("list: usa o paginator (uma pagina sem botoes; muitas paginas com navegacao)", async () => {
    mocked.listWishes.mockResolvedValue([wishEntry(), wishEntry({ entityId: 8, name: "Rem", isStarwish: true })]);
    const single = fakeCtx({ args: { action: "list", star: false } });
    await commands.wishlistCommand.execute(single.ctx);
    expect(embedText(single.replies[0])).toContain("(2/10)");
    expect(single.replies[0].components).toEqual([]);

    const many = Array.from({ length: service.WISHLIST_PAGE_SIZE + 3 }, (_, i) =>
      wishEntry({ entityId: 100 + i, name: `Char ${i}` })
    );
    mocked.listWishes.mockResolvedValue(many);
    const paged = fakeCtx({ args: { action: "list", star: false } });
    await commands.wishlistCommand.execute(paged.ctx);
    const row = paged.replies[0].components[0].toJSON();
    expect(row.components.some((c: any) => String(c.custom_id).startsWith("pg:"))).toBe(true);
    expect(embedText(paged.replies[0])).toContain("Página 1/2");
    // a mensagem enviada e registrada no paginator para desabilitar os botoes ao expirar
    expect(paged.reply).toHaveBeenCalledTimes(1);
  });
});

describe("autocomplete", () => {
  it("add/starwish: busca no catalogo respeitando allow_adult e devolve id:N", async () => {
    mocked.guildAllowsAdult.mockResolvedValue(true);
    mocked.autocompleteEntities.mockResolvedValue([entity, { ...entity, id: 8, name: "Rem", seriesTitle: null }]);
    const { interaction, respond } = fakeAutocomplete({
      focused: { name: "entity", value: "ze" },
      subcommand: "add",
    });

    await commands.wishCommand.autocomplete!(interaction);

    expect(mocked.guildAllowsAdult).toHaveBeenCalledWith(expect.anything(), "g1");
    expect(mocked.autocompleteEntities).toHaveBeenCalledWith(expect.anything(), "ze", true);
    expect(respond).toHaveBeenCalledWith([
      { name: "Zero Two · Darling in the FranXX", value: "id:7" },
      { name: "Rem", value: "id:8" },
    ]);
  });

  it("/starwish (sem subcomando) tambem busca no catalogo", async () => {
    mocked.autocompleteEntities.mockResolvedValue([entity]);
    const { interaction, respond } = fakeAutocomplete({ focused: { name: "entity", value: "zero" } });
    await commands.starwishCommand.autocomplete!(interaction);
    expect(respond).toHaveBeenCalledWith([expect.objectContaining({ value: "id:7" })]);
  });

  it("remove: sugere so a propria lista", async () => {
    mocked.autocompleteWishes.mockResolvedValue([entity]);
    const { interaction, respond } = fakeAutocomplete({
      focused: { name: "entity", value: "zero" },
      subcommand: "remove",
    });
    await commands.wishCommand.autocomplete!(interaction);
    expect(mocked.autocompleteWishes).toHaveBeenCalledWith("g1", "u1", "zero");
    expect(mocked.autocompleteEntities).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith([{ name: "Zero Two · Darling in the FranXX", value: "id:7" }]);
  });

  it("opcao desconhecida ou fora de servidor responde lista vazia", async () => {
    const other = fakeAutocomplete({ focused: { name: "outra", value: "x" }, subcommand: "add" });
    await commands.wishCommand.autocomplete!(other.interaction);
    expect(other.respond).toHaveBeenCalledWith([]);

    const dm = fakeAutocomplete({ focused: { name: "entity", value: "x" }, guildId: null });
    await commands.wishCommand.autocomplete!(dm.interaction);
    expect(dm.respond).toHaveBeenCalledWith([]);
    expect(mocked.autocompleteEntities).not.toHaveBeenCalled();
  });

  it("nunca passa de 25 opcoes", async () => {
    mocked.autocompleteEntities.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ ...entity, id: i + 1, name: `N${i}` }))
    );
    const { interaction, respond } = fakeAutocomplete({ focused: { name: "entity", value: "n" } });
    await commands.wishCommand.autocomplete!(interaction);
    expect((respond.mock.calls[0]![0] as unknown[]).length).toBe(25);
  });
});
