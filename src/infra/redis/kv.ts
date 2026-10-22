/**
 * Contrato de armazenamento chave-valor. Implementado por Redis (producao)
 * e por MemoryStore (apenas desenvolvimento/testes).
 */
export interface SetOptions {
  /** Expira em N milissegundos. */
  px?: number;
  /** Somente define se a chave nao existir. */
  nx?: boolean;
}

export interface KV {
  readonly kind: "redis" | "memory";

  get(key: string): Promise<string | null>;
  /** Retorna true se gravou (sempre true sem `nx`). */
  set(key: string, value: string, opts?: SetOptions): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<boolean>;
  pttl(key: string): Promise<number>;

  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;

  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;

  /** Lock distribuido: retorna token de liberacao ou null se ocupado. */
  acquireLock(key: string, ttlMs: number): Promise<string | null>;
  /** Libera somente se o token ainda for o dono do lock. */
  releaseLock(key: string, token: string): Promise<boolean>;

  /**
   * Token bucket compartilhado entre processos.
   * Retorna 0 se ha token disponivel agora, ou os ms ate o proximo token.
   */
  takeToken(bucket: string, ratePerMin: number, burst: number): Promise<number>;

  ping(): Promise<boolean>;
  quit(): Promise<void>;
}
