import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { getEnv } from "../../config/env.js";
import { childLogger } from "../../lib/logger.js";
import type { KV, SetOptions } from "./kv.js";
import { MemoryStore } from "./memoryStore.js";

const log = childLogger("redis");

const CONNECT_TIMEOUT_MS = 10_000;
const PING_TIMEOUT_MS = 2_000;

const RELEASE_LOCK_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/**
 * Token bucket atomico. Estado em hash (tokens + ts em ms). O relogio e o do
 * proprio Redis (TIME), entao processos com relogios diferentes concordam.
 * ARGV: 1 = ratePerMin, 2 = burst. Retorna 0 (token consumido) ou ms de espera.
 */
const TAKE_TOKEN_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local rate = tonumber(ARGV[1]) / 60000
local burst = tonumber(ARGV[2])
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1])
local ts = tonumber(s[2])
if tokens == nil or ts == nil then
  tokens = burst
  ts = now
end
tokens = math.min(burst, tokens + math.max(0, now - ts) * rate)
local wait = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  wait = math.ceil((1 - tokens) / rate)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(burst / rate) + 1000)
return wait
`;

type MessageHandler = (message: string) => void;

export class RedisKV implements KV {
  readonly kind = "redis" as const;

  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly pendingSubscribe = new Map<string, Promise<void>>();

  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, opts: SetOptions = {}): Promise<boolean> {
    let result: "OK" | null;
    if (opts.nx && opts.px !== undefined) {
      result = await this.redis.set(key, value, "PX", opts.px, "NX");
    } else if (opts.nx) {
      result = await this.redis.set(key, value, "NX");
    } else if (opts.px !== undefined) {
      result = await this.redis.set(key, value, "PX", opts.px);
    } else {
      result = await this.redis.set(key, value);
    }
    return result === "OK";
  }

  del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return Promise.resolve(0);
    return this.redis.del(...keys);
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async pexpire(key: string, ms: number): Promise<boolean> {
    return (await this.redis.pexpire(key, ms)) === 1;
  }

  pttl(key: string): Promise<number> {
    return this.redis.pttl(key);
  }

  lpush(key: string, value: string): Promise<number> {
    return this.redis.lpush(key, value);
  }

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    await this.redis.ltrim(key, start, stop);
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.lrange(key, start, stop);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<() => Promise<void>> {
    const sub = await this.ensureSubscriber();
    // Wrapper proprio: a mesma funcao pode ser assinada duas vezes sem colisao.
    const wrapper: MessageHandler = (message) => {
      try {
        handler(message);
      } catch (err) {
        log.error({ err, channel }, "handler de pubsub lancou excecao");
      }
    };

    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(wrapper);

    let pending = this.pendingSubscribe.get(channel);
    if (!pending) {
      pending = sub.subscribe(channel).then(() => undefined);
      this.pendingSubscribe.set(channel, pending);
      pending.catch(() => undefined).finally(() => this.pendingSubscribe.delete(channel));
    }
    try {
      await pending;
    } catch (err) {
      set.delete(wrapper);
      if (set.size === 0) this.handlers.delete(channel);
      throw err;
    }

    return async () => {
      const current = this.handlers.get(channel);
      if (!current || !current.delete(wrapper)) return;
      if (current.size === 0) {
        this.handlers.delete(channel);
        await sub.unsubscribe(channel);
      }
    };
  }

  private async ensureSubscriber(): Promise<Redis> {
    if (this.subscriber) return this.subscriber;
    // Conexao separada: em modo subscriber o Redis nao aceita outros comandos.
    const sub = this.redis.duplicate();
    sub.on("error", (err: Error) => log.warn({ err }, "erro na conexao subscriber do Redis"));
    sub.on("message", (channel: string, message: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      for (const h of [...set]) h(message);
    });
    this.subscriber = sub;
    try {
      await sub.connect();
    } catch (err) {
      this.subscriber = null;
      sub.disconnect();
      throw err;
    }
    return sub;
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const result = await this.redis.eval(RELEASE_LOCK_LUA, 1, key, token);
    return Number(result) === 1;
  }

  async takeToken(bucket: string, ratePerMin: number, burst: number): Promise<number> {
    if (!(ratePerMin > 0) || !(burst >= 1)) {
      throw new RangeError("takeToken exige ratePerMin > 0 e burst >= 1");
    }
    const result = await this.redis.eval(
      TAKE_TOKEN_LUA,
      1,
      bucket,
      String(ratePerMin),
      String(burst)
    );
    return Number(result);
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await withTimeout(this.redis.ping(), PING_TIMEOUT_MS, "ping do Redis");
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async quit(): Promise<void> {
    const conns = [this.subscriber, this.redis].filter((c): c is Redis => c !== null);
    this.subscriber = null;
    this.handlers.clear();
    await Promise.all(
      conns.map(async (c) => {
        try {
          await c.quit();
        } catch {
          c.disconnect();
        }
      })
    );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout (${ms}ms) em ${what}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

/** Cria e conecta um RedisKV. Lanca se nao conectar dentro do prazo. */
export async function createRedisKV(url: string): Promise<RedisKV> {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    connectTimeout: CONNECT_TIMEOUT_MS,
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  });
  redis.on("error", (err: Error) => log.warn({ err }, "erro na conexao do Redis"));
  redis.on("reconnecting", (delay: number) => log.warn({ delay }, "reconectando ao Redis"));
  redis.on("ready", () => log.info("Redis pronto"));

  try {
    await withTimeout(redis.connect(), CONNECT_TIMEOUT_MS + 1_000, "conexao com o Redis");
  } catch (err) {
    redis.disconnect();
    throw err;
  }
  return new RedisKV(redis);
}

let instance: Promise<KV> | null = null;
let resolved: KV | null = null;

/**
 * Cria o KV conforme o ambiente:
 * - REDIS_URL definida: Redis real.
 * - ausente em development/test: MemoryStore (com aviso).
 * - ausente em production: erro (sem fallback silencioso).
 */
export async function createKV(): Promise<KV> {
  const env = getEnv();
  if (env.REDIS_URL) return createRedisKV(env.REDIS_URL);

  if (env.NODE_ENV === "production") {
    throw new Error("REDIS_URL e obrigatoria em production (sem fallback em memoria)");
  }
  log.warn(
    { nodeEnv: env.NODE_ENV },
    "REDIS_URL ausente: usando MemoryStore (somente dev/teste, nao compartilhado entre processos)"
  );
  return new MemoryStore();
}

/** Singleton do KV. Falhas de criacao nao ficam em cache. */
export function getKV(): Promise<KV> {
  if (!instance) {
    instance = createKV().then(
      (kv) => {
        resolved = kv;
        return kv;
      },
      (err: unknown) => {
        instance = null;
        throw err;
      }
    );
  }
  return instance;
}

/** Encerra o singleton (shutdown gracioso / testes). */
export async function closeKV(): Promise<void> {
  const pending = instance;
  instance = null;
  resolved = null;
  if (!pending) return;
  try {
    const kv = await pending;
    await kv.quit();
  } catch {
    // criacao ja havia falhado; nada a encerrar
  }
}

/** Para o /readyz: true se o singleton existe e responde ao ping. */
export async function isRedisReady(): Promise<boolean> {
  if (!resolved) return false;
  return resolved.ping();
}
