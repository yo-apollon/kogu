import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as schema from "../infra/db/schema/index.js";

/**
 * Banco ou transacao do drizzle (ambos expoem select/insert/update/execute/transaction).
 * Os modulos do catalogo recebem isto por parametro e nunca importam `infra/db/client.ts`,
 * que abre o pool no import; assim os testes de integracao usam um banco proprio.
 */
export type DbExecutor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/** ISO-8601 para parametros de `sql` cru (o driver nao serializa Date nesses casos). */
export function iso(d: Date): string {
  return d.toISOString();
}
