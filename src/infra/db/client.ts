import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "../../config/env.js";
import * as schema from "./schema/index.js";

/** Conexoes do pool por processo (bot e worker tem pools proprios). */
const POOL_MAX = 10;

type Sql = ReturnType<typeof postgres>;
type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

let sqlInstance: Sql | null = null;
let dbInstance: Drizzle | null = null;

// Criacao preguicosa: importar este modulo (ex.: deploy dos slash commands) nao exige DATABASE_URL
// nem abre conexao; so o primeiro uso real do banco o faz.
function getSql(): Sql {
  if (!sqlInstance) {
    // A URL carrega a senha: nunca logar `url` nem o objeto de opcoes.
    sqlInstance = postgres(requireEnv("DATABASE_URL"), {
      max: POOL_MAX,
      idle_timeout: 30,
      connect_timeout: 10,
      // Nao falar de NOTICEs (ex.: "relation already exists, skipping") no stdout.
      onnotice: () => {},
    });
  }
  return sqlInstance;
}

function getDb(): Drizzle {
  if (!dbInstance) dbInstance = drizzle(getSql(), { schema });
  return dbInstance;
}

function lazyProxy<T extends object>(target: object, resolve: () => T): T {
  return new Proxy(target, {
    apply: (_t, _thisArg, args) => (resolve() as any)(...args),
    get: (_t, prop) => {
      const instance = resolve();
      const value = (instance as any)[prop];
      return typeof value === "function" ? value.bind(instance) : value;
    },
  }) as T;
}

export const sql: Sql = lazyProxy(function () {}, getSql);

export const db: Drizzle = lazyProxy({}, getDb);

export type Database = Drizzle;

/** Fecha o pool, aguardando queries em andamento por ate `timeoutSec` segundos. */
export async function closeDb(timeoutSec = 5): Promise<void> {
  if (!sqlInstance) return;
  const current = sqlInstance;
  sqlInstance = null;
  dbInstance = null;
  await current.end({ timeout: timeoutSec });
}
