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

import { z } from "zod";
import type { AnyCommand, ComponentHandler } from "../../../src/core/contracts.js";
import { createCommandPipeline } from "../../../src/core/context.js";
import { createInteractionRouter } from "../../../src/core/interactionRouter.js";
import { createPrefixRouter, parsePrefixInput } from "../../../src/core/prefixRouter.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { pingCommand } from "../../../src/modules/ping/commands.js";
import { embedText, fakeMessage, fakeSlash, guildConfig, provider } from "./helpers.js";

const lifecycle = { isShuttingDown: () => false, beginWork: () => () => {} };

function setup(
  commands: Array<AnyCommand | { cmd: AnyCommand; matcher: RegExp }> = [pingCommand],
  config = guildConfig()
) {
  const registry = new CommandRegistry();
  for (const c of commands) registry.register(c);
  const guildConfigs = provider(config);
  const kv = new MemoryStore();
  const pipeline = createCommandPipeline({ kv, guildConfigs });
  const prefix = createPrefixRouter({ registry, guildConfigs, pipeline, lifecycle });
  return { registry, guildConfigs, kv, pipeline, prefix };
}

beforeEach(() => vi.clearAllMocks());

describe("parsePrefixInput", () => {
  it("extrai nome (minusculo) e tokens", () => {
    expect(parsePrefixInput("$Ping  a   b", "$")).toEqual({ name: "ping", tokens: ["a", "b"] });
    expect(parsePrefixInput("$ ping", "$")).toEqual({ name: "ping", tokens: [] });
    expect(parsePrefixInput("!!x", "!!")).toEqual({ name: "x", tokens: [] });
  });
  it("retorna null sem prefixo ou sem comando", () => {
    expect(parsePrefixInput("ping", "$")).toBeNull();
    expect(parsePrefixInput("$", "$")).toBeNull();
    expect(parsePrefixInput("$   ", "$")).toBeNull();
    expect(parsePrefixInput("$x", "")).toBeNull();
  });
});

describe("ping", () => {
  it("gera payload de slash valido com localizacao", () => {
    const { registry } = setup();
    const [ping] = registry.buildSlashPayload();
    expect(ping).toMatchObject({
      name: "ping",
      description: "Mostra a latência do bot.",
      description_localizations: { "en-US": "Shows the bot latency." },
    });
  });
});

describe("prefixRouter", () => {
  it("roteia `ping` por prefixo e responde com latencia", async () => {
    const { prefix } = setup();
    const m = fakeMessage({ content: "$ping" });
    await prefix(m.message);
    expect(m.reply).toHaveBeenCalledTimes(1);
    const payload = m.reply.mock.calls[0]![0] as any;
    expect(embedText(payload)).toContain("Pong!");
    expect(embedText(payload)).toMatch(/Latência da mensagem: \*\*\d+ ms\*\*/);
    expect(embedText(payload)).toContain("**42 ms**");
    expect(payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("usa o prefixo do servidor", async () => {
    const { prefix } = setup([pingCommand], guildConfig({ prefix: "arq!" }));
    const wrong = fakeMessage({ content: "$ping" });
    await prefix(wrong.message);
    expect(wrong.reply).not.toHaveBeenCalled();

    const right = fakeMessage({ content: "arq!PING" });
    await prefix(right.message);
    expect(right.reply).toHaveBeenCalledTimes(1);
  });

  it("ignora bots, DMs e mensagens sem comando", async () => {
    const { prefix, guildConfigs } = setup();
    for (const opts of [
      { content: "$ping", bot: true },
      { content: "$ping", inGuild: false },
      { content: "ping" },
      { content: "$naoexiste" },
      { content: "$" },
    ]) {
      const m = fakeMessage(opts);
      await prefix(m.message);
      expect(m.reply).not.toHaveBeenCalled();
    }
    // Bot e DM nem chegam a consultar a config.
    expect(guildConfigs.get).toHaveBeenCalledTimes(3);
  });

  it("resolve alias e atalhos com sufixo, informando invokedAs", async () => {
    const seen: string[] = [];
    const pt: AnyCommand = {
      name: "pantheon",
      aliases: ["pt", "p"],
      category: "collection",
      descriptionKey: "k",
      async execute(ctx) {
        seen.push(ctx.invokedAs);
      },
    };
    const { prefix } = setup([{ cmd: pt, matcher: /^pt.+/ }]);
    for (const text of ["$pantheon", "$p", "$PT", "$ptk=", "$pt2"]) {
      await prefix(fakeMessage({ content: text }).message);
    }
    expect(seen).toEqual(["pantheon", "p", "pt", "ptk=", "pt2"]);
  });

  it("cooldown: segundo $ping seguido recebe o tempo restante", async () => {
    const { prefix } = setup();
    const first = fakeMessage({ content: "$ping" });
    await prefix(first.message);
    const second = fakeMessage({ content: "$ping" });
    await prefix(second.message);
    expect(embedText(second.reply.mock.calls[0]![0])).toMatch(/Aguarde \d+ segundos/);
  });

  it("erro inesperado devolve errorId (e loga o mesmo id)", async () => {
    const boom: AnyCommand = {
      name: "boom",
      category: "help",
      descriptionKey: "k",
      async execute() {
        throw new Error("falha interna secreta");
      },
    };
    const { prefix } = setup([boom]);
    const m = fakeMessage({ content: "$boom" });
    await prefix(m.message);
    const text = embedText(m.reply.mock.calls[0]![0]);
    const id = /ID do erro: ([0-9a-f]{8})/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(text).not.toContain("secreta");
    expect(logMock.error.mock.calls.some((c) => (c[0] as any).errorId === id)).toBe(true);
  });

  it("argumento invalido responde com a mensagem de uso", async () => {
    const cmd: AnyCommand = {
      name: "give",
      category: "economy",
      descriptionKey: "k",
      args: z.object({ amount: z.coerce.number().int().positive() }),
      parseArgs: (tokens) => ({ amount: tokens[0] }),
      async execute() {},
    };
    const { prefix } = setup([cmd]);
    const m = fakeMessage({ content: "$give" });
    await prefix(m.message);
    const text = embedText(m.reply.mock.calls[0]![0]);
    expect(text).toContain("Argumento obrigatório ausente: **amount**");
    expect(text).toContain("$give <amount>");
  });

  it("nao aceita comandos durante o shutdown", async () => {
    const registry = new CommandRegistry();
    registry.register(pingCommand);
    const guildConfigs = provider();
    const pipeline = createCommandPipeline({ kv: new MemoryStore(), guildConfigs });
    const router = createPrefixRouter({
      registry,
      guildConfigs,
      pipeline,
      lifecycle: { isShuttingDown: () => true, beginWork: () => () => {} },
    });
    const m = fakeMessage({ content: "$ping" });
    await router(m.message);
    expect(m.reply).not.toHaveBeenCalled();
  });

  it("registra trabalho em andamento e libera ao terminar (mesmo com erro)", async () => {
    const ended = vi.fn();
    const begin = vi.fn(() => ended);
    const registry = new CommandRegistry();
    registry.register(pingCommand);
    const failing = {
      get: vi.fn(async () => {
        throw new Error("db fora");
      }),
    };
    const router = createPrefixRouter({
      registry,
      guildConfigs: failing,
      pipeline: createCommandPipeline({ kv: new MemoryStore(), guildConfigs: failing }),
      lifecycle: { isShuttingDown: () => false, beginWork: begin },
    });
    await expect(router(fakeMessage({ content: "$ping" }).message)).resolves.toBeUndefined();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

describe("interactionRouter", () => {
  function interactionSetup(
    handlers: ComponentHandler[] = [],
    commands: AnyCommand[] = [pingCommand]
  ) {
    const base = setup(commands);
    const router = createInteractionRouter({
      registry: base.registry,
      guildConfigs: base.guildConfigs,
      pipeline: base.pipeline,
      kv: base.kv,
      handlers,
      lifecycle,
    });
    return { ...base, router };
  }

  it("roteia o slash `/ping` e responde com latencia", async () => {
    const { router } = interactionSetup();
    const s = fakeSlash({ commandName: "ping" });
    await router(s.interaction);
    expect(s.mock.reply).toHaveBeenCalledTimes(1);
    const payload = s.mock.reply.mock.calls[0]![0] as any;
    expect(embedText(payload)).toContain("**55 ms**");
    expect(payload.fetchReply).toBe(true);
  });

  it("slash desconhecido responde erro efemero", async () => {
    const { router } = interactionSetup();
    const s = fakeSlash({ commandName: "naoexiste" });
    await router(s.interaction);
    const payload = s.mock.reply.mock.calls[0]![0] as any;
    expect(embedText(payload)).toContain("Comando desconhecido");
    expect(payload.flags).toBe(64);
  });

  it("slash com erro inesperado devolve errorId efemero", async () => {
    const boom: AnyCommand = {
      name: "boom",
      category: "help",
      descriptionKey: "k",
      slash: () => ({}) as never,
      async execute() {
        throw new Error("interno");
      },
    };
    const { router } = interactionSetup([], [boom]);
    const s = fakeSlash({ commandName: "boom" });
    await router(s.interaction);
    const payload = s.mock.reply.mock.calls[0]![0] as any;
    expect(embedText(payload)).toMatch(/ID do erro: [0-9a-f]{8}/);
    expect(payload.flags).toBe(64);
  });

  it("slash fora de servidor responde guild_only", async () => {
    const { router } = interactionSetup();
    const s = fakeSlash({ commandName: "ping" });
    (s.mock as any).guild = null;
    (s.mock as any).guildId = null;
    await router(s.interaction);
    expect(embedText(s.mock.reply.mock.calls[0]![0])).toContain("dentro de um servidor");
  });

  it("autocomplete chama o comando; erro responde lista vazia", async () => {
    const autocomplete = vi.fn(async () => {});
    const cmd: AnyCommand = { ...pingCommand, name: "ac", autocomplete };
    const { router } = interactionSetup([], [cmd]);
    const respond = vi.fn(async () => {});
    const interaction = {
      commandName: "ac",
      respond,
      isAutocomplete: () => true,
    } as any;
    await router(interaction);
    expect(autocomplete).toHaveBeenCalledWith(interaction);

    autocomplete.mockRejectedValueOnce(new Error("x"));
    await router(interaction);
    expect(respond).toHaveBeenCalledWith([]);
  });

  function componentInteraction(customId: string, kind: "button" | "modal" | "select" = "button") {
    const mock: Record<string, any> = {
      customId,
      user: { id: "u1" },
      guildId: "g1",
      deferred: false,
      replied: false,
      isAutocomplete: () => false,
      isChatInputCommand: () => false,
      isMessageComponent: () => kind !== "modal",
      isModalSubmit: () => kind === "modal",
      isButton: () => kind === "button",
      isStringSelectMenu: () => kind === "select",
      isRepliable: () => true,
      isChatInput: () => false,
      reply: vi.fn(async () => ({})),
      followUp: vi.fn(async () => ({})),
    };
    return mock;
  }

  it("despacha para o ComponentHandler pelo namespace com as partes do customId", async () => {
    const handle = vi.fn(async () => {});
    const { router } = interactionSetup([{ namespace: "sm", handle }]);
    const i = componentInteraction("sm:pact:123");
    await router(i as never);
    expect(handle).toHaveBeenCalledWith(i, ["pact", "123"]);
  });

  it("namespace desconhecido e customId invalido sao ignorados sem resposta", async () => {
    const { router } = interactionSetup();
    const a = componentInteraction("zz:1");
    const b = componentInteraction("");
    await router(a as never);
    await router(b as never);
    expect(a.reply).not.toHaveBeenCalled();
    expect(b.reply).not.toHaveBeenCalled();
  });

  it("erro no handler de componente devolve errorId", async () => {
    const { router } = interactionSetup([
      {
        namespace: "sm",
        handle: async () => {
          throw new Error("kaboom");
        },
      },
    ]);
    const i = componentInteraction("sm:x");
    await router(i as never);
    expect(embedText(i.reply.mock.calls[0]![0])).toMatch(/ID do erro: [0-9a-f]{8}/);
  });

  it("pg/cf/pn vao para os handlers da UI (estado expirado responde 'expirou')", async () => {
    const { router } = interactionSetup();
    const pg = componentInteraction("pg:inexistente:next");
    pg.update = vi.fn(async () => {});
    await router(pg as never);
    expect(pg.reply).toHaveBeenCalled();
    expect(embedText(pg.reply.mock.calls[0]![0])).toMatch(/expirou/i);
  });

  it("rejeita namespaces reservados e duplicados no handler", () => {
    const base = setup();
    const deps = {
      registry: base.registry,
      guildConfigs: base.guildConfigs,
      pipeline: base.pipeline,
      kv: base.kv,
      lifecycle,
    };
    const h = (namespace: string): ComponentHandler => ({ namespace, handle: async () => {} });
    expect(() => createInteractionRouter({ ...deps, handlers: [h("pg")] })).toThrow(/reservado/);
    expect(() => createInteractionRouter({ ...deps, handlers: [h("a"), h("a")] })).toThrow(
      /duplicado/
    );
  });
});
