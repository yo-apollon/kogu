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

import { MessageFlags } from "discord.js";
import { UserError } from "../../../src/lib/errors.js";
import {
  createSummonComponentHandler,
  SUMMON_NAMESPACE,
} from "../../../src/modules/summon/components.js";
import { components as moduleComponents, commands as moduleCommands, jobs } from "../../../src/modules/summon/index.js";
import {
  fakeButton,
  fakeComponentDeps,
  firstEmbedJson,
} from "./commandsHelpers.js";

beforeEach(() => vi.clearAllMocks());

const click = (
  handler: ReturnType<typeof createSummonComponentHandler>,
  interaction: unknown,
  parts: string[]
) => handler.handle(interaction as never, parts);

function ephemeralText(call: unknown): string {
  const payload = call as { content?: string; flags?: number; embeds?: unknown[] };
  expect(payload.flags).toBe(MessageFlags.Ephemeral);
  return payload.content ?? (firstEmbedJson(payload).description as string);
}

describe("registro do modulo", () => {
  it("exporta commands, components e jobs", () => {
    expect(moduleCommands.map((c) => c.name)).toEqual(["roll", "w", "h", "m", "ar"]);
    expect(moduleComponents).toHaveLength(1);
    expect(moduleComponents[0].namespace).toBe("sm");
    expect(SUMMON_NAMESPACE).toBe("sm");
    expect(typeof jobs.startSummonSweeper).toBe("function");
  });

  it("ignora interacoes que nao sao botoes", async () => {
    const handler = createSummonComponentHandler(fakeComponentDeps());
    const { interaction } = fakeButton();
    interaction.isButton = () => false;
    await click(handler, interaction, ["pact", "7"]);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe("pact", () => {
  it("firma o pacto: embed do dono, botao desabilitado, anuncio no canal e UMA resposta", async () => {
    const deps = fakeComponentDeps();
    const handler = createSummonComponentHandler(deps);
    const { interaction, send } = fakeButton({ userId: "u2", username: "carol" });

    await click(handler, interaction, ["pact", "7"]);

    expect(deps.claimPact).toHaveBeenCalledWith(7, "u2", { username: "carol" });
    expect(interaction.update).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();

    const payload = interaction.update.mock.calls[0][0];
    const embed = firstEmbedJson(payload);
    expect(embed.color).toBe(0x112233);
    expect(embed.footer.text).toBe("Pertence a carol ~~ 1 / 40 [3]");
    expect(embed.footer.icon_url).toBe("https://cdn.discordapp.com/avatars/u2.png");
    // arte e linhas originais preservadas
    expect(embed.author.name).toBe("Zero Two");
    expect(embed.image.url).toBe("attachment://card.webp");
    expect(embed.description).toContain("Roleta Animanga");

    const row = payload.components[0].toJSON().components;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({
      custom_id: "sm:done:7",
      disabled: true,
      label: "Pacto Firmado com carol",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const announce = send.mock.calls[0][0] as { content: string; allowedMentions: unknown };
    expect(announce.content).toContain("carol");
    expect(announce.content).toContain("Zero Two");
    expect(announce.content).toContain("FOIL");
    expect(announce.allowedMentions).toEqual({ parse: [] });
  });

  it("usa a cor padrao se a cor do membro falhar", async () => {
    const deps = fakeComponentDeps({
      memberColor: vi.fn(async () => {
        throw new Error("db");
      }),
      pactPosition: vi.fn(async () => {
        throw new Error("db");
      }),
    });
    const handler = createSummonComponentHandler(deps);
    const { interaction } = fakeButton();
    await click(handler, interaction, ["pact", "7"]);
    const embed = firstEmbedJson(interaction.update.mock.calls[0][0]);
    expect(embed.color).toBe(0xfacc15);
    expect(embed.footer.text).toContain("[1]");
  });

  it.each([
    ["summon.pact_failed_taken", "Tarde demais"],
    ["summon.pact_already_bound", "já foi vinculada"],
    ["errors.expired", "expirou"],
  ])("UserError %s vira resposta efemera, sem tocar na mensagem", async (key, snippet) => {
    const deps = fakeComponentDeps({
      claimPact: vi.fn(async () => {
        throw new UserError(key);
      }),
    });
    const handler = createSummonComponentHandler(deps);
    const { interaction, send } = fakeButton();

    await click(handler, interaction, ["pact", "7"]);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(ephemeralText(interaction.reply.mock.calls[0][0])).toContain(snippet);
  });

  it("oferta protegida mostra os segundos restantes (chave com fallback local)", async () => {
    const deps = fakeComponentDeps({
      claimPact: vi.fn(async () => {
        throw new UserError("summon.offer_protected", { seconds: 12 });
      }),
    });
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["pact", "7"]);
    const text = ephemeralText(interaction.reply.mock.calls[0][0]);
    expect(text).toContain("12s");
    expect(text).not.toBe("summon.offer_protected");
  });

  it("sem cargas de pacto mostra o horario exato da recarga", async () => {
    const deps = fakeComponentDeps({
      claimPact: vi.fn(async () => {
        throw new UserError("summon.pact_no_charges", { nextAt: 1_900_000_000_000, max: 1 });
      }),
    });
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["pact", "7"]);
    const text = ephemeralText(interaction.reply.mock.calls[0][0]);
    expect(text).toContain("<t:1900000000:t>");
    expect(text).toContain("<t:1900000000:R>");
  });

  it("erro inesperado sobe para o roteador (sem responder duas vezes)", async () => {
    const deps = fakeComponentDeps({
      claimPact: vi.fn(async () => {
        throw new Error("conexao caiu");
      }),
    });
    const { interaction } = fakeButton();
    await expect(click(createSummonComponentHandler(deps), interaction, ["pact", "7"])).rejects.toThrow(
      "conexao caiu"
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it("interacao expirada no update: edita a mensagem pela API e ainda anuncia", async () => {
    const { interaction, send } = fakeButton();
    interaction.update.mockRejectedValueOnce(Object.assign(new Error("Unknown interaction"), { code: 10062 }));
    await click(createSummonComponentHandler(fakeComponentDeps()), interaction, ["pact", "7"]);

    expect(interaction.message.edit).toHaveBeenCalledTimes(1);
    const edited = interaction.message.edit.mock.calls[0][0];
    expect(edited.components[0].toJSON().components[0].disabled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("se nem update nem edit funcionam, nao lanca (o pacto ja foi gravado)", async () => {
    const { interaction } = fakeButton();
    interaction.update.mockRejectedValueOnce(new Error("expired"));
    interaction.message.edit.mockRejectedValueOnce(new Error("gone"));
    await expect(
      click(createSummonComponentHandler(fakeComponentDeps()), interaction, ["pact", "7"])
    ).resolves.toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it("falha no anuncio nao propaga", async () => {
    const { interaction, send } = fakeButton();
    send.mockRejectedValueOnce(new Error("sem permissao"));
    await expect(
      click(createSummonComponentHandler(fakeComponentDeps()), interaction, ["pact", "7"])
    ).resolves.toBeUndefined();
    expect(interaction.update).toHaveBeenCalledTimes(1);
  });

  it("resposta de erro em interacao expirada so loga", async () => {
    const deps = fakeComponentDeps({
      claimPact: vi.fn(async () => {
        throw new UserError("summon.pact_failed_taken");
      }),
    });
    const { interaction } = fakeButton();
    interaction.reply.mockRejectedValueOnce(Object.assign(new Error("Unknown interaction"), { code: 10062 }));
    await expect(click(createSummonComponentHandler(deps), interaction, ["pact", "7"])).resolves.toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it("canal sem send (cache vazio) nao quebra o anuncio", async () => {
    const { interaction } = fakeButton({ channel: null });
    await expect(
      click(createSummonComponentHandler(fakeComponentDeps()), interaction, ["pact", "7"])
    ).resolves.toBeUndefined();
    expect(interaction.update).toHaveBeenCalledTimes(1);
  });

  it("usa o idioma do servidor", async () => {
    const deps = fakeComponentDeps({ localeOf: vi.fn(async () => "en-US" as const) });
    const { interaction } = fakeButton({ username: "carol" });
    await click(createSummonComponentHandler(deps), interaction, ["pact", "7"]);
    const payload = interaction.update.mock.calls[0][0];
    expect(firstEmbedJson(payload).footer.text).toBe("Belongs to carol ~~ 1 / 40 [3]");
    expect(payload.components[0].toJSON().components[0].label).toBe("Pact Forged with carol");
  });
});

describe("like", () => {
  it("curte e responde em efemero com o nome da carta", async () => {
    const deps = fakeComponentDeps();
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["like", "7"]);

    expect(deps.getOffer).toHaveBeenCalledWith(7);
    expect(deps.likeEntity).toHaveBeenCalledWith("u2", 11, { username: "carol" });
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const text = ephemeralText(interaction.reply.mock.calls[0][0]);
    expect(text).toContain("Zero Two");
    expect(text).toContain("favoritos");
  });

  it("segundo like avisa que ja curtiu (chave com fallback local)", async () => {
    const deps = fakeComponentDeps({ likeEntity: vi.fn(async () => ({ added: false, likesCount: 3 })) });
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["like", "7"]);
    expect(ephemeralText(interaction.reply.mock.calls[0][0])).toContain("já favoritou");
  });

  it("oferta inexistente vira errors.expired", async () => {
    const deps = fakeComponentDeps({ getOffer: vi.fn(async () => null) });
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["like", "7"]);
    expect(deps.likeEntity).not.toHaveBeenCalled();
    expect(ephemeralText(interaction.reply.mock.calls[0][0])).toContain("expirou");
  });
});

describe("orb", () => {
  it("absorve: so o botao muda (embed intacto), anuncia e responde uma vez", async () => {
    const deps = fakeComponentDeps();
    const { interaction, send } = fakeButton({ customId: "sm:orb:7", username: "carol" });

    await click(createSummonComponentHandler(deps), interaction, ["orb", "7"]);

    expect(deps.claimOrb).toHaveBeenCalledWith(7, "u2", { username: "carol" });
    expect(interaction.update).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
    const payload = interaction.update.mock.calls[0][0];
    expect(payload.embeds).toBeUndefined();
    expect(payload.components[0].toJSON().components[0]).toMatchObject({
      custom_id: "sm:orbdone:7",
      disabled: true,
      label: "+76 Éter Absorvido por carol",
    });
    expect((send.mock.calls[0][0] as { content: string }).content).toContain("+76");
  });

  it("orbe ja absorvido vira resposta efemera", async () => {
    const deps = fakeComponentDeps({
      claimOrb: vi.fn(async () => {
        throw new UserError("summon.orb_taken");
      }),
    });
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, ["orb", "7"]);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(ephemeralText(interaction.reply.mock.calls[0][0])).toContain("já foi absorvido");
  });
});

describe("customId invalido", () => {
  it.each([
    [["pact"]],
    [["pact", "abc"]],
    [["pact", "-3"]],
    [["pact", "0"]],
    [["pact", "99999999999999999999"]],
    [["done", "7"]],
    [["orbdone", "7"]],
    [["xyz", "7"]],
    [[]],
  ])("%j responde expirado sem chamar o dominio", async (parts) => {
    const deps = fakeComponentDeps();
    const { interaction } = fakeButton();
    await click(createSummonComponentHandler(deps), interaction, parts);
    expect(deps.claimPact).not.toHaveBeenCalled();
    expect(deps.claimOrb).not.toHaveBeenCalled();
    expect(deps.likeEntity).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(ephemeralText(interaction.reply.mock.calls[0][0])).toContain("expirou");
  });
});
