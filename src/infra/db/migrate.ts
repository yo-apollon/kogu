import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { requireEnv } from "../../config/env.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Aplica as migrations pendentes. Usa conexao propria (max 1) para nao depender do pool da app
 * e porque o migrator roda tudo em uma transacao. Aceita a URL para uso em testes.
 */
export async function runMigrations(
  databaseUrl: string = requireEnv("DATABASE_URL")
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  runMigrations().then(
    () => {
      console.log("Migrations aplicadas.");
    },
    (err: unknown) => {
      // Mensagem do driver pode citar host/usuario, mas nunca a senha.
      console.error("Falha ao aplicar migrations:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  );
}
