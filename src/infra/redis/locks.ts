import type { KV } from "./kv.js";

export type TryLockResult =
  { acquired: true; token: string; release: () => Promise<boolean> } | { acquired: false };

export type WithLockResult<T> = { acquired: true; result: T } | { acquired: false };

/** Tenta adquirir o lock. Se obtido, `release` libera somente se ainda formos o dono. */
export async function tryLock(kv: KV, key: string, ttlMs: number): Promise<TryLockResult> {
  const token = await kv.acquireLock(key, ttlMs);
  if (token === null) return { acquired: false };
  return { acquired: true, token, release: () => kv.releaseLock(key, token) };
}

/**
 * Executa `fn` sob lock. Retorna `{ acquired: false }` se o lock estiver ocupado.
 * O lock e liberado no `finally`, mesmo se `fn` lancar.
 */
export async function withLock<T>(
  kv: KV,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<WithLockResult<T>> {
  const lock = await tryLock(kv, key, ttlMs);
  if (!lock.acquired) return { acquired: false };
  try {
    return { acquired: true, result: await fn() };
  } finally {
    await lock.release();
  }
}
