import { describe, expect, it } from "vitest";
import { runKvContract } from "../../unit/redis/kvContract.js";

// Capturado ANTES de qualquer import de src/ (que carrega dotenv e poderia
// preencher REDIS_URL a partir do .env local, mesmo sem Redis disponivel).
const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisKV (Redis real)", () => {
  runKvContract("RedisKV", async () => {
    const { createRedisKV } = await import("../../../src/infra/redis/client.js");
    return createRedisKV(REDIS_URL!);
  });

  it("takeToken e atomico entre duas conexoes independentes", async () => {
    const { createRedisKV } = await import("../../../src/infra/redis/client.js");
    const a = await createRedisKV(REDIS_URL!);
    const b = await createRedisKV(REDIS_URL!);
    const bucket = `test:bucket:${Date.now()}:${Math.random()}`;
    try {
      const waits = await Promise.all(
        Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? a : b).takeToken(bucket, 1, 7))
      );
      expect(waits.filter((w) => w === 0)).toHaveLength(7);
    } finally {
      await a.del(bucket);
      await a.quit();
      await b.quit();
    }
  });

  it("pubsub atravessa conexoes distintas", async () => {
    const { createRedisKV } = await import("../../../src/infra/redis/client.js");
    const pub = await createRedisKV(REDIS_URL!);
    const sub = await createRedisKV(REDIS_URL!);
    const channel = `test:chan:${Date.now()}:${Math.random()}`;
    const received: string[] = [];
    try {
      const off = await sub.subscribe(channel, (m) => received.push(m));
      await pub.publish(channel, "ola");
      await expect.poll(() => received, { timeout: 2_000 }).toEqual(["ola"]);
      await off();
    } finally {
      await pub.quit();
      await sub.quit();
    }
  });
});
