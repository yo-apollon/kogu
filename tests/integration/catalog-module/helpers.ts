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

/** Sobe um Postgres descartavel (embedded, ou o de TEST_DATABASE_URL se responder), migra e prepara o ambiente. */
export async function setupTestDb(): Promise<TestDb> {
  const saved = {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };
  let external = process.env.TEST_DATABASE_URL?.trim();
  if (external && !(await canConnect(external))) external = undefined;

  let embedded: EmbeddedPostgres | undefined;
  let dataDir: string | undefined;
  let adminUrl: string;
  if (external) {
    adminUrl = external;
  } else {
    const port = await freePort();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-cat-"));
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

  const dbName = `arqon_cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

export async function seedGuild(sql: postgres.Sql, id: string): Promise<void> {
  await sql`INSERT INTO guilds (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
}

export async function seedUser(
  sql: postgres.Sql,
  id: string,
  o: { vipTier?: number; username?: string } = {}
): Promise<void> {
  await sql`
    INSERT INTO users (id, username, vip_tier, is_vip)
    VALUES (${id}, ${o.username ?? id}, ${o.vipTier ?? 0}, ${(o.vipTier ?? 0) > 0})
    ON CONFLICT (id) DO UPDATE SET vip_tier = EXCLUDED.vip_tier, is_vip = EXCLUDED.is_vip`;
}

export async function seedMember(sql: postgres.Sql, guildId: string, userId: string): Promise<void> {
  await seedGuild(sql, guildId);
  await sql`INSERT INTO users (id, username) VALUES (${userId}, ${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO guild_members (guild_id, user_id) VALUES (${guildId}, ${userId}) ON CONFLICT DO NOTHING`;
}

export async function seedFranchise(sql: postgres.Sql, name: string): Promise<number> {
  const [r] = await sql`
    INSERT INTO franchises (slug, name) VALUES (${name.toLowerCase().replace(/\s+/g, "-") + uid("-")}, ${name})
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedEntity(
  sql: postgres.Sql,
  name: string,
  o: Partial<{
    status: string;
    gender: string;
    isAdult: boolean;
    favorites: number;
    franchiseId: number;
    image: boolean;
    normalized: string;
  }> = {}
): Promise<number> {
  const slug = name.toLowerCase().replace(/\s+/g, "-") + uid("-");
  const [r] = await sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status, is_adult, source_favorites, franchise_id)
    VALUES (${slug}, ${name}, ${o.normalized ?? name.toLowerCase().split(" ").sort().join(" ")}, 'ANIME'::universe,
            ${o.gender ?? "MALE"}::gender, ${o.status ?? "ACTIVE"}::entity_status, ${o.isAdult ?? false},
            ${o.favorites ?? 100}, ${o.franchiseId ?? null})
    RETURNING id::int AS id`;
  const id = r.id as number;
  if (o.image !== false) {
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${id}, ${"https://x/" + id + ".png"}, true)`;
  }
  return id;
}

export async function seedModeration(
  sql: postgres.Sql,
  o: { entityId: number | null; reason: string; otherEntityId?: number; status?: string }
): Promise<number> {
  const [r] = await sql`
    INSERT INTO moderation_queue (entity_id, other_entity_id, reason, status)
    VALUES (${o.entityId}, ${o.otherEntityId ?? null}, ${o.reason}::moderation_reason,
            ${o.status ?? "PENDING"}::review_status)
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedPact(
  sql: postgres.Sql,
  guildId: string,
  userId: string,
  entityId: number,
  o: { keys?: number } = {}
): Promise<number> {
  await seedMember(sql, guildId, userId);
  const [r] = await sql`
    INSERT INTO pacts (guild_id, user_id, entity_id, awakening_keys)
    VALUES (${guildId}, ${userId}, ${entityId}, ${o.keys ?? 0}) RETURNING id::int AS id`;
  return r.id as number;
}
