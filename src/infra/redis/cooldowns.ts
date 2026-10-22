import type { KV } from "./kv.js";

export type CooldownResult = { ok: true } | { ok: false; retryAfterMs: number };

export function cooldownKey(userId: string, command: string): string {
  return `cooldown:${command}:${userId}`;
}

/**
 * Registra o uso do comando e inicia o cooldown. Atomico via SET NX PX:
 * so um uso concorrente passa; os demais recebem o tempo restante.
 */
export async function checkCooldown(
  kv: KV,
  userId: string,
  command: string,
  ms: number
): Promise<CooldownResult> {
  const key = cooldownKey(userId, command);
  const set = await kv.set(key, "1", { px: ms, nx: true });
  if (set) return { ok: true };
  const ttl = await kv.pttl(key);
  return { ok: false, retryAfterMs: Math.max(ttl, 0) };
}
