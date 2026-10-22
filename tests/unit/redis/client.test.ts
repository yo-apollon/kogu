import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({
  NODE_ENV: "test" as "development" | "production" | "test",
  REDIS_URL: undefined as string | undefined,
}));

vi.mock("../../../src/config/env.js", () => ({
  getEnv: () => ({ ...envState, LOG_LEVEL: "silent" }),
}));

vi.mock("../../../src/lib/logger.js", () => {
  const noop = () => undefined;
  const stub = { warn: noop, error: noop, info: noop, debug: noop };
  return { logger: stub, childLogger: () => stub };
});

import { closeKV, createKV, getKV, isRedisReady } from "../../../src/infra/redis/client.js";

describe("client: selecao de backend", () => {
  beforeEach(() => {
    envState.REDIS_URL = undefined;
    envState.NODE_ENV = "test";
  });

  afterEach(async () => {
    await closeKV();
  });

  it("sem REDIS_URL em test usa MemoryStore", async () => {
    const kv = await createKV();
    expect(kv.kind).toBe("memory");
    await kv.quit();
  });

  it("sem REDIS_URL em development usa MemoryStore", async () => {
    envState.NODE_ENV = "development";
    const kv = await createKV();
    expect(kv.kind).toBe("memory");
    await kv.quit();
  });

  it("sem REDIS_URL em production lanca erro", async () => {
    envState.NODE_ENV = "production";
    await expect(createKV()).rejects.toThrow(/REDIS_URL/);
  });

  it("getKV devolve singleton e nao guarda falha em cache", async () => {
    envState.NODE_ENV = "production";
    await expect(getKV()).rejects.toThrow(/REDIS_URL/);

    envState.NODE_ENV = "test";
    const a = await getKV();
    const b = await getKV();
    expect(a).toBe(b);
  });

  it("isRedisReady: false sem singleton, true com ele, false apos close", async () => {
    expect(await isRedisReady()).toBe(false);
    await getKV();
    expect(await isRedisReady()).toBe(true);
    await closeKV();
    expect(await isRedisReady()).toBe(false);
  });
});
