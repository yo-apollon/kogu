import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Lido antes de qualquer import de src/: config/env.ts chama dotenv e preencheria DATABASE_URL com o .env local.
const externalUrl = process.env.DATABASE_URL?.trim();
const migrations = () => import("../../../src/infra/db/migrate.js");

// Com DATABASE_URL (ex.: servico postgres do CI) usa esse servidor; sem ele sobe um embedded-postgres.
// Nos dois casos as migrations rodam em um banco novo e descartavel, entao "do zero" vale sempre.
let embedded: EmbeddedPostgres | undefined;
let dataDir: string | undefined;
let adminUrl: string;
let testDbName: string;
let testUrl: string;
let sql: postgres.Sql;

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

async function pgError(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

beforeAll(async () => {
  if (externalUrl) {
    adminUrl = externalUrl;
  } else {
    const port = await freePort();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "arqon-pg-"));
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

  testDbName = `arqon_mig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  testUrl = withDatabase(adminUrl, testDbName);
  sql = postgres(testUrl, { max: 12, onnotice: () => {} });
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

const EXPECTED_TABLES = [
  "guilds",
  "users",
  "guild_members",
  "pacts",
  "wishes",
  "disabled_series",
  "entity_likes",
  "roll_offers",
  "roll_log",
  "franchises",
  "series",
  "series_external_ids",
  "entities",
  "entity_series",
  "entity_external_ids",
  "entity_images",
  "release_windows",
  "catalog_sources",
  "sync_runs",
  "entity_revisions",
  "moderation_queue",
  "character_suggestions",
  "catalog_moderators",
];

describe("migrations do zero", () => {
  it("aplica todas as migrations e e idempotente", async () => {
    const { runMigrations } = await migrations();
    await runMigrations(testUrl);
    await runMigrations(testUrl); // segunda execucao nao faz nada
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    expect(n).toBe(3);
  });

  it("cria extensoes pg_trgm e unaccent", async () => {
    const rows =
      await sql`SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')`;
    expect(rows.map((r) => r.extname).sort()).toEqual(["pg_trgm", "unaccent"]);
  });

  it("cria todas as tabelas", async () => {
    const rows =
      await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const names = rows.map((r) => r.table_name as string);
    for (const t of EXPECTED_TABLES) expect(names, `tabela ${t}`).toContain(t);
  });

  it("FKs criticas existem com a regra de delete esperada", async () => {
    const rows = await sql`
      SELECT c.conname, c.confdeltype::text AS del, t.relname AS tbl, f.relname AS ref
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class f ON f.oid = c.confrelid
      WHERE c.contype = 'f'`;
    const find = (tbl: string, ref: string, name?: string) =>
      rows.find((r) => r.tbl === tbl && r.ref === ref && (!name || r.conname === name));
    expect(find("pacts", "entities")?.del).toBe("r"); // restrict
    expect(find("pacts", "guild_members", "pacts_member_fk")?.del).toBe("c"); // cascade
    expect(find("wishes", "guild_members")?.del).toBe("c");
    expect(find("guild_members", "guilds")?.del).toBe("c");
    expect(find("roll_offers", "entities")?.del).toBe("r");
    expect(find("entities", "franchises")?.del).toBe("n"); // set null
    expect(find("entity_images", "entities")?.del).toBe("c");
    expect(find("disabled_series", "series")?.del).toBe("c");
    expect(find("disabled_series", "franchises")?.del).toBe("c");
  });

  it("indices parciais e GIN trigram existem", async () => {
    const rows = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const def = (name: string) =>
      rows.find((r) => r.indexname === name)?.indexdef as string | undefined;
    expect(def("idx_entities_active_pool")).toMatch(/WHERE .*status.* = 'ACTIVE'/);
    expect(def("uq_entity_images_primary")).toMatch(/UNIQUE.*WHERE/);
    expect(def("idx_pacts_entity")).toBeDefined();
    expect(def("idx_wishes_guild_entity")).toBeDefined();
    for (const name of [
      "idx_entities_name_trgm",
      "idx_series_title_trgm",
      "idx_franchises_name_trgm",
    ]) {
      expect(def(name), name).toMatch(/USING gin .*gin_trgm_ops/);
    }
  });
});

describe("regras de integridade", () => {
  let seq = 0;
  const uid = () => `u${++seq}`;

  async function seedGuild(id: string) {
    await sql`INSERT INTO guilds (id) VALUES (${id})`;
  }
  async function seedMember(guildId: string, userId: string) {
    await sql`INSERT INTO users (id, username) VALUES (${userId}, ${userId}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO guild_members (guild_id, user_id) VALUES (${guildId}, ${userId})`;
  }
  async function seedEntity(name: string): Promise<number> {
    const [row] = await sql`
      INSERT INTO entities (slug, name, name_normalized, universe, gender, status)
      VALUES (${name.toLowerCase()}, ${name}, ${name.toLowerCase()}, 'ANIME', 'FEMALE', 'ACTIVE')
      RETURNING id::int AS id`;
    return row.id as number;
  }

  it("pacts: unique (guild, entity) e 10 claims concorrentes geram 1 pacto", async () => {
    await seedGuild("g-pact");
    const entityId = await seedEntity("Pact Target");
    const users = Array.from({ length: 10 }, uid);
    for (const u of users) await seedMember("g-pact", u);

    const results = await Promise.allSettled(
      users.map(
        (u) =>
          sql`INSERT INTO pacts (guild_id, user_id, entity_id) VALUES ('g-pact', ${u}, ${entityId})`
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failed.every((r) => (r.reason as { code?: string }).code === "23505")).toBe(true);

    const [{ n }] = await sql`SELECT count(*)::int AS n FROM pacts WHERE guild_id = 'g-pact'`;
    expect(n).toBe(1);

    // ON CONFLICT DO NOTHING (caminho do service) nao lanca e nao insere.
    const again = await sql`
      INSERT INTO pacts (guild_id, user_id, entity_id) VALUES ('g-pact', ${users[3]}, ${entityId})
      ON CONFLICT (guild_id, entity_id) DO NOTHING RETURNING id`;
    expect(again).toHaveLength(0);
  });

  it("pacts: entidade com pacto nao pode ser apagada (restrict)", async () => {
    await seedGuild("g-restrict");
    const u = uid();
    await seedMember("g-restrict", u);
    const entityId = await seedEntity("Restrict Target");
    await sql`INSERT INTO pacts (guild_id, user_id, entity_id) VALUES ('g-restrict', ${u}, ${entityId})`;
    expect(await pgError(sql`DELETE FROM entities WHERE id = ${entityId}`)).toBe("23001"); // restrict_violation
  });

  it("pacts: apagar o membro remove seus pactos e wishes (cascade)", async () => {
    await seedGuild("g-cascade");
    const u = uid();
    await seedMember("g-cascade", u);
    const e1 = await seedEntity("Cascade One");
    const e2 = await seedEntity("Cascade Two");
    await sql`INSERT INTO pacts (guild_id, user_id, entity_id) VALUES ('g-cascade', ${u}, ${e1})`;
    await sql`INSERT INTO wishes (guild_id, user_id, entity_id) VALUES ('g-cascade', ${u}, ${e2})`;
    await sql`DELETE FROM guild_members WHERE guild_id = 'g-cascade' AND user_id = ${u}`;
    const [{ p }] = await sql`SELECT count(*)::int AS p FROM pacts WHERE guild_id = 'g-cascade'`;
    const [{ w }] = await sql`SELECT count(*)::int AS w FROM wishes WHERE guild_id = 'g-cascade'`;
    expect([p, w]).toEqual([0, 0]);
  });

  it("disabled_series: CHECK exige exatamente um de series_id/franchise_id", async () => {
    await seedGuild("g-dis");
    const u = uid();
    await seedMember("g-dis", u);
    const [{ id: franchiseId }] = await sql`
      INSERT INTO franchises (slug, name) VALUES ('f-dis', 'F Dis') RETURNING id::int AS id`;
    const [{ id: seriesId }] = await sql`
      INSERT INTO series (slug, title, universe) VALUES ('s-dis', 'S Dis', 'ANIME') RETURNING id::int AS id`;

    const none = sql`INSERT INTO disabled_series (guild_id, user_id) VALUES ('g-dis', ${u})`;
    expect(await pgError(none)).toBe("23514");

    const both = sql`
      INSERT INTO disabled_series (guild_id, user_id, series_id, franchise_id)
      VALUES ('g-dis', ${u}, ${seriesId}, ${franchiseId})`;
    expect(await pgError(both)).toBe("23514");

    await sql`INSERT INTO disabled_series (guild_id, user_id, series_id) VALUES ('g-dis', ${u}, ${seriesId})`;
    await sql`INSERT INTO disabled_series (guild_id, user_id, franchise_id) VALUES ('g-dis', ${u}, ${franchiseId})`;

    // Mesmo alvo duas vezes viola o unique parcial.
    const dup = sql`INSERT INTO disabled_series (guild_id, user_id, series_id) VALUES ('g-dis', ${u}, ${seriesId})`;
    expect(await pgError(dup)).toBe("23505");
  });

  it("entity_images: indice parcial permite 1 imagem primaria por entidade", async () => {
    const entityId = await seedEntity("Image Target");
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${entityId}, 'https://x/1.png', true)`;
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${entityId}, 'https://x/2.png', false)`;
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${entityId}, 'https://x/3.png', false)`;

    const second = sql`
      INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${entityId}, 'https://x/4.png', true)`;
    expect(await pgError(second)).toBe("23505");

    // Primaria de outra entidade nao conflita.
    const other = await seedEntity("Image Other");
    await sql`INSERT INTO entity_images (entity_id, url, is_primary) VALUES (${other}, 'https://x/1.png', true)`;

    // Primaria so pode estar ativa.
    const broken = await seedEntity("Image Broken");
    const bad = sql`
      INSERT INTO entity_images (entity_id, url, is_primary, status)
      VALUES (${broken}, 'https://x/b.png', true, 'BROKEN')`;
    expect(await pgError(bad)).toBe("23514");
  });

  it("entities: popularity_rank e unico, mas troca de ranks na mesma transacao funciona", async () => {
    const a = await seedEntity("Rank A");
    const b = await seedEntity("Rank B");
    await sql`UPDATE entities SET popularity_rank = 900001 WHERE id = ${a}`;
    await sql`UPDATE entities SET popularity_rank = 900002 WHERE id = ${b}`;

    // Rank duplicado: falha no commit (constraint deferida).
    const dup = sql.begin(async (tx) => {
      await tx`UPDATE entities SET popularity_rank = 900001 WHERE id = ${b}`;
    });
    expect(await pgError(dup)).toBe("23505");

    // Troca A <-> B em um UPDATE so (como o rerank faz).
    await sql`
      UPDATE entities SET popularity_rank = CASE id WHEN ${a} THEN 900002 ELSE 900001 END
      WHERE id IN (${a}, ${b})`;
    const rows =
      await sql`SELECT id::int AS id, popularity_rank FROM entities WHERE id IN (${a}, ${b})`;
    expect(rows.find((r) => r.id === a)?.popularity_rank).toBe(900002);
    expect(rows.find((r) => r.id === b)?.popularity_rank).toBe(900001);
  });

  it("CHECKs de saldo e janelas rejeitam valores invalidos", async () => {
    await seedGuild("g-ck");
    const u = uid();
    await seedMember("g-ck", u);
    expect(
      await pgError(sql`UPDATE guild_members SET rolls_used = -1 WHERE guild_id = 'g-ck'`)
    ).toBe("23514");
    expect(await pgError(sql`UPDATE guilds SET roll_interval_min = 0 WHERE id = 'g-ck'`)).toBe(
      "23514"
    );
    const badScore = sql`
      INSERT INTO entities (slug, name, name_normalized, universe, popularity_score)
      VALUES ('bad-score', 'Bad Score', 'bad score', 'ANIME', 1.5)`;
    expect(await pgError(badScore)).toBe("23514");
  });

  it("busca trigram encontra nome com erro de digitacao", async () => {
    await seedEntity("Frieren Trigram");
    const rows = await sql`
      SELECT name FROM entities WHERE name % 'Frieren Trigrm' ORDER BY similarity(name, 'Frieren Trigrm') DESC`;
    expect(rows.map((r) => r.name)).toContain("Frieren Trigram");
  });

  it("estado padrao da entidade nao entra no pool ate ser ativada", async () => {
    const [row] = await sql`
      INSERT INTO entities (slug, name, name_normalized, universe) VALUES ('def', 'Def', 'def', 'GAME')
      RETURNING status::text AS status, gender::text AS gender, tier::text AS tier`;
    expect(row).toEqual({ status: "PENDING_REVIEW", gender: "UNKNOWN", tier: "COMMON" });
  });
});

describe("client.ts", () => {
  it("conecta via DATABASE_URL e fecha o pool", async () => {
    process.env.DATABASE_URL = testUrl;
    const { db, closeDb } = await import("../../../src/infra/db/client.js");
    const { guilds } = await import("../../../src/infra/db/schema/index.js");
    await db.insert(guilds).values({ id: "g-client" });
    const rows = await db.select({ id: guilds.id, prefix: guilds.prefix }).from(guilds);
    expect(rows.find((r) => r.id === "g-client")?.prefix).toBe("$");
    await closeDb();
  });
});
