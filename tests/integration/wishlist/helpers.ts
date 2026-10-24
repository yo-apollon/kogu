import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { vi } from "vitest";

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
    DATABASE_URL: process.env.DATABASE_URL,
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-wl-"));
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

  const dbName = `arqon_wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  const sql = postgres(url, { max: 10, onnotice: () => {} });

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
  o: Partial<{ allowAdult: boolean }> = {}
): Promise<void> {
  await sql`
    INSERT INTO guilds (id, allow_adult) VALUES (${id}, ${o.allowAdult ?? false})
    ON CONFLICT (id) DO NOTHING`;
}

export async function seedMember(
  sql: postgres.Sql,
  guildId: string,
  userId: string,
  o: Partial<{ rollsWindow: number; pactWindow: number }> = {}
): Promise<void> {
  await sql`INSERT INTO users (id, username) VALUES (${userId}, ${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO guild_members (guild_id, user_id, rolls_window, pact_window)
            VALUES (${guildId}, ${userId}, ${o.rollsWindow ?? -1}, ${o.pactWindow ?? -1})
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
    VALUES (${title.toLowerCase().replace(/\W+/g, "-") + uid("-")}, ${title}, 'ANIME', ${franchiseId})
    RETURNING id::int AS id`;
  return r.id as number;
}

/** `name_normalized` segue a regra do catalogo: minusculas e tokens em ordem alfabetica. */
export function sortedKey(name: string): string {
  return name.toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
}

export async function seedEntity(
  sql: postgres.Sql,
  name: string,
  o: Partial<{
    status: string;
    isAdult: boolean;
    seriesId: number;
    franchiseId: number;
    popularity: number;
    baseAether: number;
  }> = {}
): Promise<number> {
  const slug = name.toLowerCase().replace(/\W+/g, "-") + uid("-");
  const [r] = await sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, type, status, is_adult,
                          popularity_score, base_aether, franchise_id)
    VALUES (${slug}, ${name}, ${sortedKey(name)}, 'ANIME'::universe, 'FEMALE'::gender,
            'CHARACTER'::entity_type, ${o.status ?? "ACTIVE"}::entity_status, ${o.isAdult ?? false},
            ${o.popularity ?? 0}, ${o.baseAether ?? 100}, ${o.franchiseId ?? null})
    RETURNING id::int AS id`;
  const id = r.id as number;
  if (o.seriesId) {
    await sql`INSERT INTO entity_series (entity_id, series_id, is_primary) VALUES (${id}, ${o.seriesId}, true)`;
  }
  return id;
}

/** Contexto minimo de comando para exercitar `execute` com banco real. */
export function fakeCtx(o: {
  guildId: string;
  userId: string;
  username?: string;
  args: unknown;
  isAdmin?: boolean;
  allowAdult?: boolean;
  locale?: "pt-BR" | "en-US";
}) {
  const replies: any[] = [];
  const reply = vi.fn(async (payload: unknown) => {
    replies.push(payload);
    return { id: "msg", edit: vi.fn(async () => undefined) };
  });
  const ctx: any = {
    source: "prefix",
    user: { id: o.userId, username: o.username ?? o.userId },
    member: {
      displayName: o.username ?? o.userId,
      permissions: { has: vi.fn(() => o.isAdmin ?? false) },
    },
    guild: { id: o.guildId, name: "Guilda de Teste" },
    guildConfig: {
      id: o.guildId,
      prefix: "$",
      locale: o.locale ?? "pt-BR",
      allowAdult: o.allowAdult ?? false,
    },
    locale: o.locale ?? "pt-BR",
    invokedAs: "test",
    args: o.args,
    rawArgs: [],
    defer: vi.fn(async () => undefined),
    reply,
    followUp: reply,
    t: (key: string) => key,
  };
  return { ctx, replies, reply };
}

/** Texto do primeiro embed (titulo, descricao, campos) de uma resposta capturada. */
export function embedText(payload: any): string {
  const embed = payload?.embeds?.[0];
  const json = embed?.toJSON ? embed.toJSON() : embed;
  const fields = (json?.fields ?? []).map((f: any) => `${f.name}\n${f.value}`);
  return [json?.title, json?.description, ...fields, json?.footer?.text].filter(Boolean).join("\n");
}
