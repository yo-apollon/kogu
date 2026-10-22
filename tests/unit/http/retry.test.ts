import { describe, expect, it, vi } from "vitest";
import {
  HttpStatusError,
  computeDelayMs,
  defaultShouldRetry,
  getRetryAfterMs,
  isRetryableStatus,
  parseRetryAfter,
  withRetry,
} from "../../../src/lib/http/retry.js";
import { SafeFetchError } from "../../../src/lib/http/safeFetch.js";

const noSleep = () => {
  const calls: number[] = [];
  return { calls, sleep: async (ms: number) => void calls.push(ms) };
};

describe("parseRetryAfter", () => {
  it("segundos", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter(" 1.5 ")).toBe(1500);
    expect(parseRetryAfter("0")).toBe(0);
  });
  it("data HTTP", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter(new Date(now + 12_000).toUTCString(), now)).toBe(12_000);
    expect(parseRetryAfter(new Date(now - 5_000).toUTCString(), now)).toBe(0);
  });
  it("invalido ou ausente", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("amanha")).toBeUndefined();
  });
});

describe("getRetryAfterMs", () => {
  it("le retryAfterMs, headers e response.headers", () => {
    expect(getRetryAfterMs(new HttpStatusError(429, "x", { retryAfterMs: 900 }))).toBe(900);
    expect(getRetryAfterMs({ headers: new Headers({ "retry-after": "3" }) })).toBe(3000);
    expect(getRetryAfterMs({ response: { headers: { "retry-after": "4" } } })).toBe(4000);
    expect(getRetryAfterMs(new Error("x"))).toBeUndefined();
    expect(getRetryAfterMs(null)).toBeUndefined();
  });
});

describe("isRetryableStatus / defaultShouldRetry", () => {
  it("429, 408 e 5xx sim; outros 4xx nao", () => {
    for (const s of [408, 429, 500, 502, 503, 599]) expect(isRetryableStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 410, 422]) expect(isRetryableStatus(s)).toBe(false);
  });
  it("SafeFetchError", () => {
    expect(defaultShouldRetry(new SafeFetchError("TIMEOUT", "t"))).toBe(true);
    expect(defaultShouldRetry(new SafeFetchError("HTTP_ERROR", "net"))).toBe(true);
    expect(defaultShouldRetry(new SafeFetchError("HTTP_ERROR", "x", { status: 503 }))).toBe(true);
    expect(defaultShouldRetry(new SafeFetchError("HTTP_ERROR", "x", { status: 404 }))).toBe(false);
    expect(defaultShouldRetry(new SafeFetchError("BLOCKED_IP", "x"))).toBe(false);
    expect(defaultShouldRetry(new SafeFetchError("TOO_LARGE", "x"))).toBe(false);
  });
});

describe("computeDelayMs", () => {
  it("backoff exponencial limitado por maxMs, sem jitter", () => {
    const o = { baseMs: 1000, maxMs: 10_000, jitter: false };
    expect([0, 1, 2, 3, 4, 5].map((a) => computeDelayMs(a, new Error("x"), o))).toEqual([
      1000, 2000, 4000, 8000, 10_000, 10_000,
    ]);
  });
  it("jitter fica entre 50% e 100% do backoff", () => {
    const o = { baseMs: 1000, maxMs: 60_000, jitter: true };
    expect(computeDelayMs(2, new Error("x"), { ...o, random: () => 0 })).toBe(2000);
    expect(computeDelayMs(2, new Error("x"), { ...o, random: () => 1 })).toBe(4000);
  });
  it("Retry-After maior que o backoff prevalece, inclusive acima de maxMs", () => {
    const o = { baseMs: 1000, maxMs: 5000, jitter: false };
    expect(computeDelayMs(0, new HttpStatusError(429, "x", { retryAfterMs: 20_000 }), o)).toBe(20_000);
    expect(computeDelayMs(3, new HttpStatusError(429, "x", { retryAfterMs: 100 }), o)).toBe(5000);
  });
});

describe("withRetry", () => {
  it("retorna sem retentar quando da certo", async () => {
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respeita Retry-After em 429 e depois conclui", async () => {
    const { calls, sleep } = noSleep();
    const fn = vi
      .fn<(a: number) => Promise<string>>()
      .mockRejectedValueOnce(new HttpStatusError(429, "slow", { retryAfterMs: 7000 }))
      .mockResolvedValueOnce("ok");
    const r = await withRetry(fn, { sleep, jitter: false, baseMs: 1000 });
    expect(r).toBe("ok");
    expect(calls).toEqual([7000]);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("le Retry-After de headers de erro generico (data HTTP)", async () => {
    const { calls, sleep } = noSleep();
    const now = Date.UTC(2026, 0, 1);
    const err = Object.assign(new Error("429"), {
      status: 429,
      headers: new Headers({ "retry-after": new Date(now + 9000).toUTCString() }),
    });
    const fn = vi.fn<(a: number) => Promise<string>>().mockRejectedValueOnce(err).mockResolvedValueOnce("ok");
    await withRetry(fn, { sleep, jitter: false, now: () => now });
    expect(calls).toEqual([9000]);
  });

  it("para imediatamente em 4xx (exceto 408/429)", async () => {
    const { calls, sleep } = noSleep();
    const fn = vi.fn(async () => {
      throw new HttpStatusError(404);
    });
    await expect(withRetry(fn, { sleep })).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it("retenta 5xx ate esgotar `retries` e propaga o ultimo erro", async () => {
    const { calls, sleep } = noSleep();
    const fn = vi.fn(async () => {
      throw new HttpStatusError(503);
    });
    await expect(withRetry(fn, { sleep, jitter: false, retries: 3, baseMs: 100, maxMs: 1000 })).rejects.toMatchObject({
      status: 503,
    });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(calls).toEqual([100, 200, 400]);
  });

  it("padrao: 5 retentativas, base 1000, max 60000", async () => {
    const { calls, sleep } = noSleep();
    const fn = vi.fn(async () => {
      throw new HttpStatusError(500);
    });
    await expect(withRetry(fn, { sleep, jitter: false })).rejects.toBeInstanceOf(HttpStatusError);
    expect(fn).toHaveBeenCalledTimes(6);
    expect(calls).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("shouldRetry customizado e onRetry", async () => {
    const { sleep } = noSleep();
    const onRetry = vi.fn();
    const fn = vi.fn<(a: number) => Promise<string>>().mockRejectedValueOnce(new Error("flaky")).mockResolvedValueOnce("ok");
    const r = await withRetry(fn, { sleep, jitter: false, shouldRetry: (e) => (e as Error).message === "flaky", onRetry });
    expect(r).toBe("ok");
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 1000);

    const fn2 = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(withRetry(fn2, { sleep, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("fn recebe o indice da tentativa", async () => {
    const { sleep } = noSleep();
    const seen: number[] = [];
    await withRetry(
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 2) throw new HttpStatusError(500);
      },
      { sleep },
    );
    expect(seen).toEqual([0, 1, 2]);
  });
});
