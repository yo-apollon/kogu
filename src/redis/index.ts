// Gerenciador de cache e locks em memória com fallback nativo (quando Redis externo não estiver rodando)
class MemoryStore {
  private store = new Map<string, { value: any; expiresAt?: number }>();

  async atomicPactLock(key: string, userId: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && (!existing.expiresAt || existing.expiresAt > now)) {
      return 0; // Já bloqueado
    }
    this.store.set(key, { value: userId, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }

  async atomicOrbClaim(key: string, userId: string, ttlSeconds: number): Promise<number> {
    return this.atomicPactLock(key, userId, ttlSeconds);
  }

  async consumeRoll(key: string, resetIntervalSeconds: number, defaultRolls: number): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || (existing.expiresAt && existing.expiresAt <= now)) {
      this.store.set(key, { value: defaultRolls - 1, expiresAt: now + resetIntervalSeconds * 1000 });
      return defaultRolls - 1;
    }
    if (existing.value <= 0) return -1;
    existing.value -= 1;
    return existing.value;
  }

  async connect() {}
}

export const redis = new MemoryStore() as any;
export async function initRedisScripts() {}
