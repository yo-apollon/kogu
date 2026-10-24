import type { Message } from "discord.js";
import { describe, expect, it } from "vitest";
import type { AnyCommand } from "../../../src/core/contracts.js";
import { createPrefixContext } from "../../../src/core/context.js";
import { CommandRegistry } from "../../../src/core/registry.js";
import { parseUserId } from "../../../src/modules/economy/commands.js";
import { commands, components } from "../../../src/modules/economy/index.js";
import { UserError } from "../../../src/lib/errors.js";
import { fakeMessage, guildConfig } from "../core/helpers.js";

function registryWithEconomy(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const cmd of commands) registry.register(cmd);
  return registry;
}

/** Todos os nomes/aliases do bot antigo que pertencem a este modulo (messageHandler.ts). */
const LEGACY_TABLE: Array<[token: string, canonical: string]> = [
  // timers.ts
  ["tu", "timers"],
  ["timersup", "timers"],
  ["timers", "timers"],
  ["mu", "marryup"],
  ["marryup", "marryup"],
  ["ru", "rollsup"],
  ["rollsup", "rollsup"],
  ["rollsleft", "rollsup"],
  ["ku", "kakeraup"],
  ["kakeraup", "kakeraup"],
  // daily ("rolls" NAO e mais daily: agora responde como $ru)
  ["daily", "daily"],
  ["dk", "daily"],
  ["dailykakera", "daily"],
  ["diario", "daily"],
  ["rolls", "rollsup"],
  // perfil
  ["pr", "profile"],
  ["profile", "profile"],
  ["perfil", "profile"],
  // reliquias
  ["k", "relics"],
  ["kakera", "relics"],
  ["relics", "relics"],
  ["badge", "relics"],
  ["reliquias", "relics"],
  // ranking
  ["top", "top"],
  ["topserv", "top"],
  ["ts", "top"],
];

describe("registro do modulo economy", () => {
  it("registra sem colisao de nome/alias", () => {
    expect(() => registryWithEconomy()).not.toThrow();
    expect(commands.map((c) => c.name)).toEqual([
      "timers",
      "marryup",
      "rollsup",
      "kakeraup",
      "daily",
      "profile",
      "relics",
      "top",
    ]);
  });

  it.each(LEGACY_TABLE)("alias %s resolve para %s", (token, canonical) => {
    expect(registryWithEconomy().resolve(token)?.cmd.name).toBe(canonical);
  });

  it("$rolls nao e mais o daily", () => {
    const registry = registryWithEconomy();
    expect(registry.get("rolls")?.name).not.toBe("daily");
    expect(registry.get("daily")?.aliases ?? []).not.toContain("rolls");
  });

  it("todos sao da categoria economy e tem descricao i18n", () => {
    for (const cmd of commands) {
      expect(cmd.category).toBe("economy");
      expect(cmd.descriptionKey).toMatch(/^help\.commands\./);
      expect(cmd.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("exporta o handler de componentes com o namespace ec", () => {
    expect(components.map((c) => c.namespace)).toEqual(["ec"]);
  });
});

describe("slash commands", () => {
  const payload = registryWithEconomy().buildSlashPayload();
  const byName = Object.fromEntries(payload.map((p) => [p.name, p]));

  it("registra /timers, /daily, /profile, /relics e /top", () => {
    expect(payload.map((p) => p.name).sort()).toEqual([
      "daily",
      "profile",
      "relics",
      "timers",
      "top",
    ]);
    for (const p of payload) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.description.length).toBeLessThanOrEqual(100);
      expect(p.description_localizations?.["en-US"]).toBeTruthy();
    }
  });

  it("/profile tem a opcao opcional user", () => {
    const [option] = byName.profile!.options as any[];
    expect(option).toMatchObject({ name: "user", type: 6, required: false });
  });

  it("/relics tem uma escolha com as 6 reliquias", () => {
    const [option] = byName.relics!.options as any[];
    expect(option).toMatchObject({ name: "relic", type: 3, required: false });
    expect(option.choices.map((c: any) => c.value)).toEqual([
      "bronze",
      "silver",
      "gold",
      "sapphire",
      "ruby",
      "emerald",
    ]);
    expect(option.choices[0].name).toContain("Bronze");
  });

  it("/top tem as escolhas aether e pacts", () => {
    const [option] = byName.top!.options as any[];
    expect(option).toMatchObject({ name: "mode", type: 3, required: false });
    expect(option.choices.map((c: any) => c.value)).toEqual(["aether", "pacts"]);
  });
});

describe("argumentos de prefixo", () => {
  const command = (name: string): AnyCommand => registryWithEconomy().get(name)!;

  function argsOf(name: string, content: string) {
    const { message } = fakeMessage({ content });
    const tokens = content.split(/\s+/).slice(1);
    return createPrefixContext(message as Message<true>, command(name), tokens, guildConfig(), name)
      .args;
  }

  function errorOf(name: string, content: string): UserError {
    try {
      argsOf(name, content);
    } catch (err) {
      return err as UserError;
    }
    throw new Error("nao lancou");
  }

  it("parseUserId aceita mencao e id numerico", () => {
    expect(parseUserId("<@123456789012345678>")).toBe("123456789012345678");
    expect(parseUserId("<@!123456789012345678>")).toBe("123456789012345678");
    expect(parseUserId("123456789012345678")).toBe("123456789012345678");
    expect(parseUserId("ana")).toBeUndefined();
    expect(parseUserId("123")).toBeUndefined();
    expect(parseUserId(undefined)).toBeUndefined();
  });

  it("$pr sem argumento e com mencao", () => {
    expect(argsOf("profile", "$pr")).toEqual({});
    expect(argsOf("profile", "$pr <@123456789012345678>")).toEqual({
      userId: "123456789012345678",
    });
  });

  it("$pr com texto que nao e usuario vira errors.invalid_user", () => {
    expect(errorOf("profile", "$pr ninguem").key).toBe("errors.invalid_user");
  });

  it("$k: sem argumento abre o altar; com nome evolui; desconhecido e erro", () => {
    expect(argsOf("relics", "$k")).toEqual({});
    expect(argsOf("relics", "$k bronze")).toEqual({ relic: "bronze" });
    expect(argsOf("relics", "$k Esmeralda")).toEqual({ relic: "emerald" });
    expect(argsOf("relics", "$k rubi")).toEqual({ relic: "ruby" });
    const err = errorOf("relics", "$k platina");
    expect(err.key).toBe("errors.invalid_argument");
    expect(err.params.arg).toBe("relic");
  });

  it("$top: padrao Eter; aceita pactos; criterio invalido e erro", () => {
    expect(argsOf("top", "$top")).toEqual({ mode: "aether" });
    expect(argsOf("top", "$ts")).toEqual({ mode: "aether" });
    expect(argsOf("top", "$top pactos")).toEqual({ mode: "pacts" });
    expect(argsOf("top", "$top pacts")).toEqual({ mode: "pacts" });
    expect(argsOf("top", "$topserv eter")).toEqual({ mode: "aether" });
    expect(errorOf("top", "$top xyz").key).toBe("errors.invalid_argument");
  });
});
