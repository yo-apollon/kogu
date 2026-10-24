import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { vi } from "vitest";
import type { CommandContext, GuildConfig } from "../../../src/core/contracts.js";

// IMPORTANTE: este arquivo nao importa nada de src/ estaticamente (so tipos). As variaveis de ambiente
// precisam estar definidas antes do primeiro import de config/env.js (dotenv nao sobrescreve o que ja existe).

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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-eco-"));
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

  const dbName = `arqon_eco_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
    prefix: string;
    baseRolls: number;
    rollIntervalMin: number;
    resetOffsetMin: number;
    claimCooldownMinutes: number;
    pactsPerWindow: number;
    language: string;
  }> = {}
): Promise<void> {
  await sql`
    INSERT INTO guilds (id, prefix, language, base_rolls, roll_interval_min, reset_offset_min,
                        claim_cooldown_minutes, pacts_per_window)
    VALUES (${id}, ${o.prefix ?? "$"}, ${o.language ?? "pt-BR"}, ${o.baseRolls ?? 10},
            ${o.rollIntervalMin ?? 60}, ${o.resetOffsetMin ?? 0}, ${o.claimCooldownMinutes ?? 180},
            ${o.pactsPerWindow ?? 1})
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

export async function seedFranchise(sql: postgres.Sql, name: string): Promise<number> {
  const [r] = await sql`
    INSERT INTO franchises (slug, name) VALUES (${name.toLowerCase() + uid("-")}, ${name})
    RETURNING id::int AS id`;
  return r.id as number;
}

export async function seedEntity(
  sql: postgres.Sql,
  name: string,
  o: Partial<{ baseAether: number; franchiseId: number; image: boolean }> = {}
): Promise<number> {
  const slug = name.toLowerCase().replace(/\s+/g, "-") + uid("-");
  const [r] = await sql`
    INSERT INTO entities (slug, name, name_normalized, universe, gender, type, status, roll_weight,
                          base_aether, franchise_id)
    VALUES (${slug}, ${name}, ${name.toLowerCase()}, 'ANIME'::universe, 'FEMALE'::gender,
            'CHARACTER'::entity_type, 'ACTIVE'::entity_status, 1, ${o.baseAether ?? 100},
            ${o.franchiseId ?? null})
    RETURNING id::int AS id`;
  const id = r.id as number;
  if (o.image !== false) {
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${id}, ${"https://x/" + id + ".png"}, true)`;
  }
  return id;
}

export async function seedPact(
  sql: postgres.Sql,
  o: {
    guildId: string;
    userId: string;
    entityId: number;
    aetherAtBind?: number;
    awakeningKeys?: number;
    sortOrder?: number;
  }
): Promise<number> {
  const [r] = await sql`
    INSERT INTO pacts (guild_id, user_id, entity_id, aether_at_bind, awakening_keys, sort_order)
    VALUES (${o.guildId}, ${o.userId}, ${o.entityId}, ${o.aetherAtBind ?? 0},
            ${o.awakeningKeys ?? 0}, ${o.sortOrder ?? 0})
    RETURNING id::int AS id`;
  return r.id as number;
}

// ---------------------------------------------------------------------------
// Doubles de Discord
// ---------------------------------------------------------------------------

export function testGuildConfig(id: string, over: Partial<GuildConfig> = {}): GuildConfig {
  return {
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
    ...over,
  };
}

export interface FakeUser {
  id: string;
  username: string;
  displayName: string;
  bot: boolean;
  displayAvatarURL(): string;
}

export function fakeUser(id: string, username = id): FakeUser {
  return {
    id,
    username,
    displayName: username,
    bot: false,
    displayAvatarURL: () => "https://cdn/a.png",
  };
}

/** CommandContext minimo para `execute`; `replies` guarda cada payload enviado. */
export function fakeCtx<A>(opts: {
  guildId: string;
  user: FakeUser;
  args?: A;
  config?: Partial<GuildConfig>;
  fetchUser?: (id: string) => Promise<FakeUser | null>;
}) {
  const replies: any[] = [];
  const sent = { id: "msg", edit: vi.fn(async () => undefined) };
  const config = testGuildConfig(opts.guildId, opts.config);
  const ctx = {
    source: "prefix" as const,
    user: opts.user,
    member: null,
    guild: {
      id: opts.guildId,
      client: {
        users: {
          fetch: vi.fn(async (id: string) => {
            const found = await opts.fetchUser?.(id);
            if (!found) throw new Error("Unknown User");
            return found;
          }),
        },
      },
    },
    guildConfig: config,
    locale: config.locale,
    invokedAs: "test",
    args: (opts.args ?? {}) as A,
    rawArgs: [],
    defer: vi.fn(async () => undefined),
    reply: vi.fn(async (payload: unknown) => {
      replies.push(payload);
      return sent;
    }),
    followUp: vi.fn(async (payload: unknown) => {
      replies.push(payload);
      return sent;
    }),
    t: (key: string) => key,
  };
  return { ctx: ctx as unknown as CommandContext<A>, replies, sent };
}

/** ButtonInteraction minimo para `ComponentHandler.handle`. */
export function fakeButton(opts: { customId: string; guildId: string | null; user: FakeUser }) {
  return {
    customId: opts.customId,
    guildId: opts.guildId,
    user: opts.user,
    replied: false,
    deferred: false,
    message: { edit: vi.fn(async () => undefined), components: [] as unknown[] },
    isButton: () => true,
    reply: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
  };
}

export function embedJson(payload: any, index = 0): any {
  const embed = payload?.embeds?.[index];
  return embed?.toJSON ? embed.toJSON() : embed;
}

export function embedText(payload: any, index = 0): string {
  const j = embedJson(payload, index);
  return [
    j?.title,
    j?.description,
    j?.footer?.text,
    ...(j?.fields ?? []).flatMap((f: any) => [f.name, f.value]),
  ]
    .filter(Boolean)
    .join("\n");
}

export function componentsJson(payload: any): any[] {
  return (payload?.components ?? []).flatMap(
    (row: any) => (row.toJSON ? row.toJSON() : row).components ?? []
  );
}
