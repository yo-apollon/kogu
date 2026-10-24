import { PermissionFlagsBits } from "discord.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { argOf, fakeDb } from "./helpers.js";

vi.mock("../../../src/infra/db/client.js", async () => {
  const { fakeDb } = await import("./helpers.js");
  return { db: fakeDb.db, sql: {}, closeDb: vi.fn() };
});

vi.mock("../../../src/infra/redis/client.js", async () => {
  const { MemoryStore } = await import("../../../src/infra/redis/memoryStore.js");
  const kv = new MemoryStore();
  return { getKV: vi.fn(async () => kv) };
});

vi.mock("../../../src/modules/summon/service.js", () => ({
  resetGuildWindows: vi.fn(async () => undefined),
}));

vi.mock("../../../src/modules/summon/rollEngine.js", () => ({
  invalidateDisabledCache: vi.fn(async () => undefined),
}));

import { guildConfigKey } from "../../../src/core/middleware/guildConfig.js";
import { disabledSeries, guilds } from "../../../src/infra/db/schema/index.js";
import { getKV } from "../../../src/infra/redis/client.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { UserError } from "../../../src/lib/errors.js";
import { invalidateDisabledCache } from "../../../src/modules/summon/rollEngine.js";
import { resetGuildWindows } from "../../../src/modules/summon/service.js";
import {
  applyGuildSetting,
  assertCanManageServerWide,
  autocompleteTargets,
  disableTarget,
  enableTarget,
  findDisabledEntry,
  parseSetting,
  parseTargetRef,
  SETTING_LIMITS,
  targetRefValue,
  type DisabledEntry,
  type DisableTarget,
} from "../../../src/modules/config/service.js";

let kv: MemoryStore;

beforeEach(async () => {
  fakeDb.reset();
  vi.mocked(resetGuildWindows).mockClear();
  vi.mocked(invalidateDisabledCache).mockClear();
  kv = (await getKV()) as MemoryStore;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await kv.quit();
});

function keyOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as UserError).key;
  }
  return undefined;
}

describe("parseSetting", () => {
  it("setrolls: 1 a 50, aceita numero ou texto", () => {
    expect(parseSetting("rolls", "1", "$")).toBe(1);
    expect(parseSetting("rolls", "50", "$")).toBe(50);
    expect(parseSetting("rolls", 15, "$")).toBe(15);
    expect(parseSetting("rolls", "  8 ", "$")).toBe(8);
  });

  it.each([0, 51, -1, 2.5, "0", "51", "abc", "", " ", "1.5", "1e2", "0x10", null, undefined, NaN])(
    "setrolls recusa %j com a mensagem de uso e a faixa",
    (bad) => {
      let thrown: UserError | undefined;
      try {
        parseSetting("rolls", bad, "!");
      } catch (e) {
        thrown = e as UserError;
      }
      expect(thrown).toBeInstanceOf(UserError);
      expect(thrown!.key).toBe("config.setrolls_invalid");
      expect(thrown!.params).toEqual({ min: 1, max: 50, prefix: "!" });
    }
  );

  it("settimer (30-360), setclaim (10-120) e gamemode (1-2)", () => {
    expect(parseSetting("timer", "30", "$")).toBe(30);
    expect(parseSetting("timer", 360, "$")).toBe(360);
    expect(keyOf(() => parseSetting("timer", 29, "$"))).toBe("config.settimer_invalid");
    expect(keyOf(() => parseSetting("timer", 361, "$"))).toBe("config.settimer_invalid");
    expect(parseSetting("claim", "10", "$")).toBe(10);
    expect(keyOf(() => parseSetting("claim", 9, "$"))).toBe("config.setclaim_invalid");
    expect(keyOf(() => parseSetting("claim", 121, "$"))).toBe("config.setclaim_invalid");
    expect(parseSetting("gamemode", "2", "$")).toBe(2);
    expect(keyOf(() => parseSetting("gamemode", 0, "$"))).toBe("config.gamemode_invalid");
    expect(keyOf(() => parseSetting("gamemode", 3, "$"))).toBe("config.gamemode_invalid");
  });

  it("prefix: 1 a 5 caracteres sem espacos nem crase", () => {
    expect(parseSetting("prefix", "!", "$")).toBe("!");
    expect(parseSetting("prefix", "ab!?.", "$")).toBe("ab!?.");
    for (const bad of ["", "abcdef", "a b", " ", "`", "a`b", 5, undefined]) {
      let thrown: UserError | undefined;
      try {
        parseSetting("prefix", bad, "$");
      } catch (e) {
        thrown = e as UserError;
      }
      expect(thrown?.key, String(bad)).toBe("config.prefix_invalid");
      expect(thrown?.params).toMatchObject({ max: SETTING_LIMITS.prefix.max, prefix: "$" });
    }
  });

  it("lang: aliases viram o locale; qualquer outro idioma e recusado", () => {
    expect(parseSetting("lang", "pt-br", "$")).toBe("pt-BR");
    expect(parseSetting("lang", "PT-BR", "$")).toBe("pt-BR");
    expect(parseSetting("lang", "pt", "$")).toBe("pt-BR");
    expect(parseSetting("lang", "en", "$")).toBe("en-US");
    expect(parseSetting("lang", " EN-us ", "$")).toBe("en-US");
    for (const bad of ["es", "", "english", "fr-FR", 3, undefined]) {
      expect(keyOf(() => parseSetting("lang", bad, "$")), String(bad)).toBe("config.lang_usage");
    }
  });
});

describe("applyGuildSetting (db e KV mockados)", () => {
  const events: Array<{ channel: string; message: string }> = [];
  const order: string[] = [];

  beforeEach(() => {
    events.length = 0;
    order.length = 0;
    vi.spyOn(kv, "publish").mockImplementation(async (channel, message) => {
      events.push({ channel, message });
      order.push("publish");
    });
    vi.mocked(resetGuildWindows).mockImplementation(async () => {
      order.push("reset");
    });
  });

  it("setrolls: grava base_rolls, apaga a chave e publica a invalidacao; nao zera janelas", async () => {
    await kv.set(guildConfigKey("g1"), "{}");
    const applied = await applyGuildSetting("g1", "rolls", "25", { prefix: "$" });

    expect(applied).toEqual({ key: "rolls", value: 25, windowsReset: false });
    const [stmt] = fakeDb.ofOp("insert");
    expect(stmt!.table).toBe(guilds);
    expect(argOf(stmt!, "values")).toMatchObject({ id: "g1", baseRolls: 25 });
    const conflict = argOf(stmt!, "onConflictDoUpdate");
    expect(conflict.target).toBe(guilds.id);
    expect(conflict.set).toMatchObject({ baseRolls: 25 });
    expect(conflict.set.updatedAt).toBeInstanceOf(Date);
    expect(await kv.get(guildConfigKey("g1"))).toBeNull();
    expect(events).toEqual([
      { channel: "guild:config:invalidate", message: JSON.stringify({ guildId: "g1" }) },
    ]);
    expect(resetGuildWindows).not.toHaveBeenCalled();
  });

  it("settimer: grava claim_cooldown_minutes e zera as janelas DEPOIS de invalidar", async () => {
    const applied = await applyGuildSetting("g1", "timer", 120, { prefix: "$" });

    expect(applied).toEqual({ key: "timer", value: 120, windowsReset: true });
    expect(argOf(fakeDb.ofOp("insert")[0]!, "values")).toMatchObject({ claimCooldownMinutes: 120 });
    expect(resetGuildWindows).toHaveBeenCalledTimes(1);
    expect(resetGuildWindows).toHaveBeenCalledWith("g1");
    expect(order).toEqual(["publish", "reset"]);
  });

  it.each([
    ["claim", "60", { claimWindowSeconds: 60 }],
    ["gamemode", 2, { gamemode: 2 }],
    ["prefix", "!", { prefix: "!" }],
    ["lang", "en", { language: "en-US" }],
  ] as const)("%s grava a coluna certa e publica", async (key, raw, patch) => {
    const applied = await applyGuildSetting("g1", key, raw, { prefix: "$" });
    expect(applied.windowsReset).toBe(false);
    expect(argOf(fakeDb.ofOp("insert")[0]!, "values")).toMatchObject({ id: "g1", ...patch });
    expect(argOf(fakeDb.ofOp("insert")[0]!, "onConflictDoUpdate").set).toMatchObject(patch);
    expect(events).toHaveLength(1);
    expect(resetGuildWindows).not.toHaveBeenCalled();
  });

  it("valor invalido: nada e gravado, publicado nem zerado", async () => {
    await expect(applyGuildSetting("g1", "rolls", 99, { prefix: "$" })).rejects.toMatchObject({
      key: "config.setrolls_invalid",
    });
    await expect(applyGuildSetting("g1", "timer", "x", { prefix: "$" })).rejects.toBeInstanceOf(UserError);
    expect(fakeDb.statements).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(resetGuildWindows).not.toHaveBeenCalled();
  });

  it("falha do banco nao publica invalidacao", async () => {
    vi.spyOn(fakeDb.db, "insert").mockImplementationOnce(() => {
      throw new Error("banco fora");
    });
    await expect(applyGuildSetting("g1", "rolls", 10, { prefix: "$" })).rejects.toThrow("banco fora");
    expect(events).toHaveLength(0);
  });
});

describe("assertCanManageServerWide", () => {
  const member = (admin: boolean) => ({ permissions: { has: vi.fn(() => admin) } });

  it("so Administrador passa", () => {
    const admin = member(true);
    expect(() => assertCanManageServerWide(admin)).not.toThrow();
    expect(admin.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
  });

  it("nao-admin, membro ausente ou indefinido: errors.missing_administrator", () => {
    for (const m of [member(false), null, undefined]) {
      expect(keyOf(() => assertCanManageServerWide(m))).toBe("errors.missing_administrator");
    }
  });
});

describe("disableTarget / enableTarget (db mockado)", () => {
  const series: DisableTarget = { kind: "series", id: 11, name: "Frieren" };
  const franchise: DisableTarget = { kind: "franchise", id: 3, name: "Fate" };

  it("usuario: insere, devolve created e invalida o cache do servidor e do usuario", async () => {
    fakeDb.next("select", []); // nada existente
    fakeDb.next("insert", []); // guilds
    fakeDb.next("insert", []); // users
    fakeDb.next("insert", [{ id: 9 }]); // disabled_series returning
    const result = await disableTarget({ guildId: "g1", userId: "u1", username: "alice", target: series });

    expect(result).toEqual({ created: true });
    const insert = fakeDb.ofOp("insert").find((s) => s.table === disabledSeries)!;
    expect(argOf(insert, "values")).toEqual({
      guildId: "g1",
      userId: "u1",
      isServerWide: false,
      seriesId: 11,
      franchiseId: null,
    });
    expect(invalidateDisabledCache).toHaveBeenCalledTimes(1);
    expect(invalidateDisabledCache).toHaveBeenCalledWith("g1", "u1");
  });

  it("franquia e server-wide: grava franchise_id e invalida so o conjunto do servidor", async () => {
    fakeDb.next("select", []);
    fakeDb.next("insert", []);
    fakeDb.next("insert", []);
    fakeDb.next("insert", [{ id: 10 }]);
    await disableTarget({ guildId: "g1", userId: "admin", target: franchise, serverWide: true });

    const insert = fakeDb.ofOp("insert").find((s) => s.table === disabledSeries)!;
    expect(argOf(insert, "values")).toMatchObject({
      isServerWide: true,
      seriesId: null,
      franchiseId: 3,
    });
    expect(invalidateDisabledCache).toHaveBeenCalledTimes(1);
    expect(invalidateDisabledCache).toHaveBeenCalledWith("g1", undefined);
  });

  it("ja desativada: created false, nao insere nem invalida", async () => {
    fakeDb.next("select", [{ id: 1 }]);
    const result = await disableTarget({ guildId: "g1", userId: "u1", target: series });
    expect(result).toEqual({ created: false });
    expect(fakeDb.ofOp("insert").some((s) => s.table === disabledSeries)).toBe(false);
    expect(invalidateDisabledCache).not.toHaveBeenCalled();
  });

  it("enableTarget: conta as linhas removidas e invalida so quando removeu", async () => {
    fakeDb.next("delete", [{ id: 1 }, { id: 2 }]);
    expect(await enableTarget({ guildId: "g1", userId: "u1", target: series })).toBe(2);
    expect(invalidateDisabledCache).toHaveBeenLastCalledWith("g1", "u1");

    vi.mocked(invalidateDisabledCache).mockClear();
    fakeDb.next("delete", []);
    expect(await enableTarget({ guildId: "g1", userId: "u1", target: series })).toBe(0);
    expect(invalidateDisabledCache).not.toHaveBeenCalled();

    fakeDb.next("delete", [{ id: 5 }]);
    await enableTarget({ guildId: "g1", userId: "admin", target: franchise, serverWide: true });
    expect(invalidateDisabledCache).toHaveBeenLastCalledWith("g1", undefined);
  });
});

describe("alvos de desativacao", () => {
  const entries: DisabledEntry[] = [
    { kind: "series", id: 1, name: "Sousou no Frieren", serverWide: false, createdAt: new Date(0) },
    { kind: "franchise", id: 2, name: "Fate", serverWide: false, createdAt: new Date(0) },
    { kind: "series", id: 3, name: "Fate/Zero", serverWide: false, createdAt: new Date(0) },
  ];

  it("s:N / f:N / texto", () => {
    expect(parseTargetRef("s:12")).toEqual({ kind: "series", id: 12 });
    expect(parseTargetRef("f:7")).toEqual({ kind: "franchise", id: 7 });
    expect(parseTargetRef("  s:12 ")).toEqual({ kind: "series", id: 12 });
    expect(parseTargetRef("x:12")).toEqual({ kind: "text", text: "x:12" });
    expect(parseTargetRef("s:")).toEqual({ kind: "text", text: "s:" });
    expect(parseTargetRef("Fate/Zero")).toEqual({ kind: "text", text: "Fate/Zero" });
    expect(targetRefValue({ kind: "series", id: 5 })).toBe("s:5");
    expect(targetRefValue({ kind: "franchise", id: 5 })).toBe("f:5");
  });

  it("findDisabledEntry: id exato, igualdade de nome e todos os tokens", () => {
    expect(findDisabledEntry(entries, "s:3")?.name).toBe("Fate/Zero");
    expect(findDisabledEntry(entries, "f:3")).toBeUndefined();
    expect(findDisabledEntry(entries, "fate")?.id).toBe(2); // igualdade vence a substring
    expect(findDisabledEntry(entries, "fate zero")?.id).toBe(3);
    expect(findDisabledEntry(entries, "frieren")?.id).toBe(1);
    expect(findDisabledEntry(entries, "naruto")).toBeUndefined();
    expect(findDisabledEntry(entries, "   ")).toBeUndefined();
  });

  it("autocompleteTargets: cache de 60 s por consulta normalizada; consulta curta nao busca", async () => {
    const search = vi.fn(async () => [{ kind: "series" as const, id: 1, name: "Sousou no Frieren" }]);
    const a = await autocompleteTargets(kv, "Frieren", { search });
    const b = await autocompleteTargets(kv, " frieren ", { search });
    expect(b).toEqual(a);
    expect(search).toHaveBeenCalledTimes(1);
    expect(await kv.pttl("cache:ac:series:frieren")).toBeGreaterThan(50_000);
    expect(await autocompleteTargets(kv, "f", { search })).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
