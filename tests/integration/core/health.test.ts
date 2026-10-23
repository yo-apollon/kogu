import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import {
  startHealthServer,
  type HealthDeps,
  type HealthServer,
} from "../../../src/infra/health/server.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

let server: HealthServer | null = null;

async function start(overrides: Partial<HealthDeps> = {}) {
  const kv = new MemoryStore();
  const deps: HealthDeps = {
    isDiscordReady: () => true,
    checkDb: async () => [{ "?column?": 1 }],
    pingKv: () => kv.ping(),
    ...overrides,
  };
  server = await startHealthServer(deps, { port: await freePort(), host: "127.0.0.1" });
  if (!server) throw new Error("servidor nao subiu");
  const base = `http://127.0.0.1:${server.port}`;
  const get = async (path: string) => {
    const res = await fetch(base + path);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { get, kv };
}

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("health server", () => {
  it("/healthz responde 200 enquanto o processo vive", async () => {
    const { get } = await start({ isDiscordReady: () => false });
    expect(await get("/healthz")).toEqual({ status: 200, body: { status: "ok" } });
  });

  it("/readyz 200 quando Discord, Postgres e KV estao ok", async () => {
    const { get } = await start();
    const res = await get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ready",
      checks: { discord: "ok", postgres: "ok", redis: "ok" },
    });
  });

  it("/readyz 503 quando o Discord nao esta READY", async () => {
    const { get } = await start({ isDiscordReady: () => false });
    const res = await get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ discord: "fail", postgres: "ok", redis: "ok" });
  });

  it("/readyz 503 quando o Postgres falha, sem vazar o erro", async () => {
    const { get } = await start({
      checkDb: async () => {
        throw new Error("password authentication failed for user arqon");
      },
    });
    const res = await get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks.postgres).toBe("fail");
    expect(JSON.stringify(res.body)).not.toContain("password");
  });

  it("/readyz 503 quando o KV nao responde ao PING (false ou excecao)", async () => {
    const down = await start({ pingKv: async () => false });
    expect((await down.get("/readyz")).body.checks.redis).toBe("fail");
    await server?.close();

    const throws = await start({
      pingKv: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const res = await throws.get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks.redis).toBe("fail");
  });

  it("/readyz 503 durante o shutdown, mesmo com tudo ok", async () => {
    let shuttingDown = false;
    const { get } = await start({ isShuttingDown: () => shuttingDown });
    expect((await get("/readyz")).status).toBe(200);
    shuttingDown = true;
    const res = await get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("shutting_down");
  });

  it("rota desconhecida 404; metodo nao permitido 405", async () => {
    const { get } = await start();
    expect((await get("/nada")).status).toBe(404);
    const res = await fetch(`http://127.0.0.1:${server!.port}/healthz`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("porta 0 desliga o servidor", async () => {
    const deps: HealthDeps = {
      isDiscordReady: () => true,
      checkDb: async () => undefined,
      pingKv: async () => true,
    };
    await expect(startHealthServer(deps, { port: 0 })).resolves.toBeNull();
  });
});
