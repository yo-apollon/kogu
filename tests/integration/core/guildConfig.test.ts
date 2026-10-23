import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Lido antes de qualquer import de src/ (config/env.ts chama dotenv e preencheria DATABASE_URL do .env local).
const externalUrl = vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL?.trim();
  process.env.LOG_LEVEL = "silent";
  process.env.DEFAULT_PREFIX = "$";
  return url;
});

import {
  createGuildConfigService,
  guildConfigKey,
  mapGuildRow,
} from "../../../src/core/middleware/guildConfig.js";
import { runMigrations } from "../../../src/infra/db/migrate.js";
import * as schema from "../../../src/infra/db/schema/index.js";
import { startHealthServer } from "../../../src/infra/health/server.js";
import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";

let embedded: EmbeddedPostgres | undefined;
let dataDir: string | undefined;
let adminUrl: string;
let testDbName: string;
let testUrl: string;
let sql: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

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

function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

beforeAll(async () => {
  if (externalUrl) {
    adminUrl = externalUrl;
  } else {
    const port = await freePort();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-core-pg-"));
    embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "postgres",
      password: "arqon_test_pw",
      port,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    adminUrl = `postgres://postgres:arqon_test_pw@127.0.0.1:${port}/postgres`;
  }

  testDbName = `arqon_core_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  testUrl = withDatabase(adminUrl, testDbName);
  await runMigrations(testUrl);
  sql = postgres(testUrl, { max: 10, onnotice: () => {} });
  db = drizzle(sql, { schema });
}, 120_000);

afterAll(async () => {
  try {
    await sql?.end({ timeout: 5 });
  } catch {}
  if (testDbName) {
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${testDbName}" WITH (FORCE)`);
    } catch {}
    await admin.end({ timeout: 5 }).catch(() => {});
  }
  if (embedded) {
    try {
      await embedded.stop();
    } catch {}
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {}
    );
  }
}, 60_000);

let counter = 0;
const newGuildId = () => `9000${Date.now()}${counter++}`;

async function rowCount(id: string): Promise<number> {
  const rows = await sql`select 1 from guilds where id = ${id}`;
  return rows.length;
}

describe("guildConfig (Postgres + MemoryStore)", () => {
  it("cria a linha em guilds quando nao existe e devolve os defaults", async () => {
    const kv = new MemoryStore();
    const service = createGuildConfigService({ kv, db });
    const id = newGuildId();
    expect(await rowCount(id)).toBe(0);

    const config = await service.get(id);
    expect(await rowCount(id)).toBe(1);
    expect(config).toEqual({
      id,
      prefix: "$",
      locale: "pt-BR",
      baseRolls: 10,
      rollIntervalMin: 60,
      resetOffsetMin: 0,
      claimIntervalMin: 180,
      claimWindowSeconds: 45,
      snipeProtectionLevel: 0,
      snipeProtectionSeconds: 8,
      pactLimit: 8100,
      releaseBoostEnabled: true,
      allowAdult: false,
    });
  });

  it("mapeia as colunas do schema para GuildConfig", async () => {
    const kv = new MemoryStore();
    const service = createGuildConfigService({ kv, db });
    const id = newGuildId();
    await sql`insert into guilds (id, prefix, language, base_rolls, roll_interval_min, reset_offset_min,
      claim_cooldown_minutes, claim_window_seconds, snipe_protection_level, snipe_protection_seconds,
      pact_limit, release_boost_enabled, allow_adult)
      values (${id}, '!', 'en-US', 5, 30, 7, 240, 20, 2, 12, 100, false, true)`;
    expect(await service.get(id)).toEqual({
      id,
      prefix: "!",
      locale: "en-US",
      baseRolls: 5,
      rollIntervalMin: 30,
      resetOffsetMin: 7,
      claimIntervalMin: 240,
      claimWindowSeconds: 20,
      snipeProtectionLevel: 2,
      snipeProtectionSeconds: 12,
      pactLimit: 100,
      releaseBoostEnabled: false,
      allowAdult: true,
    });
  });

  it("idioma desconhecido no banco cai em pt-BR (mapGuildRow)", async () => {
    const id = newGuildId();
    await sql`insert into guilds (id, language) values (${id}, 'xx')`;
    const [row] = await db.select().from(schema.guilds).where(eq(schema.guilds.id, id));
    expect(mapGuildRow(row!).locale).toBe("pt-BR");
  });

  it("cacheia: local (30 s) e KV (10 min), sem reler o banco", async () => {
    const kv = new MemoryStore();
    let now = 1_000_000;
    const service = createGuildConfigService({ kv, db, now: () => now, localTtlMs: 30_000 });
    const id = newGuildId();
    await service.get(id);
    expect(await kv.get(guildConfigKey(id))).not.toBeNull();
    expect(await kv.pttl(guildConfigKey(id))).toBeGreaterThan(9 * 60_000);

    await sql`update guilds set prefix = '?' where id = ${id}`;
    // Cache local ainda valido.
    expect((await service.get(id)).prefix).toBe("$");

    // Local expirado -> cai no KV (ainda com o valor antigo).
    now += 31_000;
    expect((await service.get(id)).prefix).toBe("$");

    // Outra instancia (cache local vazio) tambem le do KV.
    const other = createGuildConfigService({ kv, db });
    expect((await other.get(id)).prefix).toBe("$");

    // Sem KV, le o banco e ve o valor novo.
    await kv.del(guildConfigKey(id));
    now += 31_000;
    expect((await service.get(id)).prefix).toBe("?");
  });

  it("leituras concorrentes criam uma unica linha", async () => {
    const kv = new MemoryStore();
    const id = newGuildId();
    const services = Array.from({ length: 5 }, () => createGuildConfigService({ kv, db }));
    const results = await Promise.all(services.flatMap((s) => [s.get(id), s.get(id)]));
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([id]));
    expect(await rowCount(id)).toBe(1);
  });

  it("invalidate propaga pelo canal guild:config:invalidate para outras instancias", async () => {
    const kv = new MemoryStore();
    const a = createGuildConfigService({ kv, db });
    const b = createGuildConfigService({ kv, db });
    await a.start();
    await b.start();
    const id = newGuildId();

    expect((await b.get(id)).prefix).toBe("$");
    await sql`update guilds set prefix = '%', language = 'en-US' where id = ${id}`;
    // Sem invalidacao, b continua com o valor antigo.
    expect((await b.get(id)).prefix).toBe("$");

    await a.invalidate(id);
    await vi.waitFor(async () => {
      const fresh = await b.get(id);
      expect(fresh.prefix).toBe("%");
      expect(fresh.locale).toBe("en-US");
    });

    await a.stop();
    await b.stop();
  });

  it("depois de stop() o servico nao reage mais ao canal", async () => {
    const kv = new MemoryStore();
    const a = createGuildConfigService({ kv, db });
    const b = createGuildConfigService({ kv, db });
    await b.start();
    const id = newGuildId();
    await b.get(id);
    await b.stop();
    await sql`update guilds set prefix = '#' where id = ${id}`;
    await a.invalidate(id);
    await new Promise((r) => setTimeout(r, 50));
    // b foi parado (cache limpo): le do banco, que ja foi invalidado no KV por `a`.
    expect((await b.get(id)).prefix).toBe("#");
  });

  it("KV com JSON invalido e tratado como miss", async () => {
    const kv = new MemoryStore();
    const service = createGuildConfigService({ kv, db });
    const id = newGuildId();
    await kv.set(guildConfigKey(id), "{nao-e-json");
    expect((await service.get(id)).id).toBe(id);
    await kv.set(guildConfigKey(id), JSON.stringify({ id, prefix: 1 }));
    const fresh = createGuildConfigService({ kv, db });
    expect((await fresh.get(id)).prefix).toBe("$");
  });

  it("/readyz com Postgres real: 200 com tudo ok", async () => {
    const kv = new MemoryStore();
    const server = await startHealthServer(
      {
        isDiscordReady: () => true,
        checkDb: () => sql`select 1`,
        pingKv: () => kv.ping(),
      },
      { port: await freePort(), host: "127.0.0.1" }
    );
    try {
      const res = await fetch(`http://127.0.0.1:${server!.port}/readyz`);
      expect(res.status).toBe(200);
    } finally {
      await server!.close();
    }
  });
});
