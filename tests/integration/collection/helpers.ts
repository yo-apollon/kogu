import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

// IMPORTANTE: este arquivo nao importa nada de src/ estaticamente. As variaveis de ambiente precisam
// estar definidas antes do primeiro import de config/env.js (dotenv nao sobrescreve o que ja existe).
// Copiado de tests/integration/summon/helpers.ts; muda o seed de entidades (name_normalized no
// formato do catalogo: tokens ordenados) e acrescenta seedPact.

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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-col-"));
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

  const dbName = `arqon_col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

/** Mesmo formato do catalogo: minusculas, sem acento, tokens ordenados. */
export function normalized(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export async function seedGuild(sql: postgres.Sql, id: string): Promise<void> {
  await sql`INSERT INTO guilds (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
}

export async function seedMember(
  sql: postgres.Sql,
  guildId: string,
  userId: string,
  o: { aether?: number; username?: string; embedColor?: string } = {}
): Promise<void> {
  await sql`INSERT INTO users (id, username) VALUES (${userId}, ${o.username ?? userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO guild_members (guild_id, user_id, aether_balance, embed_color)
            VALUES (${guildId}, ${userId}, ${o.aether ?? 0}, ${o.embedColor ?? "#5865F2"})
            ON CONFLICT DO NOTHING`;
}

export async function seedFranchise(sql: postgres.Sql, name: string): Promise<number> {
  const [r] = await sql`
    INSERT INTO franchises (slug, name) VALUES (${name.toLowerCase() + uid("-")}, ${name})
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedSeries(
  sql: postgres.Sql,
  title: string,
  franchiseId: number | null = null
): Promise<number> {
  const [r] = await sql`
    INSERT INTO series (slug, title, universe, franchise_id)
    VALUES (${title.toLowerCase().replace(/\s+/g, "-") + uid("-")}, ${title}, 'ANIME', ${franchiseId})
    RETURNING id::int AS id`;
  return r.id as number;
}

export interface SeedEntityOptions {
  status: string;
  gender: string;
  universe: string;
  tier: string;
  baseAether: number;
  popularityScore: number;
  claimRank: number | null;
  likeRank: number | null;
  seriesId: number;
  franchiseId: number;
  image: boolean;
}

export async function seedEntity(
  sql: postgres.Sql,
  name: string,
  o: Partial<SeedEntityOptions> = {}
): Promise<number> {
  const slug = name.toLowerCase().replace(/\s+/g, "-") + uid("-");
  const [r] = await sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, status, tier, base_aether,
                          popularity_score, claim_rank, like_rank, franchise_id)
    VALUES (${slug}, ${name}, ${normalized(name)}, ${o.universe ?? "ANIME"}::universe,
            ${o.gender ?? "FEMALE"}::gender, ${o.status ?? "ACTIVE"}::entity_status,
            ${o.tier ?? "COMMON"}::entity_tier, ${o.baseAether ?? 100},
            ${o.popularityScore ?? 0}, ${o.claimRank ?? null}, ${o.likeRank ?? null},
            ${o.franchiseId ?? null})
    RETURNING id::int AS id`;
  const id = r.id as number;
  if (o.seriesId) {
    await sql`INSERT INTO entity_series (entity_id, series_id, is_primary) VALUES (${id}, ${o.seriesId}, true)`;
  }
  if (o.image) {
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${id}, ${"https://x/" + id + ".png"}, true)`;
  }
  return id;
}

export interface SeedPactOptions {
  variant: string;
  awakeningKeys: number;
  aetherAtBind: number;
  sortOrder: number;
  alias: string | null;
  alias2: string | null;
  note: string | null;
  /** ISO; padrao: instante crescente (1 ms por pacto) para a ordem padrao ser deterministica. */
  boundAt: string;
}

let boundSeq = 0;

export async function seedPact(
  sql: postgres.Sql,
  guildId: string,
  userId: string,
  entityId: number,
  o: Partial<SeedPactOptions> = {}
): Promise<number> {
  const boundAt = o.boundAt ?? new Date(Date.UTC(2026, 0, 1) + ++boundSeq * 1000).toISOString();
  const [r] = await sql`
    INSERT INTO pacts (guild_id, user_id, entity_id, variant, awakening_keys, aether_at_bind,
                       sort_order, alias, alias2, note, bound_at)
    VALUES (${guildId}, ${userId}, ${entityId}, ${o.variant ?? "STANDARD"}::card_variant,
            ${o.awakeningKeys ?? 1}, ${o.aetherAtBind ?? 0}, ${o.sortOrder ?? 0},
            ${o.alias ?? null}, ${o.alias2 ?? null}, ${o.note ?? null}, ${boundAt})
    RETURNING id::int AS id`;
  return r.id as number;
}
