import { PermissionFlagsBits } from "discord.js";
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

import type { AnyCommand } from "../../../src/core/contracts.js";
import type { Invocation } from "../../../src/core/context.js";
import { runMiddleware } from "../../../src/core/context.js";
import { cooldownMiddleware } from "../../../src/core/middleware/cooldown.js";
import { errorBoundary } from "../../../src/core/middleware/errorBoundary.js";
import { guildConfigMiddleware } from "../../../src/core/middleware/guildConfig.js";
import { permissionsMiddleware } from "../../../src/core/middleware/permissions.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { InfraError, UserError } from "../../../src/lib/errors.js";
import { embedText, guildConfig, provider } from "./helpers.js";

function command(extra: Partial<AnyCommand> = {}): AnyCommand {
  return { name: "test", category: "help", descriptionKey: "k", async execute() {}, ...extra };
}

function invocation(cmd: AnyCommand, extra: Partial<Invocation> & { perms?: boolean } = {}) {
  const replies: any[] = [];
  const inv = {
    source: "prefix",
    command: cmd,
    invokedAs: cmd.name,
    user: { id: "u1" },
    member: { permissions: { has: vi.fn(() => extra.perms ?? true) } },
    guild: { id: "g1" },
    responder: {
      defer: vi.fn(),
      reply: vi.fn(async (p: unknown) => {
        replies.push(p);
        return {};
      }),
      followUp: vi.fn(),
    },
    guildConfig: guildConfig(),
    get locale() {
      return (
        (this as unknown as { guildConfig?: { locale: string } }).guildConfig?.locale ?? "pt-BR"
      );
    },
    buildContext: vi.fn(() => ({})),
    ...extra,
  } as unknown as Invocation;
  return { inv, replies };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("errorBoundary", () => {
  it("UserError vira resposta i18n efemera, sem log de erro", async () => {
    const { inv, replies } = invocation(command());
    await runMiddleware([errorBoundary()], inv, async () => {
      throw new UserError("errors.invalid_number_range", { min: 1, max: 5 });
    });
    expect(replies).toHaveLength(1);
    expect(embedText(replies[0])).toBe("Informe um número entre **1** e **5**.");
    expect(replies[0].flags).toBe(64);
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it("UserError com usage anexa a linha de uso", async () => {
    const { inv, replies } = invocation(command());
    await runMiddleware([errorBoundary()], inv, async () => {
      throw new UserError("errors.missing_argument", { arg: "nome", usage: "$test <nome>" });
    });
    const text = embedText(replies[0]);
    expect(text).toContain("**nome**");
    expect(text).toContain("Uso: $test <nome>");
  });

  it("erro inesperado: loga com errorId e responde com o mesmo id, sem vazar a mensagem", async () => {
    const { inv, replies } = invocation(command());
    await runMiddleware([errorBoundary()], inv, async () => {
      throw new Error("segredo: senha=hunter2 at /srv/app.ts:10");
    });
    expect(replies).toHaveLength(1);
    const text = embedText(replies[0]);
    const id = /ID do erro: ([0-9a-f]{8})/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("app.ts");
    expect(logMock.error).toHaveBeenCalledTimes(1);
    expect(logMock.error.mock.calls[0]![0]).toMatchObject({
      errorId: id,
      command: "test",
      userId: "u1",
    });
  });

  it("InfraError usa o proprio errorId e a mensagem de infraestrutura", async () => {
    const { inv, replies } = invocation(command());
    const infra = new InfraError("pg caiu");
    await runMiddleware([errorBoundary()], inv, async () => {
      throw infra;
    });
    const text = embedText(replies[0]);
    expect(text).toContain(infra.errorId);
    expect(text).toContain("instáveis");
    expect(text).not.toContain("pg caiu");
  });

  it("usa o idioma do servidor", async () => {
    const { inv, replies } = invocation(command(), {
      guildConfig: guildConfig({ locale: "en-US" }),
    });
    await runMiddleware([errorBoundary()], inv, async () => {
      throw new Error("x");
    });
    expect(embedText(replies[0])).toContain("Error ID:");
  });

  it("falha ao responder nao propaga", async () => {
    const { inv } = invocation(command());
    (inv.responder.reply as any).mockRejectedValue(new Error("Unknown interaction"));
    await expect(
      runMiddleware([errorBoundary()], inv, async () => {
        throw new Error("boom");
      })
    ).resolves.toBeUndefined();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it("sem erro nao responde", async () => {
    const { inv, replies } = invocation(command());
    const run = vi.fn(async () => {});
    await runMiddleware([errorBoundary()], inv, run);
    expect(run).toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("ownerOnly: bloqueia quem nao e dono e libera o dono", async () => {
    const mw = permissionsMiddleware((id) => id === "owner");
    const cmd = command({ ownerOnly: true });

    const { inv } = invocation(cmd);
    await expect(runMiddleware([mw], inv, async () => {})).rejects.toMatchObject({
      key: "errors.owner_only",
    });

    const owner = invocation(cmd, { user: { id: "owner" } as never });
    const run = vi.fn(async () => {});
    await runMiddleware([mw], owner.inv, run);
    expect(run).toHaveBeenCalled();
  });

  it("permissions: delega ao membro e escolhe a mensagem pela permissao faltante", async () => {
    const mw = permissionsMiddleware(() => false);

    const manage = invocation(command({ permissions: PermissionFlagsBits.ManageGuild }), {
      perms: false,
    });
    await expect(runMiddleware([mw], manage.inv, async () => {})).rejects.toMatchObject({
      key: "errors.missing_manage_guild",
    });

    const admin = invocation(command({ permissions: PermissionFlagsBits.Administrator }), {
      perms: false,
    });
    await expect(runMiddleware([mw], admin.inv, async () => {})).rejects.toMatchObject({
      key: "errors.missing_administrator",
    });

    const other = invocation(command({ permissions: PermissionFlagsBits.BanMembers }), {
      perms: false,
    });
    await expect(runMiddleware([mw], other.inv, async () => {})).rejects.toMatchObject({
      key: "common.no_permission",
    });

    const allowed = invocation(command({ permissions: PermissionFlagsBits.BanMembers }), {
      perms: true,
    });
    const run = vi.fn(async () => {});
    await runMiddleware([mw], allowed.inv, run);
    expect(run).toHaveBeenCalled();
  });

  it("sem member e com permissions exigidas: nega", async () => {
    const { inv } = invocation(command({ permissions: PermissionFlagsBits.BanMembers }), {
      member: null,
    });
    await expect(
      runMiddleware([permissionsMiddleware()], inv, async () => {})
    ).rejects.toBeInstanceOf(UserError);
  });

  it("comando sem restricoes passa", async () => {
    const { inv } = invocation(command());
    const run = vi.fn(async () => {});
    await runMiddleware([permissionsMiddleware(() => false)], inv, run);
    expect(run).toHaveBeenCalled();
  });
});

describe("cooldown", () => {
  it("segundo uso dentro da janela falha com o tempo restante", async () => {
    const kv = new MemoryStore();
    const mw = cooldownMiddleware(kv);
    const { inv } = invocation(command({ cooldownMs: 5_000 }));
    const run = vi.fn(async () => {});

    await runMiddleware([mw], inv, run);
    expect(run).toHaveBeenCalledTimes(1);

    const err = await runMiddleware([mw], inv, run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).key).toBe("common.cooldown");
    expect(Number((err as UserError).params.seconds)).toBeGreaterThanOrEqual(1);
    expect(Number((err as UserError).params.seconds)).toBeLessThanOrEqual(5);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cooldown e por usuario e por comando", async () => {
    const kv = new MemoryStore();
    const mw = cooldownMiddleware(kv);
    const run = vi.fn(async () => {});
    const a = invocation(command({ cooldownMs: 5_000 }));
    const b = invocation(command({ cooldownMs: 5_000 }), { user: { id: "u2" } as never });
    const c = invocation(command({ name: "outro", cooldownMs: 5_000 }));
    await runMiddleware([mw], a.inv, run);
    await runMiddleware([mw], b.inv, run);
    await runMiddleware([mw], c.inv, run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("sem cooldownMs nao consulta o KV", async () => {
    const kv = new MemoryStore();
    const spy = vi.spyOn(kv, "set");
    const { inv } = invocation(command());
    await runMiddleware([cooldownMiddleware(kv)], inv, async () => {});
    expect(spy).not.toHaveBeenCalled();
  });

  it("argumento invalido nao gasta o cooldown", async () => {
    const kv = new MemoryStore();
    const mw = cooldownMiddleware(kv);
    const { inv } = invocation(command({ cooldownMs: 5_000 }));
    (inv.buildContext as any).mockImplementationOnce(() => {
      throw new UserError("errors.missing_argument", { arg: "x" });
    });
    await expect(runMiddleware([mw], inv, async () => {})).rejects.toMatchObject({
      key: "errors.missing_argument",
    });
    // Proxima tentativa (valida) passa: o cooldown nao foi consumido.
    const run = vi.fn(async () => {});
    await runMiddleware([mw], inv, run);
    expect(run).toHaveBeenCalled();
  });
});

describe("guildConfig middleware", () => {
  it("preenche inv.guildConfig quando ausente e nao recarrega quando presente", async () => {
    const p = provider(guildConfig({ prefix: "!" }));
    const { inv } = invocation(command(), { guildConfig: undefined });
    await runMiddleware([guildConfigMiddleware(p)], inv, async () => {});
    expect(inv.guildConfig?.prefix).toBe("!");
    expect(p.get).toHaveBeenCalledWith("g1");

    const loaded = invocation(command());
    await runMiddleware([guildConfigMiddleware(p)], loaded.inv, async () => {});
    expect(p.get).toHaveBeenCalledTimes(1);
  });
});
