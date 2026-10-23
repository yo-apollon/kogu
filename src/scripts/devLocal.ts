/**
 * Ambiente local de desenvolvimento SEM Docker: sobe um PostgreSQL embutido e persistente
 * (dados em .cache/devdb), aplica as migrations, importa o SQLite legado na primeira execucao
 * e liga o bot. Redis fica em memoria. Uso: `npm run dev:local`.
 *
 * Variaveis de ambiente sao definidas ANTES de qualquer import de src/ para que o dotenv do
 * .env (que aponta para servidores de producao) nao prevaleca.
 */
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

const PORT = Number(process.env.DEV_PG_PORT ?? 54329);
const PASSWORD = "arqon_dev_pw";
const DB_NAME = "arqon_dev";
const DATA_DIR = path.resolve(".cache/devdb/data");
const ADMIN_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`;
const DEV_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;

process.env.DATABASE_URL = DEV_URL;
process.env.REDIS_URL = "";
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";

async function startPostgres(): Promise<EmbeddedPostgres> {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // No Windows o initdb herda WIN1252; nomes japoneses/acentuados exigem UTF8.
    initdbFlags: ["--encoding=UTF8", "--no-locale"],
    onLog: () => {},
    onError: (e) => console.error("[postgres]", e),
  });
  if (!fs.existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log("Inicializando o banco local (primeira execucao)...");
    await pg.initialise();
  }
  await pg.start();
  return pg;
}

async function ensureDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${DB_NAME}`;
    if (rows.length === 0) await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function importLegacyIfEmpty(): Promise<void> {
  const sqlitePath = path.resolve("arqon_local.db");
  if (!fs.existsSync(sqlitePath)) return;
  const client = postgres(DEV_URL, { max: 1, onnotice: () => {} });
  let count = 0;
  try {
    const [row] = await client`SELECT count(*)::int AS n FROM entities`;
    count = row?.n ?? 0;
  } finally {
    await client.end({ timeout: 5 });
  }
  if (count > 0) return;
  console.log("Importando o SQLite legado (310 entidades, pactos, perfis)...");
  const { migrateFromSqlite } = await import("./migrateFromSqlite.js");
  const report = await migrateFromSqlite({
    sqlitePath,
    databaseUrl: DEV_URL,
    activateLegacy: true,
    log: () => {},
  });
  console.log(`Legado importado: ok=${report.ok}`);
}

async function main() {
  const pg = await startPostgres();
  await ensureDatabase();

  const { runMigrations } = await import("../infra/db/migrate.js");
  await runMigrations(DEV_URL);
  await importLegacyIfEmpty();

  const { onShutdown } = await import("../core/shutdown.js");
  onShutdown("embedded-postgres", async () => {
    await pg.stop();
  });

  console.log(`Banco local pronto em 127.0.0.1:${PORT}/${DB_NAME}. Ligando o bot...`);
  await import("../index.js");

  // Smoke test: sobe tudo, aguarda e encerra limpo (usado para validar o ambiente sem ficar no ar).
  const smokeMs = Number(process.env.DEV_LOCAL_SMOKE_MS ?? 0);
  if (smokeMs > 0) {
    setTimeout(() => {
      void import("../core/shutdown.js").then((m) => m.shutdown("smoke-test"));
    }, smokeMs);
  }
}

main().catch((err) => {
  console.error("Falha ao iniciar o ambiente local:", err);
  process.exit(1);
});
