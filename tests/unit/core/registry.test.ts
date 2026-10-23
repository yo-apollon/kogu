import { SlashCommandBuilder } from "discord.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnyCommand } from "../../../src/core/contracts.js";
import { CommandRegistry } from "../../../src/core/registry.js";

function cmd(name: string, extra: Partial<AnyCommand> = {}): AnyCommand {
  return {
    name,
    category: "help",
    descriptionKey: "help.title",
    async execute() {},
    ...extra,
  };
}

describe("CommandRegistry", () => {
  let registry: CommandRegistry;
  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it("resolve por nome e alias (case-insensitive)", () => {
    const wa = cmd("wa", { aliases: ["waifu", "W"] });
    registry.register(wa);
    expect(registry.get("wa")).toBe(wa);
    expect(registry.get("WAIFU")).toBe(wa);
    expect(registry.get("w")).toBe(wa);
    expect(registry.get("nada")).toBeUndefined();
    expect(registry.list()).toEqual([wa]);
  });

  it("lanca em nome duplicado", () => {
    registry.register(cmd("ping"));
    expect(() => registry.register(cmd("ping"))).toThrow(/duplicado/);
  });

  it("lanca quando um alias colide com nome ou alias existente", () => {
    registry.register(cmd("ping", { aliases: ["p"] }));
    expect(() => registry.register(cmd("pong", { aliases: ["p"] }))).toThrow(/duplicado/);
    expect(() => registry.register(cmd("x", { aliases: ["ping"] }))).toThrow(/duplicado/);
  });

  it("falha de registro nao deixa o comando pela metade", () => {
    registry.register(cmd("a"));
    expect(() => registry.register(cmd("b", { aliases: ["novo", "a"] }))).toThrow();
    expect(registry.get("novo")).toBeUndefined();
    expect(registry.get("b")).toBeUndefined();
  });

  it("lanca em alias repetido no mesmo comando e em nome com espaco", () => {
    expect(() => registry.register(cmd("a", { aliases: ["x", "X"] }))).toThrow(/repetido/);
    expect(() => registry.register(cmd("com espaco"))).toThrow(/invalido/);
  });

  it("matcher resolve atalhos com sufixo apos nome/alias exatos", () => {
    const pt = cmd("pantheon", { aliases: ["pt", "p"] });
    const mm = cmd("mymarry", { aliases: ["mm"] });
    registry.register({ cmd: pt, matcher: /^pt.+/ });
    registry.register({ cmd: mm, matcher: (token) => token.startsWith("mm") });

    expect(registry.resolve("pt")?.cmd).toBe(pt);
    expect(registry.resolve("ptk=")?.cmd).toBe(pt);
    expect(registry.resolve("PTx")?.cmd).toBe(pt);
    expect(registry.resolve("mm2")?.cmd).toBe(mm);
    expect(registry.resolve("zzz")).toBeUndefined();
    // get() nao consulta matchers
    expect(registry.get("ptk=")).toBeUndefined();
  });

  it("matcher com flag g nao guarda estado entre chamadas", () => {
    const pt = cmd("pantheon");
    registry.register({ cmd: pt, matcher: /^pt/g });
    expect(registry.resolve("pt1")?.cmd).toBe(pt);
    expect(registry.resolve("pt2")?.cmd).toBe(pt);
    expect(registry.resolve("pt3")?.cmd).toBe(pt);
  });

  describe("buildSlashPayload", () => {
    it("inclui so comandos com slash e preenche descricao pelo i18n", () => {
      registry.register(cmd("semslash"));
      registry.register(
        cmd("comslash", { slash: () => new SlashCommandBuilder().setName("comslash") as never })
      );
      const payload = registry.buildSlashPayload();
      expect(payload.map((p) => p.name)).toEqual(["comslash"]);
      expect(payload[0]?.description.length).toBeGreaterThan(0);
      expect(payload[0]?.description.length).toBeLessThanOrEqual(100);
    });

    it("preenche o nome quando o builder nao define", () => {
      registry.register(cmd("auto", { slash: () => new SlashCommandBuilder() as never }));
      expect(registry.buildSlashPayload()[0]?.name).toBe("auto");
    });

    it("respeita descricao definida pelo comando", () => {
      registry.register(
        cmd("d", {
          slash: () => new SlashCommandBuilder().setName("d").setDescription("custom") as never,
        })
      );
      expect(registry.buildSlashPayload()[0]?.description).toBe("custom");
    });

    it("lanca em slash duplicado", () => {
      const slash = () => new SlashCommandBuilder().setName("igual").setDescription("x") as never;
      registry.register(cmd("a", { slash }));
      registry.register(cmd("b", { slash }));
      expect(() => registry.buildSlashPayload()).toThrow(/duplicado/);
    });
  });
});
