import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../../src/lib/http/rateLimiter.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimiter local (fake timers)", () => {
  it("consome o burst sem esperar e depois espera o refill", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rl = createRateLimiter({ bucket: "t", ratePerMin: 60, burst: 2 }); // 1 token/s

    await rl.acquire();
    await rl.acquire();

    let third = false;
    const p = rl.acquire().then(() => {
      third = true;
    });
    await vi.advanceTimersByTimeAsync(900);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    await p;
    expect(third).toBe(true);
  });

  it("atende chamadas concorrentes em ordem e no ritmo configurado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rl = createRateLimiter({ bucket: "t", ratePerMin: 120, burst: 1 }); // 1 token a cada 500 ms
    const done: number[] = [];
    const ps = [0, 1, 2, 3].map((i) => rl.acquire().then(() => done.push(i)));

    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(ps);
    expect(done).toEqual([0, 1, 2, 3]);
  });

  it("tokens nao passam do burst apos longa ociosidade", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rl = createRateLimiter({ bucket: "t", ratePerMin: 60, burst: 2 });
    await rl.acquire();
    await rl.acquire();
    await vi.advanceTimersByTimeAsync(60_000);
    await rl.acquire();
    await rl.acquire();
    let third = false;
    void rl.acquire().then(() => (third = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(third).toBe(false);
  });

  it("aceita relogio e sleep injetados", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const rl = createRateLimiter({
      bucket: "t",
      ratePerMin: 60,
      burst: 1,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await rl.acquire();
    await rl.acquire();
    await rl.acquire();
    expect(sleeps).toEqual([1000, 1000]);
  });

  it("valida parametros", () => {
    expect(() => createRateLimiter({ bucket: "t", ratePerMin: 0, burst: 1 })).toThrow(RangeError);
    expect(() => createRateLimiter({ bucket: "t", ratePerMin: 10, burst: 0 })).toThrow(RangeError);
  });
});

describe("rateLimiter com KV compartilhado", () => {
  it("usa kv.takeToken e espera o tempo devolvido", async () => {
    const takeToken = vi
      .fn<(bucket: string, rate: number, burst: number) => Promise<number>>()
      .mockResolvedValueOnce(300)
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(0);
    const sleeps: number[] = [];
    const rl = createRateLimiter({
      kv: { takeToken },
      bucket: "anilist",
      ratePerMin: 25,
      burst: 5,
      sleep: async (ms) => void sleeps.push(ms),
    });
    await rl.acquire();
    expect(takeToken).toHaveBeenCalledTimes(3);
    expect(takeToken).toHaveBeenCalledWith("anilist", 25, 5);
    expect(sleeps).toEqual([300, 120]);
  });

  it("retorna sem dormir quando ha token", async () => {
    const takeToken = vi.fn(async () => 0);
    const sleep = vi.fn(async () => {});
    await createRateLimiter({ kv: { takeToken }, bucket: "b", ratePerMin: 60, burst: 1, sleep }).acquire();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("propaga erro do KV", async () => {
    const takeToken = vi.fn(async () => {
      throw new Error("redis down");
    });
    await expect(createRateLimiter({ kv: { takeToken }, bucket: "b", ratePerMin: 60, burst: 1 }).acquire()).rejects.toThrow(
      "redis down",
    );
  });
});
