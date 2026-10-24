import { beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: logMock,
  childLogger: () => logMock,
}));

import { CommandRegistry } from "../../../src/core/registry.js";
import { UserError } from "../../../src/lib/errors.js";
import {
  parseRollTokens,
  resolveRollFilter,
  rollArgsSchema,
  rollCommand,
  runSummon,
  summonCommands,
  SUMMON_SHORTCUTS,
} from "../../../src/modules/summon/commands.js";
import {
  describeUserError,
  parseHexColor,
  tr,
} from "../../../src/modules/summon/views.js";
import {
  fakeCtx,
  fakeOwnedResult,
  fakeResult,
  fakeSummonDeps,
  firstEmbedJson,
  rowIds,
} from "./commandsHelpers.js";

beforeEach(() => vi.clearAllMocks());

/** Lista de atalhos do bot antigo (src/handlers/messageHandler.ts) e o filtro esperado de cada um. */
const LEGACY: Record<string, Record<string, string>> = {
  w: { gender: "FEMALE" },
  wa: { gender: "FEMALE", universe: "ANIME" },
  wg: { gender: "FEMALE", universe: "GAME" },
  wc: { gender: "FEMALE", universe: "CINEMA" },
  wm: { gender: "FEMALE" },
  wx: { gender: "FEMALE" },
  h: { gender: "MALE" },
  ha: { gender: "MALE", universe: "ANIME" },
  hg: { gender: "MALE", universe: "GAME" },
  hc: { gender: "MALE", universe: "CINEMA" },
  hm: { gender: "MALE" },
  hx: { gender: "MALE" },
  m: {},
  mx: {},
  s: {},
  ma: { universe: "ANIME" },
  mg: { universe: "GAME" },
  mc: { universe: "CINEMA" },
  sa: { universe: "ANIME" },
  sg: { universe: "GAME" },
  sc: { universe: "CINEMA" },
  ar: { type: "WEAPON" },
};

describe("atalhos de invocacao", () => {
  const registry = new CommandRegistry();
  for (const cmd of summonCommands) registry.register(cmd);

  it.each(Object.entries(LEGACY))("alias %s resolve no registry com o filtro do bot antigo", (alias, expected) => {
    expect(registry.resolve(alias)?.cmd.category).toBe("summon");
    expect(resolveRollFilter(alias)).toEqual(expected);
  });

  it("a tabela cobre exatamente os atalhos antigos e todos estao registrados", () => {
    expect(Object.keys(SUMMON_SHORTCUTS).sort()).toEqual(Object.keys(LEGACY).sort());
    const registered = summonCommands.flatMap((c) => [c.name, ...(c.aliases ?? [])]).sort();
    expect(registered).toEqual([...Object.keys(LEGACY), "roll"].sort());
  });

  it("wm/hm (MYTHOLOGY) nao filtram universo", () => {
    expect(resolveRollFilter("wm")).not.toHaveProperty("universe");
    expect(resolveRollFilter("hm")).not.toHaveProperty("universe");
  });

  it("argumentos explicitos sobrescrevem o atalho; maiusculas e desconhecidos sao tolerados", () => {
    expect(resolveRollFilter("WA", { universe: "GAME" })).toEqual({ gender: "FEMALE", universe: "GAME" });
    expect(resolveRollFilter("roll", { type: "WEAPON", gender: "BOTH" })).toEqual({ type: "WEAPON", gender: "BOTH" });
    expect(resolveRollFilter("constructor")).toEqual({});
  });

  it("cada comando tem descricao i18n existente", () => {
    for (const cmd of summonCommands) expect(cmd.descriptionKey).toMatch(/^help\.commands\.summon/);
  });
});

describe("/roll e argumentos de prefixo", () => {
  it("monta o payload de slash com tipo/genero/universo localizados", () => {
    const registry = new CommandRegistry();
    for (const cmd of summonCommands) registry.register(cmd);
    const payload = registry.buildSlashPayload();
    expect(payload).toHaveLength(1);
    const roll = payload[0];
    expect(roll.name).toBe("roll");
    expect(roll.description_localizations?.["en-US"]).toBeTruthy();
    const options = roll.options as Array<{
      name: string;
      name_localizations?: Record<string, string>;
      choices: Array<{ value: string }>;
    }>;
    expect(options.map((o) => o.name)).toEqual(["type", "gender", "universe"]);
    expect(options.map((o) => o.name_localizations?.["pt-BR"])).toEqual(["tipo", "genero", "universo"]);
    expect(options[0].choices.map((c) => c.value)).toEqual(["CHARACTER", "WEAPON", "COMPANION", "DOMAIN"]);
    expect(options[1].choices.map((c) => c.value)).toEqual(["FEMALE", "MALE", "BOTH"]);
    expect(options[2].choices.map((c) => c.value)).toEqual(["ANIME", "GAME", "CINEMA"]);
  });

  it("so o /roll tem slash", () => {
    expect(summonCommands.filter((c) => c.slash).map((c) => c.name)).toEqual(["roll"]);
  });

  it("$roll interpreta palavras (com acento e maiusculas); atalhos ignoram tokens", () => {
    expect(parseRollTokens(["Anime", "FEMALE", "xyz"])).toEqual({ universe: "ANIME", gender: "FEMALE" });
    expect(parseRollTokens(["domínio"])).toEqual({ type: "DOMAIN" });
    expect(rollCommand.parseArgs?.(["anime"], { invokedAs: "roll" } as never)).toEqual({ universe: "ANIME" });
    expect(rollCommand.parseArgs?.(["anime"], { invokedAs: "w" } as never)).toEqual({});
  });

  it("o schema rejeita valores fora dos enums", () => {
    expect(rollArgsSchema.safeParse({ universe: "MYTHOLOGY" }).success).toBe(false);
    expect(rollArgsSchema.safeParse({}).success).toBe(true);
  });
});

describe("runSummon", () => {
  it("carta livre: passa o filtro, anexa card.webp, monta botoes e vincula a mensagem", async () => {
    const result = fakeResult();
    const deps = fakeSummonDeps(result);
    const { ctx, reply, defer } = fakeCtx({ invokedAs: "wa" });

    await runSummon(ctx, deps);

    expect(deps.performSummon).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        username: "alice",
        channelId: "chan-1",
        filter: { gender: "FEMALE", universe: "ANIME" },
      })
    );
    expect(defer).toHaveBeenCalledTimes(1);
    expect(deps.render).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "11",
        name: "Zero Two",
        franchise: "DARLING in the FRANXX",
        universe: "ANIME",
        tier: "EPIC",
        variant: "STANDARD",
        aetherValue: 380,
        imageUrl: "https://s4.anilist.co/zero.png",
        locale: "pt-BR",
      })
    );

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0] as any;
    const embed = firstEmbedJson(payload);
    expect(embed.author.name).toBe("Zero Two");
    expect(embed.image.url).toBe("attachment://card.webp");
    expect(embed.footer.text).toBe("Livre para Pacto");
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("card.webp");
    expect(rowIds(payload.components[0])).toEqual(["sm:pact:7", "sm:like:7"]);
    expect(payload.allowedMentions).toEqual({ parse: [], users: [] });
    expect(payload.content).toBeUndefined();
    expect(deps.setOfferMessage).toHaveBeenCalledWith(7, "msg-1");
    expect(deps.refundRoll).not.toHaveBeenCalled();
  });

  it("mapeia tipo/genero/universo do slash", async () => {
    const deps = fakeSummonDeps(fakeResult());
    const { ctx } = fakeCtx({
      source: "slash",
      invokedAs: "roll",
      args: { type: "WEAPON", gender: "MALE", universe: "GAME" },
    });
    await runSummon(ctx, deps);
    expect(deps.performSummon).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "chan-2",
        filter: { type: "WEAPON", gender: "MALE", universe: "GAME" },
      })
    );
  });

  it("menciona wishers com allowedMentions explicito (sem quem rolou)", async () => {
    const deps = fakeSummonDeps(fakeResult(), { findWishers: vi.fn(async () => ["w1", "w2"]) });
    const { ctx, reply } = fakeCtx();
    await runSummon(ctx, deps);

    expect(deps.findWishers).toHaveBeenCalledWith("g1", 11, "u1");
    const payload = reply.mock.calls[0][0] as any;
    expect(payload.content).toContain("<@w1> <@w2>");
    expect(payload.content).toContain("Zero Two");
    expect(payload.allowedMentions).toEqual({ parse: [], users: ["w1", "w2"] });
  });

  it("falha ao buscar wishers nao quebra o roll", async () => {
    const deps = fakeSummonDeps(fakeResult(), {
      findWishers: vi.fn(async () => {
        throw new Error("db fora");
      }),
    });
    const { ctx, reply } = fakeCtx();
    await runSummon(ctx, deps);
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0][0] as any).content).toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it("carta com dono: sem pacto, com orbe, cor/footer do dono e sem mencionar ninguem", async () => {
    const deps = fakeSummonDeps(fakeOwnedResult(), {
      findWishers: vi.fn(async () => ["w1"]),
      loadPactExtras: vi.fn(async () => ({
        note: "art by x",
        customImage: "https://cdn.discordapp.com/custom.png",
        embedColor: 0x123456,
        position: 4,
      })),
    });
    const { ctx, reply } = fakeCtx({ invokedAs: "m" });
    await runSummon(ctx, deps);

    expect(deps.findWishers).not.toHaveBeenCalled();
    expect(deps.loadPactExtras).toHaveBeenCalledWith({ id: 5, guildId: "g1", userId: "u9" });
    expect(deps.render).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: "https://cdn.discordapp.com/custom.png", ownerName: "bob" })
    );
    const payload = reply.mock.calls[0][0] as any;
    const embed = firstEmbedJson(payload);
    expect(embed.color).toBe(0x123456);
    expect(embed.footer.text).toBe("Pertence a bob ~~ 3 / 40 [4]");
    expect(embed.description).toContain("art by x");
    expect(embed.description).toContain("(Imagem personalizada 1)");
    expect(rowIds(payload.components[0])).toEqual(["sm:like:7", "sm:orb:7"]);
    expect(payload.allowedMentions).toEqual({ parse: [], users: [] });
    expect(payload.content).toBeUndefined();
  });

  it("dono rolou a propria carta: avisa do Selo de Despertar", async () => {
    const result = fakeOwnedResult();
    result.awardedKey = true;
    result.awakeningKeys = 4;
    const deps = fakeSummonDeps(result);
    const { ctx, reply } = fakeCtx();
    await runSummon(ctx, deps);
    expect((reply.mock.calls[0][0] as any).content).toContain("**4**");
  });

  it("erro no render: a mensagem sai sem arte, com a imagem remota no embed", async () => {
    const deps = fakeSummonDeps(fakeResult(), {
      render: vi.fn(async () => {
        throw new Error("canvas quebrou");
      }),
    });
    const { ctx, reply } = fakeCtx();
    await runSummon(ctx, deps);

    const payload = reply.mock.calls[0][0] as any;
    expect(payload.files).toEqual([]);
    expect(firstEmbedJson(payload).image.url).toBe("https://s4.anilist.co/zero.png");
    expect(deps.setOfferMessage).toHaveBeenCalledWith(7, "msg-1");
    expect(deps.refundRoll).not.toHaveBeenCalled();
  });

  it("render lento demais (timeout): fallback sem arte; sem imagem remota, sem imagem", async () => {
    const deps = fakeSummonDeps(fakeResult({}, { imageUrl: null }), {
      render: vi.fn(() => new Promise<Buffer>(() => {})),
      renderTimeoutMs: 15,
    });
    const { ctx, reply } = fakeCtx();
    await runSummon(ctx, deps);

    const payload = reply.mock.calls[0][0] as any;
    expect(payload.files).toEqual([]);
    expect(firstEmbedJson(payload).image).toBeUndefined();
  });

  it("rolls esgotados: resposta efemera com o horario exato do reset; nada e renderizado", async () => {
    const err = new UserError("summon.rolls_exhausted", {
      current: 0,
      max: 10,
      prefix: "$",
      nextWindowStart: 1_900_000_000_000,
      when: "<t:1900000000:R>",
    });
    const deps = fakeSummonDeps(fakeResult(), {
      performSummon: vi.fn(async () => {
        throw err;
      }),
    });
    const { ctx, reply, defer } = fakeCtx();
    await runSummon(ctx, deps);

    expect(reply).toHaveBeenCalledTimes(1);
    const payload = reply.mock.calls[0][0] as any;
    expect(payload.ephemeral).toBe(true);
    const text = firstEmbedJson(payload).description as string;
    expect(text).toContain("(0/10)");
    expect(text).toContain("$tu");
    expect(text).toContain("<t:1900000000:t>");
    expect(text).toContain("<t:1900000000:R>");
    expect(defer).not.toHaveBeenCalled();
    expect(deps.render).not.toHaveBeenCalled();
    expect(deps.setOfferMessage).not.toHaveBeenCalled();
  });

  it("outros erros do dominio sobem para o errorBoundary", async () => {
    const deps = fakeSummonDeps(fakeResult(), {
      performSummon: vi.fn(async () => {
        throw new UserError("summon.no_entity");
      }),
    });
    const { ctx, reply } = fakeCtx();
    await expect(runSummon(ctx, deps)).rejects.toMatchObject({ key: "summon.no_entity" });
    expect(reply).not.toHaveBeenCalled();
  });

  it("falha ao enviar a carta devolve o roll e relanca", async () => {
    const result = fakeResult();
    const deps = fakeSummonDeps(result);
    const { ctx, reply } = fakeCtx();
    reply.mockRejectedValueOnce(new Error("Missing Permissions"));

    await expect(runSummon(ctx, deps)).rejects.toThrow("Missing Permissions");
    expect(deps.refundRoll).toHaveBeenCalledWith("g1", "u1", result.consumption);
    expect(deps.setOfferMessage).not.toHaveBeenCalled();
  });

  it("falha ao vincular a mensagem so loga (a oferta continua funcionando)", async () => {
    const deps = fakeSummonDeps(fakeResult(), {
      setOfferMessage: vi.fn(async () => {
        throw new Error("db");
      }),
    });
    const { ctx } = fakeCtx();
    await expect(runSummon(ctx, deps)).resolves.toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
    expect(deps.refundRoll).not.toHaveBeenCalled();
  });

  it("en-US: usa o idioma do servidor no embed", async () => {
    const deps = fakeSummonDeps(fakeResult());
    const { ctx, reply } = fakeCtx({ locale: "en-US" });
    await runSummon(ctx, deps);
    const embed = firstEmbedJson(reply.mock.calls[0][0]);
    expect(embed.footer.text).toBe("Free for Pact");
    expect(embed.description).toContain("Animanga roulette");
  });
});

describe("views: i18n com fallback", () => {
  it("chave ausente nos locales usa o texto local; param e substituido", () => {
    expect(tr("summon.offer_protected", "pt-BR", { seconds: 12 })).toContain("**12s**");
    expect(tr("summon.offer_protected", "en-US", { seconds: 12 })).toContain("**12s**");
    expect(tr("summon.offer_protected", "fr-FR", { seconds: 5 })).toContain("**5s**");
  });

  it("chave existente vem do locale; desconhecida devolve a chave", () => {
    expect(tr("summon.like_added", "en-US", { entity: "Rem" })).toContain("Rem");
    expect(tr("nao.existe", "pt-BR")).toBe("nao.existe");
  });

  it("describeUserError acrescenta o horario exato em rolls esgotados e pacto sem cargas", () => {
    const rolls = new UserError("summon.rolls_exhausted", {
      current: 0,
      max: 3,
      prefix: "!",
      nextWindowStart: 1_800_000_000_000,
    });
    expect(describeUserError(rolls, "pt-BR")).toContain("<t:1800000000:t>");
    const pact = new UserError("summon.pact_no_charges", { nextAt: 1_800_000_000_000, max: 1 });
    expect(describeUserError(pact, "en-US")).toContain("<t:1800000000:R>");
    const taken = new UserError("summon.pact_failed_taken");
    expect(describeUserError(taken, "pt-BR")).toBe("⚡ Tarde demais! Outro invocador já selou o pacto.");
  });

  it("parseHexColor", () => {
    expect(parseHexColor("#5865F2")).toBe(0x5865f2);
    expect(parseHexColor("5865f2")).toBe(0x5865f2);
    expect(parseHexColor("azul")).toBeUndefined();
    expect(parseHexColor(null)).toBeUndefined();
  });
});
