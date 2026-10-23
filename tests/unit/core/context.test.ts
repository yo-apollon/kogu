import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message } from "discord.js";
import type { AnyCommand } from "../../../src/core/contracts.js";
import { createPrefixContext, createSlashContext } from "../../../src/core/context.js";
import { UserError } from "../../../src/lib/errors.js";
import { fakeMessage, fakeSlash, guildConfig } from "./helpers.js";

const echo: AnyCommand = {
  name: "echo",
  category: "help",
  descriptionKey: "help.title",
  args: z.object({ times: z.coerce.number().int().min(1).max(5), text: z.string().min(1) }),
  parseArgs: (tokens) => ({ times: tokens[0], text: tokens.slice(1).join(" ") }),
  slashArgs: (i) => ({ times: i.options.data[0]?.value, text: i.options.data[1]?.value }),
  async execute() {},
};

function prefixCtx(content: string, config = guildConfig()) {
  const { message, reply, send } = fakeMessage({ content });
  const tokens = content.split(/\s+/).slice(1);
  return {
    ctx: () => createPrefixContext(message as Message<true>, echo, tokens, config, "echo"),
    reply,
    send,
    message,
  };
}

function thrown(fn: () => unknown): UserError {
  try {
    fn();
  } catch (err) {
    return err as UserError;
  }
  throw new Error("nao lancou");
}

describe("argumentos (zod)", () => {
  it("valida e coage argumentos de prefixo", () => {
    const { ctx } = prefixCtx("$echo 3 ola mundo");
    const c = ctx();
    expect(c.args).toEqual({ times: 3, text: "ola mundo" });
    expect(c.rawArgs).toEqual(["3", "ola", "mundo"]);
    expect(c.source).toBe("prefix");
    expect(c.invokedAs).toBe("echo");
  });

  it("argumento ausente vira errors.missing_argument com uso", () => {
    const err = thrown(prefixCtx("$echo").ctx);
    expect(err).toBeInstanceOf(UserError);
    expect(err.key).toBe("errors.missing_argument");
    expect(err.params.arg).toBe("times");
    expect(err.params.usage).toBe("$echo <times>");
  });

  it("argumento invalido vira errors.invalid_argument", () => {
    const err = thrown(prefixCtx("$echo 99 oi").ctx);
    expect(err.key).toBe("errors.invalid_argument");
    expect(err.params.arg).toBe("times");
  });

  it("usa o prefixo do servidor na linha de uso", () => {
    const err = thrown(prefixCtx("!echo", guildConfig({ prefix: "!" })).ctx);
    expect(err.params.usage).toBe("!echo <times>");
  });

  it("slash valida com slashArgs e usa /nome no uso", () => {
    const ok = fakeSlash({
      commandName: "echo",
      options: [
        { name: "times", value: 2 },
        { name: "text", value: "oi" },
      ],
    });
    const c = createSlashContext(ok.interaction, echo, guildConfig());
    expect(c.args).toEqual({ times: 2, text: "oi" });
    expect(c.source).toBe("slash");
    expect(c.rawArgs).toEqual([]);

    const bad = fakeSlash({ commandName: "echo", options: [] });
    const err = thrown(() => createSlashContext(bad.interaction, echo, guildConfig()));
    expect(err.key).toBe("errors.missing_argument");
    expect(err.params.usage).toBe("/echo <times>");
  });

  it("sem slashArgs, usa as opcoes do slash por nome", () => {
    const cmd: AnyCommand = {
      ...echo,
      slashArgs: undefined,
    };
    const { interaction } = fakeSlash({
      commandName: "echo",
      options: [
        { name: "times", value: 1 },
        { name: "text", value: "x" },
      ],
    });
    expect(createSlashContext(interaction, cmd, guildConfig()).args).toEqual({
      times: 1,
      text: "x",
    });
  });

  it("sem schema nem parseArgs, args e objeto vazio", () => {
    const cmd: AnyCommand = {
      name: "x",
      category: "help",
      descriptionKey: "k",
      async execute() {},
    };
    const { message } = fakeMessage({ content: "$x a b" });
    const c = createPrefixContext(message as Message<true>, cmd, ["a", "b"], guildConfig());
    expect(c.args).toEqual({});
    expect(c.rawArgs).toEqual(["a", "b"]);
  });
});

describe("respostas do contexto", () => {
  it("reply por prefixo usa message.reply sem mencoes e sem pingar o autor", async () => {
    const { ctx, reply } = prefixCtx("$echo 1 a");
    await ctx().reply("oi");
    expect(reply).toHaveBeenCalledWith({
      content: "oi",
      allowedMentions: { parse: [], repliedUser: false },
    });
  });

  it("reply por prefixo remove flag efemera", async () => {
    const { ctx, reply } = prefixCtx("$echo 1 a");
    await ctx().reply({ content: "x", ephemeral: true, flags: 64 } as never);
    const arg = reply.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.ephemeral).toBeUndefined();
    expect(arg.flags).toBeUndefined();
  });

  it("followUp por prefixo envia no canal; defer mostra 'digitando'", async () => {
    const { ctx, send, message } = prefixCtx("$echo 1 a");
    const c = ctx();
    await c.defer();
    expect((message.channel as any).sendTyping).toHaveBeenCalled();
    await c.followUp("depois");
    expect(send).toHaveBeenCalledWith({ content: "depois", allowedMentions: { parse: [] } });
  });

  it("slash: reply -> interaction.reply; apos defer -> editReply; depois -> followUp", async () => {
    const s = fakeSlash({
      commandName: "echo",
      options: [
        { name: "times", value: 1 },
        { name: "text", value: "x" },
      ],
    });
    const c = createSlashContext(s.interaction, echo, guildConfig());

    await c.defer({ ephemeral: true });
    expect(s.mock.deferReply).toHaveBeenCalledWith({ flags: 64 });
    await c.reply("primeira");
    expect(s.mock.editReply).toHaveBeenCalledTimes(1);
    expect(s.mock.reply).not.toHaveBeenCalled();
    await c.reply("segunda");
    expect(s.mock.followUp).toHaveBeenCalledTimes(1);
  });

  it("slash sem defer usa reply com fetchReply e converte ephemeral em flag", async () => {
    const s = fakeSlash({
      commandName: "echo",
      options: [
        { name: "times", value: 1 },
        { name: "text", value: "x" },
      ],
    });
    const c = createSlashContext(s.interaction, echo, guildConfig());
    await c.reply({ content: "psiu", ephemeral: true } as never);
    expect(s.mock.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "psiu", flags: 64, fetchReply: true })
    );
    // defer depois de responder e no-op
    await c.defer();
    expect(s.mock.deferReply).not.toHaveBeenCalled();
  });

  it("t() usa o idioma do servidor", () => {
    const pt = prefixCtx("$echo 1 a").ctx();
    const en = prefixCtx("$echo 1 a", guildConfig({ locale: "en-US" })).ctx();
    expect(pt.locale).toBe("pt-BR");
    expect(en.locale).toBe("en-US");
    expect(pt.t("common.yes")).toBe("Sim");
    expect(en.t("common.yes")).toBe("Yes");
    expect(pt.t("errors.error_id", { id: "abc" })).toContain("abc");
  });
});
