import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

// IMPORTANTE: este arquivo nao importa nada de src/ estaticamente. As variaveis de ambiente precisam
// estar definidas antes do primeiro import de config/env.js (dotenv nao sobrescreve o que ja existe).

export interface TestDb {
  url: string;
  sql: postgres.Sql;
  stop: () => Promise<void>;
}

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

async function canConnect(url: string): Promise<boolean> {
  const c = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await c`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await c.end({ timeout: 1 }).catch(() => {});
  }
}

/** Sobe um Postgres descartavel (embedded, ou o de DATABASE_URL se responder), migra e prepara o ambiente. */
export async function setupTestDb(): Promise<TestDb> {
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };
  let external = process.env.DATABASE_URL?.trim();
  if (external && !(await canConnect(external))) external = undefined;

  let embedded: EmbeddedPostgres | undefined;
  let dataDir: string | undefined;
  let adminUrl: string;
  if (external) {
    adminUrl = external;
  } else {
    const port = await freePort();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-sum-"));
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

  const dbName = `arqon_sum_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  const url = u.toString();

  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = ""; // -> MemoryStore
  process.env.LOG_LEVEL = "silent";

  const { runMigrations } = await import("../../../src/infra/db/migrate.js");
  await runMigrations(url);
  const sql = postgres(url, { max: 5, onnotice: () => {} });

  const restore = (k: keyof typeof saved) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  };

  return {
    url,
    sql,
    stop: async () => {
      try {
        const { closeKV } = await import("../../../src/infra/redis/client.js");
        await closeKV();
      } catch {}
      try {
        const { closeDb } = await import("../../../src/infra/db/client.js");
        await closeDb(2);
      } catch {}
      await sql.end({ timeout: 5 }).catch(() => {});
      const a = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
      await a.end({ timeout: 5 }).catch(() => {});
      if (embedded) await embedded.stop().catch(() => {});
      if (dataDir) {
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
          () => {}
        );
      }
      restore("DATABASE_URL");
      restore("REDIS_URL");
      restore("LOG_LEVEL");
    },
  };
}

let seq = 0;
export const uid = (p = "u") => `${p}${++seq}`;

export async function seedGuild(
  sql: postgres.Sql,
  id: string,
  o: Partial<{
    baseRolls: number;
    rollIntervalMin: number;
    resetOffsetMin: number;
    claimCooldownMinutes: number;
    pactsPerWindow: number;
    releaseBoostEnabled: boolean;
    allowAdult: boolean;
  }> = {}
): Promise<void> {
  await sql`
    INSERT INTO guilds (id, base_rolls, roll_interval_min, reset_offset_min, claim_cooldown_minutes,
                        pacts_per_window, release_boost_enabled, allow_adult)
    VALUES (${id}, ${o.baseRolls ?? 10}, ${o.rollIntervalMin ?? 60}, ${o.resetOffsetMin ?? 0},
            ${o.claimCooldownMinutes ?? 180}, ${o.pactsPerWindow ?? 1},
            ${o.releaseBoostEnabled ?? true}, ${o.allowAdult ?? false})
    ON CONFLICT (id) DO NOTHING`;
}

export async function seedMember(
  sql: postgres.Sql,
  guildId: string,
  userId: string,
  aether = 0
): Promise<void> {
  await sql`INSERT INTO users (id, username) VALUES (${userId}, ${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO guild_members (guild_id, user_id, aether_balance)
            VALUES (${guildId}, ${userId}, ${aether}) ON CONFLICT DO NOTHING`;
}

export async function seedSeries(
  sql: postgres.Sql,
  title: string,
  franchiseId: number | null = null
): Promise<number> {
  const [r] = await sql`
    INSERT INTO series (slug, title, universe, franchise_id)
    VALUES (${title.toLowerCase() + uid("-")}, ${title}, 'ANIME', ${franchiseId})
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedFranchise(sql: postgres.Sql, name: string): Promise<number> {
  const [r] = await sql`
    INSERT INTO franchises (slug, name) VALUES (${name.toLowerCase() + uid("-")}, ${name})
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedEntity(
  sql: postgres.Sql,
  name: string,
  o: Partial<{
    status: string;
    gender: string;
    universe: string;
    type: string;
    weight: number;
    baseAether: number;
    isAdult: boolean;
    seriesId: number;
    image: boolean;
  }> = {}
): Promise<number> {
  const slug = name.toLowerCase().replace(/\s+/g, "-") + uid("-");
  const [r] = await sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, type, status, roll_weight,
                          base_aether, is_adult)
    VALUES (${slug}, ${name}, ${name.toLowerCase()}, ${o.universe ?? "ANIME"}::universe,
            ${o.gender ?? "FEMALE"}::gender, ${o.type ?? "CHARACTER"}::entity_type,
            ${o.status ?? "ACTIVE"}::entity_status, ${o.weight ?? 1}, ${o.baseAether ?? 100},
            ${o.isAdult ?? false})
    RETURNING id::int AS id`;
  const id = r.id as number;
  if (o.seriesId) {
    await sql`INSERT INTO entity_series (entity_id, series_id, is_primary) VALUES (${id}, ${o.seriesId}, true)`;
  }
  if (o.image !== false) {
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${id}, ${"https://x/" + id + ".png"}, true)`;
  }
  return id;
}

/** Cria uma oferta aberta direto no banco. */
export async function seedOffer(
  sql: postgres.Sql,
  o: {
    guildId: string;
    entityId: number;
    ownerUserId: string;
    expiresInMs?: number;
    protectedForMs?: number | null;
    orbAether?: number | null;
    aetherValue?: number;
  }
): Promise<number> {
  const [r] = await sql`
    INSERT INTO roll_offers (guild_id, channel_id, owner_user_id, entity_id, aether_value, expires_at,
                             protected_until, orb_aether)
    VALUES (${o.guildId}, 'c1', ${o.ownerUserId}, ${o.entityId}, ${o.aetherValue ?? 100},
            now() + ${(o.expiresInMs ?? 60_000) / 1000} * interval '1 second',
            ${o.protectedForMs == null ? null : sql`now() + ${o.protectedForMs / 1000} * interval '1 second'`},
            ${o.orbAether ?? null})
    RETURNING id::int AS id`;
  return r.id as number;
}
