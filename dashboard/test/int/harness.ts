import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
// Harness e migrations do BOT (raiz): a dashboard nao depende de embedded-postgres.
import { startPostgres, type PgHarness } from "../../../tests/integration/migrate/pgHarness";
import { runMigrations } from "../../../src/infra/db/migrate";
import { createDb, type Db } from "@/server/db";

export interface TestEnv {
  harness: PgHarness;
  adminUrl: string;
  /** Superusuario: so para seed/asserts. */
  admin: postgres.Sql;
  roUrl: string;
  rwUrl: string;
  ro: Db;
  rw: Db;
  stop(): Promise<void>;
}

function withCreds(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

const ROLES_SQL = fileURLToPath(new URL("../../../docs/supabase-roles.sql", import.meta.url));

/** Postgres real + migrations do bot + docs/supabase-roles.sql aplicado (papeis dashboard_ro / dashboard_rw). */
export async function setupTestEnv(): Promise<TestEnv> {
  const harness = await startPostgres();
  const { url } = await harness.createDatabase("dash");
  await runMigrations(url);
  const admin = postgres(url, { max: 2, onnotice: () => {} });

  // Papeis que o Supabase ja traz e que o script revoga.
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$;`);
  const script = readFileSync(ROLES_SQL, "utf8")
    .replace(/:'pwd_bot'/g, "'bot_pw_test'")
    .replace(/:'pwd_ro'/g, "'ro_pw_test'")
    .replace(/:'pwd_rw'/g, "'rw_pw_test'");
  await admin.unsafe(script);

  const roUrl = withCreds(url, "dashboard_ro", "ro_pw_test");
  const rwUrl = withCreds(url, "dashboard_rw", "rw_pw_test");
  const roEntry = createDb(roUrl, { max: 2 });
  const rwEntry = createDb(rwUrl, { max: 4 });
  return {
    harness,
    adminUrl: url,
    admin,
    roUrl,
    rwUrl,
    ro: roEntry.db,
    rw: rwEntry.db,
    async stop() {
      await Promise.allSettled([
        roEntry.client.end({ timeout: 2 }),
        rwEntry.client.end({ timeout: 2 }),
        admin.end({ timeout: 2 }),
      ]);
      await harness.stop();
    },
  };
}