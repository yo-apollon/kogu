import type { KV } from "./kv.js";

/** Chamadas concorrentes (neste processo) para a mesma chave compartilham um unico loader. */
const inflight = new Map<string, Promise<unknown>>();

export function cacheKey(...parts: Array<string | number>): string {
  return ["cache", ...parts].join(":");
}

/**
 * Le do cache (JSON) ou carrega, grava com TTL e retorna.
 * - Valor corrompido no cache e tratado como miss.
 * - `undefined` nao e armazenado (nao tem representacao em JSON); `null` e.
 */
export async function cacheGetOrSet<T>(
  kv: KV,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const raw = await kv.get(key);
  if (raw !== null) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // cai para o loader
    }
  }

  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const promise = (async () => {
    const value = await loader();
    const json = JSON.stringify(value);
    if (json !== undefined) await kv.set(key, json, { px: ttlMs });
    return value;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/** Invalida uma ou mais chaves de cache. Retorna quantas existiam. */
export function cacheInvalidate(kv: KV, ...keys: string[]): Promise<number> {
  return kv.del(...keys);
}
