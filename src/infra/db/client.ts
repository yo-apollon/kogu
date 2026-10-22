import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "../../config/env.js";
import * as schema from "./schema/index.js";

/** Conexoes do pool por processo (bot e worker tem pools proprios). */
const POOL_MAX = 10;

// A URL carrega a senha: nunca logar `url` nem o objeto de opcoes.
export const sql = postgres(requireEnv("DATABASE_URL"), {
  max: POOL_MAX,
  idle_timeout: 30,
  connect_timeout: 10,
  // Nao falar de NOTICEs (ex.: "relation already exists, skipping") no stdout.
  onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Database = typeof db;

/** Fecha o pool, aguardando queries em andamento por ate `timeoutSec` segundos. */
export async function closeDb(timeoutSec = 5): Promise<void> {
  await sql.end({ timeout: timeoutSec });
}
