import { describe, expect, it, vi } from "vitest";
import {
  DiscordRateLimitedError,
  DiscordUnauthorizedError,
  getFreshUserGuilds,
  getUserGuilds,
  permsOf,
} from "@/server/discord";

const guild = (over: Record<string, unknown> = {}) => ({
  id: "111111111111111111",
  name: "G",
  icon: null,
  owner: false,
  permissions: "0",
  ...over,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("permsOf", () => {
  const cases: Array<[string, { owner: boolean; permissions: bigint }, boolean, boolean]> = [
    ["nenhum", { owner: false, permissions: 0n }, false, false],
    ["manage guild 0x20", { owner: false, permissions: 0x20n }, false, true],
    ["administrator 0x8", { owner: false, permissions: 0x8n }, true, true],
    ["dono sem bits", { owner: true, permissions: 0n }, true, true],
    ["outros bits", { owner: false, permissions: 0x10n | 0x4n }, false, false],
    ["bit alto 64 bits + 0x20", { owner: false, permissions: (1n << 62n) | 0x20n }, false, true],
  ];
  it.each(cases)("%s", (_n, g, isAdmin, canManage) => {
    expect(permsOf(g)).toEqual({ isAdmin, canManage });
  });
});

describe("getUserGuilds", () => {
  it("parseia permissoes como BigInt e cacheia 60 s por userId", async () => {
    const cache = new Map();
    let t = 1_000;
    const f = vi.fn(async () => json([guild({ permissions: "9223372036854775807" })]));
    const deps = { fetch: f as unknown as typeof fetch, now: () => t, cache };
    const a = await getUserGuilds("u1", "tok", deps);
    expect(a[0]?.permissions).toBe(9223372036854775807n);
    await getUserGuilds("u1", "tok", deps);
    expect(f).toHaveBeenCalledTimes(1);
    t += 59_000;
    await getUserGuilds("u1", "tok", deps);
    expect(f).toHaveBeenCalledTimes(1);
    t += 2_000;
    await getUserGuilds("u1", "tok", deps);
    expect(f).toHaveBeenCalledTimes(2);
    expect([...cache.keys()].join()).not.toContain("tok");
  });

  it("envia Bearer e nao mistura usuarios", async () => {
    const f = vi.fn(async (...args: [string, RequestInit?]) => (args.length ? json([guild()]) : json([])));
    const deps = { fetch: f as unknown as typeof fetch, cache: new Map() };
    await getUserGuilds("u1", "tokA", deps);
    await getUserGuilds("u2", "tokB", deps);
    expect(f).toHaveBeenCalledTimes(2);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tokA");
  });

  it("fresh ignora o cache", async () => {
    const f = vi.fn(async () => json([guild()]));
    const deps = { fetch: f as unknown as typeof fetch, cache: new Map() };
    await getUserGuilds("u1", "t", deps);
    await getFreshUserGuilds("u1", "t", deps);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("429: espera retry_after e tenta de novo", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ retry_after: 0.5 }, 429))
      .mockResolvedValueOnce(json([guild()]));
    const r = await getUserGuilds("u1", "t", {
      fetch: f as unknown as typeof fetch,
      sleep,
      cache: new Map(),
    });
    expect(r).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("429 com retry_after longo lanca DiscordRateLimitedError sem esperar", async () => {
    const sleep = vi.fn(async () => {});
    const f = vi.fn(async () => json({ retry_after: 30 }, 429));
    await expect(
      getUserGuilds("u1", "t", { fetch: f as unknown as typeof fetch, sleep, cache: new Map() })
    ).rejects.toBeInstanceOf(DiscordRateLimitedError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("401 lanca DiscordUnauthorizedError e nao cacheia", async () => {
    const cache = new Map();
    const f = vi.fn(async () => json({ message: "401: Unauthorized" }, 401));
    await expect(
      getUserGuilds("u1", "t", { fetch: f as unknown as typeof fetch, cache })
    ).rejects.toBeInstanceOf(DiscordUnauthorizedError);
    expect(cache.size).toBe(0);
  });

  it("rejeita payload malformado", async () => {
    const f = vi.fn(async () => json([{ id: "x" }]));
    await expect(
      getUserGuilds("u1", "t", { fetch: f as unknown as typeof fetch, cache: new Map() })
    ).rejects.toThrow();
  });
});