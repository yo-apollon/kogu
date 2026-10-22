import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KV } from "../../../src/infra/redis/kv.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Suite de contrato do KV. Roda contra MemoryStore (unit) e RedisKV real
 * (integration), garantindo que ambos se comportem igual.
 */
export function runKvContract(name: string, factory: () => Promise<KV>): void {
  describe(`contrato KV: ${name}`, () => {
    let kv: KV;
    const ns = `test:${randomUUID()}`;
    const k = (suffix: string) => `${ns}:${suffix}`;

    beforeAll(async () => {
      kv = await factory();
    });

    afterAll(async () => {
      await kv.quit();
    });

    it("ping responde true", async () => {
      expect(await kv.ping()).toBe(true);
    });

    it("set/get/del basicos", async () => {
      expect(await kv.get(k("a"))).toBeNull();
      expect(await kv.set(k("a"), "1")).toBe(true);
      expect(await kv.get(k("a"))).toBe("1");
      expect(await kv.del(k("a"), k("nao-existe"))).toBe(1);
      expect(await kv.get(k("a"))).toBeNull();
    });

    it("nx so grava se a chave nao existe", async () => {
      expect(await kv.set(k("nx"), "primeiro", { nx: true })).toBe(true);
      expect(await kv.set(k("nx"), "segundo", { nx: true })).toBe(false);
      expect(await kv.get(k("nx"))).toBe("primeiro");
    });

    it("px expira a chave e pttl reflete o estado", async () => {
      expect(await kv.pttl(k("ttl"))).toBe(-2);
      await kv.set(k("ttl"), "v", { px: 150 });
      const ttl = await kv.pttl(k("ttl"));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(150);
      await sleep(250);
      expect(await kv.get(k("ttl"))).toBeNull();
      expect(await kv.pttl(k("ttl"))).toBe(-2);

      await kv.set(k("sem-ttl"), "v");
      expect(await kv.pttl(k("sem-ttl"))).toBe(-1);
    });

    it("pexpire aplica TTL a chave existente e falha na inexistente", async () => {
      expect(await kv.pexpire(k("pe"), 1000)).toBe(false);
      await kv.set(k("pe"), "v");
      expect(await kv.pexpire(k("pe"), 120)).toBe(true);
      expect(await kv.pttl(k("pe"))).toBeGreaterThan(0);
      await sleep(220);
      expect(await kv.get(k("pe"))).toBeNull();
    });

    it("nx so passa depois que a chave expira", async () => {
      expect(await kv.set(k("nxttl"), "a", { nx: true, px: 100 })).toBe(true);
      expect(await kv.set(k("nxttl"), "b", { nx: true, px: 100 })).toBe(false);
      await sleep(200);
      expect(await kv.set(k("nxttl"), "c", { nx: true, px: 100 })).toBe(true);
      expect(await kv.get(k("nxttl"))).toBe("c");
    });

    it("incr cria em 1 e incrementa", async () => {
      expect(await kv.incr(k("n"))).toBe(1);
      expect(await kv.incr(k("n"))).toBe(2);
      expect(await kv.get(k("n"))).toBe("2");
    });

    it("listas: lpush, lrange e ltrim", async () => {
      expect(await kv.lpush(k("l"), "a")).toBe(1);
      expect(await kv.lpush(k("l"), "b")).toBe(2);
      expect(await kv.lpush(k("l"), "c")).toBe(3);
      expect(await kv.lrange(k("l"), 0, -1)).toEqual(["c", "b", "a"]);
      expect(await kv.lrange(k("l"), 1, 1)).toEqual(["b"]);
      await kv.ltrim(k("l"), 0, 1);
      expect(await kv.lrange(k("l"), 0, -1)).toEqual(["c", "b"]);
      expect(await kv.lrange(k("vazia"), 0, -1)).toEqual([]);
    });

    it("50 acquireLock concorrentes: exatamente 1 token", async () => {
      const results = await Promise.all(
        Array.from({ length: 50 }, () => kv.acquireLock(k("lock"), 5_000))
      );
      const tokens = results.filter((t): t is string => t !== null);
      expect(tokens).toHaveLength(1);
      expect(await kv.releaseLock(k("lock"), tokens[0]!)).toBe(true);
    });

    it("releaseLock com token errado nao libera", async () => {
      const token = await kv.acquireLock(k("lock2"), 5_000);
      expect(token).not.toBeNull();
      expect(await kv.releaseLock(k("lock2"), "token-errado")).toBe(false);
      expect(await kv.acquireLock(k("lock2"), 5_000)).toBeNull();
      expect(await kv.releaseLock(k("lock2"), token!)).toBe(true);
      expect(await kv.releaseLock(k("lock2"), token!)).toBe(false);
      expect(await kv.acquireLock(k("lock2"), 5_000)).not.toBeNull();
    });

    it("lock expira pelo TTL e token antigo nao libera o novo dono", async () => {
      const old = await kv.acquireLock(k("lock3"), 100);
      expect(old).not.toBeNull();
      await sleep(200);
      const fresh = await kv.acquireLock(k("lock3"), 5_000);
      expect(fresh).not.toBeNull();
      expect(await kv.releaseLock(k("lock3"), old!)).toBe(false);
      expect(await kv.releaseLock(k("lock3"), fresh!)).toBe(true);
    });

    it("takeToken: consome o burst e depois devolve espera", async () => {
      // 60/min = 1 token/s, burst 3.
      const bucket = k("bucket1");
      expect(await kv.takeToken(bucket, 60, 3)).toBe(0);
      expect(await kv.takeToken(bucket, 60, 3)).toBe(0);
      expect(await kv.takeToken(bucket, 60, 3)).toBe(0);
      const wait = await kv.takeToken(bucket, 60, 3);
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(1000);
    });

    it("takeToken: reabastece com o tempo", async () => {
      // 6000/min = 100 tokens/s (1 token a cada 10ms), burst 1.
      const bucket = k("bucket2");
      expect(await kv.takeToken(bucket, 6000, 1)).toBe(0);
      expect(await kv.takeToken(bucket, 6000, 1)).toBeGreaterThan(0);
      await sleep(120);
      expect(await kv.takeToken(bucket, 6000, 1)).toBe(0);
    });

    it("takeToken: concorrencia respeita o burst", async () => {
      const waits = await Promise.all(
        Array.from({ length: 20 }, () => kv.takeToken(k("bucket3"), 1, 5))
      );
      expect(waits.filter((w) => w === 0)).toHaveLength(5);
    });

    it("pubsub entrega a mensagem e para apos cancelar", async () => {
      const received: string[] = [];
      const unsubscribe = await kv.subscribe(k("chan"), (m) => received.push(m));
      await kv.publish(k("chan"), "um");
      await kv.publish(k("chan"), "dois");
      await waitFor(() => received.length === 2);
      expect(received).toEqual(["um", "dois"]);

      await unsubscribe();
      await kv.publish(k("chan"), "tres");
      await sleep(100);
      expect(received).toEqual(["um", "dois"]);
    });

    it("pubsub entrega a varios assinantes do mesmo canal", async () => {
      const a: string[] = [];
      const b: string[] = [];
      const ua = await kv.subscribe(k("chan2"), (m) => a.push(m));
      const ub = await kv.subscribe(k("chan2"), (m) => b.push(m));
      await kv.publish(k("chan2"), "x");
      await waitFor(() => a.length === 1 && b.length === 1);
      await ua();
      await ub();
    });
  });
}

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: tempo esgotado");
    await sleep(10);
  }
}
