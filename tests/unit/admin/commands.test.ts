import { PermissionFlagsBits } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/modules/admin/service.js", async (orig) => ({
  ...(await orig<typeof import("../../../src/modules/admin/service.js")>()),
  setVipTier: vi.fn(async (_db, target: { id: string }, tier: number) => ({ id: target.id, tier, isVip: tier > 0 })),
  restoreRolls: vi.fn(async (_db, input: { rolls?: number }) => ({
    rolls: input.rolls ?? 10,
    stacked: 50,
    rollsUsed: 0,
  })),
  countUserPacts: vi.fn(),
  releaseUserPacts: vi.fn(),
  countThanosCandidates: vi.fn(),
  snapThanos: vi.fn(),
}));
vi.mock("../../../src/ui/components/confirm.js", () => ({ confirm: vi.fn() }));

import { checkCommandPermissions } from "../../../src/core/middleware/permissions.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { UserError } from "../../../src/lib/errors.js";
import {
  adminCommands,
  adminResetCommand,
  cleanUserCommand,
  parseUserId,
  setVipCommand,
  thanosCommand,
} from "../../../src/modules/admin/commands.js";
import { commands, components } from "../../../src/modules/admin/index.js";
import * as svc from "../../../src/modules/admin/service.js";
import { confirm } from "../../../src/ui/components/confirm.js";
import { makeCtx, textOf } from "./helpers.js";

const TARGET = "123456789012345678";
const adminMember = { permissions: { has: () => true } };
const plainMember = { permissions: { has: () => false } };
const isOwnerId = (id: string) => id === "owner1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registro do modulo", () => {
  it("exporta os comandos e registra aliases sem colisao", () => {
    expect(commands.map((c) => c.name)).toEqual(["setvip", "adminreset", "cleanuser", "thanos"]);
    expect(components).toEqual([]);
    const registry = new CommandRegistry();
    for (const cmd of adminCommands) registry.register(cmd);
    expect(registry.get("godmode")?.name).toBe("adminreset");
    expect(registry.get("resetme")?.name).toBe("adminreset");
    expect(registry.get("userdivorce")?.name).toBe("cleanuser");
    for (const cmd of adminCommands) {
      expect(cmd.category).toBe("admin");
      expect(cmd.descriptionKey).toMatch(/^help\.commands\./);
    }
  });

  it("gera o payload slash com opcoes e restringe a Administrator", () => {
    const registry = new CommandRegistry();
    for (const cmd of adminCommands) registry.register(cmd);
    const payload = Object.fromEntries(registry.buildSlashPayload().map((p) => [p.name, p]));
    expect(Object.keys(payload).sort()).toEqual(["adminreset", "cleanuser", "setvip", "thanos"]);
    expect((payload.setvip.options as any[]).map((o) => [o.name, o.required])).toEqual([
      ["user", true],
      ["tier", true],
    ]);
    const tier = (payload.setvip.options as any[])[1];
    expect([tier.min_value, tier.max_value]).toEqual([0, 3]);
    expect((payload.adminreset.options as any[])[0]).toMatchObject({ name: "rolls", max_value: 1000 });
    expect((payload.cleanuser.options as any[])[0].name).toBe("user");
    for (const p of Object.values(payload)) {
      expect(BigInt(p.default_member_permissions as string) & PermissionFlagsBits.Administrator).toBe(
        PermissionFlagsBits.Administrator
      );
    }
    // A descricao vem de help.commands.setvip (locales), nao do fallback do comando.
    expect(payload.setvip.description).toContain("Define o nível VIP de um membro");
  });
});

describe("permissoes: setvip e adminreset sao SOMENTE de OWNER_IDS", () => {
  it("marcados com ownerOnly", () => {
    expect(setVipCommand.ownerOnly).toBe(true);
    expect(adminResetCommand.ownerOnly).toBe(true);
    expect(cleanUserCommand.ownerOnly).toBeFalsy();
    expect(thanosCommand.ownerOnly).toBeFalsy();
  });

  it("administrador de servidor que nao e owner e negado", () => {
    for (const cmd of [setVipCommand, adminResetCommand]) {
      let err: unknown;
      try {
        checkCommandPermissions(cmd, "admin-de-servidor", adminMember, isOwnerId);
      } catch (e) {
        err = e;
      }
      expect(err, cmd.name).toBeInstanceOf(UserError);
      expect((err as UserError).key).toBe("errors.owner_only");
    }
  });

  it("owner passa mesmo sem permissao de servidor", () => {
    for (const cmd of [setVipCommand, adminResetCommand]) {
      expect(() => checkCommandPermissions(cmd, "owner1", plainMember, isOwnerId)).not.toThrow();
    }
  });

  it("cleanuser e thanos exigem Administrator (e owner sem a permissao tambem nao passa)", () => {
    for (const cmd of [cleanUserCommand, thanosCommand]) {
      expect(cmd.permissions).toBe(PermissionFlagsBits.Administrator);
      expect(() => checkCommandPermissions(cmd, "x", adminMember, isOwnerId)).not.toThrow();
      let err: unknown;
      try {
        checkCommandPermissions(cmd, "owner1", plainMember, isOwnerId);
      } catch (e) {
        err = e;
      }
      expect((err as UserError).key).toBe("errors.missing_administrator");
    }
  });
});

describe("parseUserId", () => {
  it("aceita mencao, mencao com apelido e id puro", () => {
    expect(parseUserId(`<@${TARGET}>`)).toBe(TARGET);
    expect(parseUserId(`<@!${TARGET}>`)).toBe(TARGET);
    expect(parseUserId(TARGET)).toBe(TARGET);
    expect(parseUserId("alice")).toBeUndefined();
    expect(parseUserId(undefined)).toBeUndefined();
  });
});

describe("$setvip", () => {
  it("parseArgs: mencao + tier", () => {
    expect(setVipCommand.parseArgs!([`<@${TARGET}>`, "2"], {} as never)).toEqual({ userId: TARGET, tier: "2" });
    expect(setVipCommand.parseArgs!(["x"], {} as never)).toEqual({ userId: "", tier: "" });
  });

  it("grava o tier e responde (sem pingar o alvo)", async () => {
    const { ctx, sent } = makeCtx({
      args: { userId: TARGET, tier: "2" },
      mentions: [{ id: TARGET, username: "bob" }],
    });
    await setVipCommand.execute(ctx);
    expect(svc.setVipTier).toHaveBeenCalledTimes(1);
    const [, target, tier] = vi.mocked(svc.setVipTier).mock.calls[0];
    expect(target).toEqual({ id: TARGET, username: "bob" });
    expect(tier).toBe(2);
    expect(textOf(sent[0])).toContain(`<@${TARGET}>`);
    expect(textOf(sent[0])).toContain("Tier 2");
  });

  it.each([["5"], ["-1"], ["abc"], [""], ["1.5"]])("tier invalido %j mostra o uso e nao grava", async (tier) => {
    const { ctx, sent } = makeCtx({ args: { userId: TARGET, tier } });
    await setVipCommand.execute(ctx);
    expect(svc.setVipTier).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("$setvip @usuario <tier>");
  });

  it("alvo invalido mostra o uso", async () => {
    const { ctx, sent } = makeCtx({ args: { userId: "", tier: "1" }, prefix: "!" });
    await setVipCommand.execute(ctx);
    expect(svc.setVipTier).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("!setvip");
  });

  it("tier 0 remove o VIP", async () => {
    const { ctx } = makeCtx({ args: { userId: TARGET, tier: "0" } });
    await setVipCommand.execute(ctx);
    expect(vi.mocked(svc.setVipTier).mock.calls[0][2]).toBe(0);
  });
});

describe("$adminreset", () => {
  it("sem argumento restaura para o limite do servidor", async () => {
    const { ctx, sent } = makeCtx({ args: { rolls: "" } });
    await adminResetCommand.execute(ctx);
    const input = vi.mocked(svc.restoreRolls).mock.calls[0][1];
    expect(input).toMatchObject({
      guildId: "g1",
      userId: "owner1",
      baseRolls: 10,
      rollIntervalMin: 60,
      resetOffsetMin: 0,
      claimIntervalMin: 180,
      rolls: 10,
    });
    expect(textOf(sent[0])).toContain("restaurados para **10**");
    expect(textOf(sent[0])).toContain("+50 Rolls Empilhados");
  });

  it("com [n] usa o valor pedido", async () => {
    const { ctx, sent } = makeCtx({ args: { rolls: "3" } });
    await adminResetCommand.execute(ctx);
    expect(vi.mocked(svc.restoreRolls).mock.calls[0][1].rolls).toBe(3);
    expect(textOf(sent[0])).toContain("**3**");
  });

  it.each([["abc"], ["-2"], ["1001"]])("valor invalido %j e recusado", async (rolls) => {
    const { ctx, sent } = makeCtx({ args: { rolls } });
    await adminResetCommand.execute(ctx);
    expect(svc.restoreRolls).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("1000");
  });

  it("parseArgs e slashArgs", () => {
    expect(adminResetCommand.parseArgs!(["7"], {} as never)).toEqual({ rolls: "7" });
    expect(adminResetCommand.parseArgs!([], {} as never)).toEqual({ rolls: "" });
    expect(adminResetCommand.slashArgs!({ options: { getInteger: () => null } } as never)).toEqual({ rolls: "" });
    expect(adminResetCommand.slashArgs!({ options: { getInteger: () => 4 } } as never)).toEqual({ rolls: "4" });
  });
});

describe("$cleanuser / $userdivorce", () => {
  it("sem usuario valido mostra o uso", async () => {
    const { ctx, sent } = makeCtx({ args: { userId: "" } });
    await cleanUserCommand.execute(ctx);
    expect(textOf(sent[0])).toContain("cleanuser @usuario");
    expect(svc.countUserPacts).not.toHaveBeenCalled();
  });

  it("usuario sem pactos: nao pede confirmacao", async () => {
    vi.mocked(svc.countUserPacts).mockResolvedValue(0);
    const { ctx, sent } = makeCtx({ args: { userId: TARGET } });
    await cleanUserCommand.execute(ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(svc.releaseUserPacts).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("**0** pactos");
  });

  it("pede confirmacao antes de apagar; recusado nao apaga", async () => {
    vi.mocked(svc.countUserPacts).mockResolvedValue(4);
    vi.mocked(confirm).mockResolvedValue(false);
    const { ctx, sent } = makeCtx({ args: { userId: TARGET } });
    await cleanUserCommand.execute(ctx);
    const opts = vi.mocked(confirm).mock.calls[0][0];
    expect(opts).toMatchObject({ ownerId: "owner1", danger: true });
    expect(opts.prompt).toContain("**4**");
    expect(opts.prompt).toContain(`<@${TARGET}>`);
    expect(svc.releaseUserPacts).not.toHaveBeenCalled();
    expect(sent.at(-1).content).toBe("Ação cancelada.");
  });

  it("confirmado apaga no servidor do comando e informa a quantidade liberada", async () => {
    vi.mocked(svc.countUserPacts).mockResolvedValue(4);
    vi.mocked(svc.releaseUserPacts).mockResolvedValue(4);
    vi.mocked(confirm).mockResolvedValue(true);
    const { ctx, sent } = makeCtx({ args: { userId: TARGET } });
    await cleanUserCommand.execute(ctx);
    expect(vi.mocked(svc.releaseUserPacts).mock.calls[0].slice(1)).toEqual(["g1", TARGET]);
    expect(textOf(sent.at(-1))).toContain("Todos os **4** pactos");
  });
});

describe("$thanos", () => {
  it("sem pactos elegiveis nao pergunta nem apaga", async () => {
    vi.mocked(svc.countThanosCandidates).mockResolvedValue(0);
    const { ctx, sent } = makeCtx();
    await thanosCommand.execute(ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(svc.snapThanos).not.toHaveBeenCalled();
    expect(textOf(sent[0])).toContain("Nenhum pacto elegível");
  });

  it("PEDE CONFIRMACAO (danger) mostrando quantos sao elegiveis antes de qualquer exclusao", async () => {
    vi.mocked(svc.countThanosCandidates).mockResolvedValue(120);
    vi.mocked(confirm).mockResolvedValue(false);
    const { ctx, sent } = makeCtx();
    await thanosCommand.execute(ctx);
    expect(confirm).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(confirm).mock.calls[0][0];
    expect(opts).toMatchObject({ ownerId: "owner1", danger: true, locale: "pt-BR" });
    expect(opts.prompt).toContain("**120**");
    expect(opts.prompt).toContain("metade");
    expect(svc.snapThanos).not.toHaveBeenCalled();
    expect(sent.at(-1).content).toBe("Ação cancelada.");
  });

  it("a mensagem de confirmacao e enviada pelo ctx.reply e aceita o 'send' do confirm", async () => {
    vi.mocked(svc.countThanosCandidates).mockResolvedValue(5);
    vi.mocked(confirm).mockImplementation(async (o) => {
      await o.send({ embeds: [], components: [] });
      return false;
    });
    const { ctx, mock } = makeCtx();
    await thanosCommand.execute(ctx);
    expect(mock.reply).toHaveBeenCalledTimes(1);
  });

  it("confirmado executa so no servidor atual e informa a contagem real", async () => {
    vi.mocked(svc.countThanosCandidates).mockResolvedValue(120);
    vi.mocked(svc.snapThanos).mockResolvedValue({ eligible: 120, removed: 57 });
    vi.mocked(confirm).mockResolvedValue(true);
    const { ctx, sent } = makeCtx({ locale: "en-US" });
    await thanosCommand.execute(ctx);
    expect(vi.mocked(svc.snapThanos).mock.calls[0][1]).toBe("g1");
    expect(textOf(sent.at(-1))).toContain("**57** entities");
  });
});
