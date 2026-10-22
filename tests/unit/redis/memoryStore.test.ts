import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import { runKvContract } from "./kvContract.js";

runKvContract("MemoryStore", async () => new MemoryStore());

describe("MemoryStore com relogio falso", () => {
  let kv: MemoryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    kv = new MemoryStore();
  });

  afterEach(async () => {
    await kv.quit();
    vi.useRealTimers();
  });

  it("expira chaves de forma preguicosa", async () => {
    await kv.set("k", "v", { px: 1000 });
    vi.advanceTimersByTime(999);
    expect(await kv.get("k")).toBe("v");
    vi.advanceTimersByTime(2);
    expect(await kv.get("k")).toBeNull();
    expect(await kv.pttl("k")).toBe(-2);
  });

  it("takeToken respeita a taxa ao longo do tempo", async () => {
    // 120/min = 1 token a cada 500ms, burst 2.
    expect(await kv.takeToken("b", 120, 2)).toBe(0);
    expect(await kv.takeToken("b", 120, 2)).toBe(0);
    expect(await kv.takeToken("b", 120, 2)).toBe(500);

    vi.advanceTimersByTime(250);
    expect(await kv.takeToken("b", 120, 2)).toBe(250);

    vi.advanceTimersByTime(250);
    expect(await kv.takeToken("b", 120, 2)).toBe(0);
    expect(await kv.takeToken("b", 120, 2)).toBe(500);
  });

  it("takeToken nunca excede o burst apos longa inatividade", async () => {
    await kv.takeToken("b2", 60, 2);
    vi.advanceTimersByTime(3_600_000);
    expect(await kv.takeToken("b2", 60, 2)).toBe(0);
    expect(await kv.takeToken("b2", 60, 2)).toBe(0);
    expect(await kv.takeToken("b2", 60, 2)).toBeGreaterThan(0);
  });

  it("takeToken rejeita parametros invalidos", async () => {
    await expect(kv.takeToken("b3", 0, 1)).rejects.toThrow(RangeError);
    await expect(kv.takeToken("b3", 10, 0)).rejects.toThrow(RangeError);
  });

  it("incr em valor nao numerico falha como o Redis", async () => {
    await kv.set("s", "abc");
    await expect(kv.incr("s")).rejects.toThrow(/integer/);
  });
});
