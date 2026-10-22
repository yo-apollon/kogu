import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { KV, SetOptions } from "./kv.js";

interface BucketState {
  tokens: number;
  ts: number;
}

type StoredValue = string | string[] | BucketState;

interface Entry {
  value: StoredValue;
  /** Epoch ms de expiracao, ou null quando sem TTL. */
  expiresAt: number | null;
}

interface TypedEntry<V extends StoredValue> {
  value: V;
  expiresAt: number | null;
}

const SWEEP_INTERVAL_MS = 60_000;

function assertPx(px: number): void {
  if (!Number.isInteger(px) || px <= 0) {
    throw new RangeError("ERR invalid expire time (px deve ser inteiro positivo)");
  }
}

/** Normaliza indices estilo Redis (negativos contam do fim). Retorna null para intervalo vazio. */
function normalizeRange(len: number, start: number, stop: number): [number, number] | null {
  let s = start < 0 ? Math.max(len + start, 0) : start;
  let e = stop < 0 ? len + stop : stop;
  e = Math.min(e, len - 1);
  if (s < 0) s = 0;
  if (len === 0 || s > e) return null;
  return [s, e];
}

/**
 * Implementacao em memoria do contrato KV. Somente para desenvolvimento e testes:
 * nao e compartilhada entre processos.
 */
export class MemoryStore implements KV {
  readonly kind = "memory" as const;

  private readonly data = new Map<string, Entry>();
  private readonly bus = new EventEmitter();
  private sweeper: NodeJS.Timeout | null;

  constructor() {
    this.bus.setMaxListeners(0);
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.data) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) this.data.delete(key);
    }
  }

  /** Expiracao preguicosa: remove a chave se vencida e devolve a entrada viva. */
  private live(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  private stringEntry(key: string): TypedEntry<string> | undefined {
    const entry = this.live(key);
    if (!entry) return undefined;
    if (typeof entry.value !== "string") {
      throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    }
    return entry as TypedEntry<string>;
  }

  private listEntry(key: string): TypedEntry<string[]> | undefined {
    const entry = this.live(key);
    if (!entry) return undefined;
    if (!Array.isArray(entry.value)) {
      throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    }
    return entry as TypedEntry<string[]>;
  }

  async get(key: string): Promise<string | null> {
    return this.stringEntry(key)?.value ?? null;
  }

  async set(key: string, value: string, opts: SetOptions = {}): Promise<boolean> {
    if (opts.px !== undefined) assertPx(opts.px);
    if (opts.nx && this.live(key)) return false;
    this.data.set(key, {
      value,
      expiresAt: opts.px !== undefined ? Date.now() + opts.px : null,
    });
    return true;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.live(key)) {
        this.data.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async incr(key: string): Promise<number> {
    const entry = this.stringEntry(key);
    if (!entry) {
      this.data.set(key, { value: "1", expiresAt: null });
      return 1;
    }
    if (!/^-?\d+$/.test(entry.value)) {
      throw new Error("ERR value is not an integer or out of range");
    }
    const next = Number(entry.value) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry.expiresAt });
    return next;
  }

  async pexpire(key: string, ms: number): Promise<boolean> {
    const entry = this.live(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ms;
    return true;
  }

  async pttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(entry.expiresAt - Date.now(), 0);
  }

  async lpush(key: string, value: string): Promise<number> {
    const entry = this.listEntry(key);
    if (!entry) {
      this.data.set(key, { value: [value], expiresAt: null });
      return 1;
    }
    entry.value.unshift(value);
    return entry.value.length;
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const entry = this.listEntry(key);
    if (!entry) return;
    const range = normalizeRange(entry.value.length, start, stop);
    if (!range) {
      this.data.delete(key);
      return;
    }
    this.data.set(key, {
      value: entry.value.slice(range[0], range[1] + 1),
      expiresAt: entry.expiresAt,
    });
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    const entry = this.listEntry(key);
    if (!entry) return [];
    const range = normalizeRange(entry.value.length, start, stop);
    if (!range) return [];
    return entry.value.slice(range[0], range[1] + 1);
  }

  async publish(channel: string, message: string): Promise<void> {
    // Entrega assincrona, como no Redis: o publicador nunca roda o handler na propria pilha.
    queueMicrotask(() => {
      this.bus.emit(channel, message);
    });
  }

  async subscribe(
    channel: string,
    handler: (message: string) => void
  ): Promise<() => Promise<void>> {
    const wrapper = (message: string): void => {
      try {
        handler(message);
      } catch {
        // Falha em um handler nao pode derrubar os demais assinantes.
      }
    };
    this.bus.on(channel, wrapper);
    return async () => {
      this.bus.off(channel, wrapper);
    };
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.set(key, token, { px: ttlMs, nx: true });
    return ok ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const entry = this.live(key);
    if (!entry || entry.value !== token) return false;
    this.data.delete(key);
    return true;
  }

  async takeToken(bucket: string, ratePerMin: number, burst: number): Promise<number> {
    if (!(ratePerMin > 0) || !(burst >= 1)) {
      throw new RangeError("takeToken exige ratePerMin > 0 e burst >= 1");
    }
    const now = Date.now();
    const ratePerMs = ratePerMin / 60_000;
    const ttl = Math.ceil(burst / ratePerMs) + 1000;

    const existing = this.live(bucket);
    let state: BucketState;
    if (existing && typeof existing.value === "object" && !Array.isArray(existing.value)) {
      state = existing.value;
      state.tokens = Math.min(burst, state.tokens + Math.max(0, now - state.ts) * ratePerMs);
      state.ts = now;
    } else {
      state = { tokens: burst, ts: now };
    }

    let wait = 0;
    if (state.tokens >= 1) {
      state.tokens -= 1;
    } else {
      wait = Math.ceil((1 - state.tokens) / ratePerMs);
    }
    this.data.set(bucket, { value: state, expiresAt: now + ttl });
    return wait;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async quit(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    this.bus.removeAllListeners();
    this.data.clear();
  }
}
