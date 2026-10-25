import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { roDatabaseUrl, rwDatabaseUrl } from "@/lib/env";
import * as schema from "@/generated/schema";

export type Db = PostgresJsDatabase<typeof schema>;

interface Entry {
  client: postgres.Sql;
  db: Db;
}

// Sobrevive ao HMR do `next dev` (evita vazar conexoes a cada recarga de modulo).
const globalKey = Symbol.for("arqon.dashboard.db");
type Registry = Map<string, Entry>;
function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>;
  return (g[globalKey] ??= new Map());
}

function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export interface CreateDbOptions {
  max?: number;
  idleTimeoutSec?: number;
}

/**
 * Cria um cliente + drizzle para a URL. Mesmo driver (postgres-js) em producao e nos testes.
 *  - `prepare: false`: o pooler do Supabase em modo transacao nao suporta prepared statements.
 *  - `max` baixo: cada instancia serverless abre poucas conexoes (o pooler multiplexa).
 *  - SSL obrigatorio fora de localhost.
 * Nunca logue a URL: ela carrega a senha.
 */
export function createDb(url: string, opts: CreateDbOptions = {}): Entry {
  const client = postgres(url, {
    prepare: false,
    max: opts.max ?? 3,
    idle_timeout: opts.idleTimeoutSec ?? 20,
    connect_timeout: 10,
    ssl: isLocalHost(url) ? false : "require",
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}

function singleton(url: string): Db {
  const reg = registry();
  let entry = reg.get(url);
  if (!entry) {
    entry = createDb(url);
    reg.set(url, entry);
  }
  return entry.db;
}

/** Conexao somente leitura (papel `dashboard_ro`). Usada em paginas, layouts e na autorizacao. */
export function getRoDb(): Db {
  return singleton(roDatabaseUrl());
}

/**
 * Conexao de escrita restrita (papel `dashboard_rw`).
 * IMPORTAR SOMENTE de `src/server/actions/**` e dos helpers `ratelimit.ts` / `audit.ts`.
 * Nunca de paginas, layouts ou componentes. O banco ainda limita o que o papel pode escrever.
 */
export function getRwDb(): Db {
  return singleton(rwDatabaseUrl());
}

/** Encerra os clientes do singleton (testes e shutdown). */
export async function closeAllDbs(): Promise<void> {
  const reg = registry();
  const entries = [...reg.values()];
  reg.clear();
  await Promise.all(entries.map((e) => e.client.end({ timeout: 5 })));
}
