import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/logger.js", () => {
  const noop = () => undefined;
  const stub = { warn: noop, error: noop, info: noop, debug: noop };
  return { logger: stub, childLogger: () => stub };
});

import { cacheGetOrSet, cacheInvalidate, cacheKey } from "../../../src/infra/redis/cache.js";
import { checkCooldown } from "../../../src/infra/redis/cooldowns.js";
import { tryLock, withLock } from "../../../src/infra/redis/locks.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { publishEvent, subscribeEvent } from "../../../src/infra/redis/pubsub.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let kv: MemoryStore;

beforeEach(() => {
  kv = new MemoryStore();
});

afterEach(async () => {
  await kv.quit();
});

describe("locks", () => {
  it("withLock executa, libera e devolve o resultado", async () => {
    const out = await withLock(kv, "l", 1000, async () => 42);
    expect(out).toEqual({ acquired: true, result: 42 });
    expect(await kv.acquireLock("l", 1000)).not.toBeNull();
  });

  it("withLock devolve acquired:false se ocupado e nao roda fn", async () => {
    await kv.acquireLock("l", 5000);
    const fn = vi.fn(async () => 1);
    expect(await withLock(kv, "l", 1000, fn)).toEqual({ acquired: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("withLock libera mesmo quando fn lanca", async () => {
    await expect(
      withLock(kv, "l", 5000, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await kv.acquireLock("l", 1000)).not.toBeNull();
  });

  it("withLock serializa execucoes concorrentes: so uma entra", async () => {
    let running = 0;
    let maxRunning = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        withLock(kv, "l", 5000, async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await sleep(5);
          running--;
        })
      )
    );
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
    expect(maxRunning).toBe(1);
  });

  it("tryLock expoe release que respeita o dono", async () => {
    const a = await tryLock(kv, "l", 5000);
    expect(a.acquired).toBe(true);
    expect((await tryLock(kv, "l", 5000)).acquired).toBe(false);
    if (a.acquired) {
      expect(await a.release()).toBe(true);
      expect(await a.release()).toBe(false);
    }
    expect((await tryLock(kv, "l", 5000)).acquired).toBe(true);
  });
});

describe("cooldowns", () => {
  it("primeiro uso passa, segundo informa o tempo restante", async () => {
    expect(await checkCooldown(kv, "u1", "daily", 5000)).toEqual({ ok: true });
    const second = await checkCooldown(kv, "u1", "daily", 5000);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.retryAfterMs).toBeGreaterThan(0);
      expect(second.retryAfterMs).toBeLessThanOrEqual(5000);
    }
  });

  it("isola por usuario e por comando", async () => {
    await checkCooldown(kv, "u1", "daily", 5000);
    expect(await checkCooldown(kv, "u2", "daily", 5000)).toEqual({ ok: true });
    expect(await checkCooldown(kv, "u1", "roll", 5000)).toEqual({ ok: true });
  });

  it("libera apos o prazo", async () => {
    await checkCooldown(kv, "u1", "fast", 60);
    await sleep(120);
    expect(await checkCooldown(kv, "u1", "fast", 60)).toEqual({ ok: true });
  });

  it("concorrencia: exatamente um uso passa", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () => checkCooldown(kv, "u1", "daily", 5000))
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("cache", () => {
  it("chama o loader uma vez e serve o resto do cache", async () => {
    const loader = vi.fn(async () => ({ a: 1, b: ["x"] }));
    const key = cacheKey("t", 1);
    expect(await cacheGetOrSet(kv, key, 5000, loader)).toEqual({ a: 1, b: ["x"] });
    expect(await cacheGetOrSet(kv, key, 5000, loader)).toEqual({ a: 1, b: ["x"] });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("chamadas concorrentes compartilham um unico loader", async () => {
    const loader = vi.fn(async () => {
      await sleep(20);
      return "v";
    });
    const out = await Promise.all(
      Array.from({ length: 10 }, () => cacheGetOrSet(kv, "c", 5000, loader))
    );
    expect(out).toEqual(Array(10).fill("v"));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("recarrega apos expirar e apos invalidar", async () => {
    const loader = vi.fn(async () => "v");
    await cacheGetOrSet(kv, "c", 50, loader);
    await sleep(120);
    await cacheGetOrSet(kv, "c", 5000, loader);
    expect(loader).toHaveBeenCalledTimes(2);

    expect(await cacheInvalidate(kv, "c")).toBe(1);
    await cacheGetOrSet(kv, "c", 5000, loader);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("armazena null mas nao undefined; JSON corrompido vira miss", async () => {
    const nullLoader = vi.fn(async () => null);
    await cacheGetOrSet(kv, "n", 5000, nullLoader);
    await cacheGetOrSet(kv, "n", 5000, nullLoader);
    expect(nullLoader).toHaveBeenCalledTimes(1);

    const undefLoader = vi.fn(async () => undefined);
    await cacheGetOrSet(kv, "u", 5000, undefLoader);
    await cacheGetOrSet(kv, "u", 5000, undefLoader);
    expect(undefLoader).toHaveBeenCalledTimes(2);

    await kv.set("bad", "{nao-json");
    const loader = vi.fn(async () => 7);
    expect(await cacheGetOrSet(kv, "bad", 5000, loader)).toBe(7);
  });

  it("propaga erro do loader sem gravar cache", async () => {
    const loader = vi.fn(async (): Promise<string> => {
      throw new Error("falhou");
    });
    await expect(cacheGetOrSet(kv, "e", 5000, loader)).rejects.toThrow("falhou");
    expect(await kv.get("e")).toBeNull();
  });
});

describe("pubsub tipado", () => {
  it("entrega payload tipado de catalog:updated", async () => {
    const received: Array<{ source: string; at: number }> = [];
    const off = await subscribeEvent(kv, "catalog:updated", (p) => {
      received.push(p);
    });
    await publishEvent(kv, "catalog:updated", { source: "sync", at: 123 });
    await vi.waitFor(() => expect(received).toEqual([{ source: "sync", at: 123 }]));
    await off();
  });

  it("entrega guild:config:invalidate e isola canais", async () => {
    const guilds: string[] = [];
    const catalog = vi.fn();
    const off1 = await subscribeEvent(kv, "guild:config:invalidate", (p) => {
      guilds.push(p.guildId);
    });
    const off2 = await subscribeEvent(kv, "catalog:updated", catalog);
    await publishEvent(kv, "guild:config:invalidate", { guildId: "g1" });
    await vi.waitFor(() => expect(guilds).toEqual(["g1"]));
    expect(catalog).not.toHaveBeenCalled();
    await off1();
    await off2();
  });

  it("descarta mensagens invalidas e continua entregando as validas", async () => {
    const guilds: string[] = [];
    const off = await subscribeEvent(kv, "guild:config:invalidate", (p) => {
      guilds.push(p.guildId);
    });
    await kv.publish("guild:config:invalidate", "nao-e-json");
    await kv.publish("guild:config:invalidate", JSON.stringify({ guildId: 5 }));
    await kv.publish("guild:config:invalidate", JSON.stringify({ guildId: "ok" }));
    await vi.waitFor(() => expect(guilds).toEqual(["ok"]));
    await off();
  });

  it("publishEvent rejeita payload fora do schema", async () => {
    await expect(
      publishEvent(kv, "guild:config:invalidate", { guildId: 5 } as unknown as { guildId: string })
    ).rejects.toThrow();
  });

  it("excecao no handler nao impede entregas seguintes", async () => {
    const seen: string[] = [];
    const off = await subscribeEvent(kv, "guild:config:invalidate", (p) => {
      seen.push(p.guildId);
      if (p.guildId === "a") throw new Error("boom");
    });
    await publishEvent(kv, "guild:config:invalidate", { guildId: "a" });
    await publishEvent(kv, "guild:config:invalidate", { guildId: "b" });
    await vi.waitFor(() => expect(seen).toEqual(["a", "b"]));
    await off();
  });
});
