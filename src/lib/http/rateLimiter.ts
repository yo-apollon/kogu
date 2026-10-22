import type { KV } from "../../infra/redis/kv.js";
import { sleep as defaultSleep } from "../time.js";

export interface RateLimiterOptions {
  /** Se informado, usa o token bucket compartilhado (Redis); senao, bucket local. */
  kv?: Pick<KV, "takeToken">;
  bucket: string;
  ratePerMin: number;
  burst: number;
  /** Relogio injetavel (ms epoch). */
  now?: () => number;
  /** Espera injetavel. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimiter {
  /** Aguarda ate haver um token e o consome. */
  acquire(): Promise<void>;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { kv, bucket, ratePerMin, burst } = opts;
  if (!(ratePerMin > 0)) throw new RangeError("ratePerMin must be > 0");
  if (!(burst >= 1)) throw new RangeError("burst must be >= 1");
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  if (kv) {
    return {
      async acquire() {
        for (;;) {
          const waitMs = await kv.takeToken(bucket, ratePerMin, burst);
          if (waitMs <= 0) return;
          await sleep(Math.ceil(waitMs));
        }
      },
    };
  }

  const refillPerMs = ratePerMin / 60_000;
  let tokens = burst;
  let last = now();
  // Fila FIFO: chamadas concorrentes sao atendidas na ordem.
  let tail: Promise<void> = Promise.resolve();

  const take = async (): Promise<void> => {
    for (;;) {
      const t = now();
      tokens = Math.min(burst, tokens + Math.max(0, t - last) * refillPerMs);
      last = t;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.max(1, Math.ceil((1 - tokens) / refillPerMs)));
    }
  };

  return {
    acquire() {
      const run = tail.then(take);
      tail = run.catch(() => {});
      return run;
    },
  };
}
