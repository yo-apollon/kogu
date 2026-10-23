import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import pino from "pino";
import postgres from "postgres";

// Variavel propria: DATABASE_URL e preenchida pelo dotenv de config/env.ts (arquivo .env) e nunca deve ser usada aqui.
const externalUrl = process.env.TEST_DATABASE_URL?.trim();

export interface TestDb {
  db: ReturnType<typeof makeDb>;
  sql: postgres.Sql;
  url: string;
  stop(): Promise<void>;
}

function makeDb(sql: postgres.Sql, schema: Record<string, unknown>) {
  return drizzle(sql, { schema: schema as typeof import("../../../src/infra/db/schema/index.js") });
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

export const silentLog = pino({ level: "silent" });

/** Sobe um Postgres descartavel (embedded, ou DATABASE_URL de CI) com as migrations aplicadas. */
export async function startTestDb(): Promise<TestDb> {
  let embedded: EmbeddedPostgres | undefined;
  let dataDir: string | undefined;
  let adminUrl: string;
  if (externalUrl) {
    adminUrl = externalUrl;
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

  const { runMigrations } = await import("../../../src/infra/db/migrate.js");
  await runMigrations(url);
  const schema = await import("../../../src/infra/db/schema/index.js");
  const sql = postgres(url, { max: 12, onnotice: () => {} });
  const db = makeDb(sql, schema);

  return {
    db,
    sql,
    url,
    async stop() {
      try {
        await sql.end({ timeout: 5 });
      } catch {}
      const a = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } catch {}
      await a.end({ timeout: 5 }).catch(() => {});
      if (embedded) await embedded.stop().catch(() => {});
      if (dataDir) {
        await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
      }
    },
  };
}

