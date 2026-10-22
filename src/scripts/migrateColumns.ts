import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.resolve("./arqon_local.db"));

try {
  db.exec("ALTER TABLE users ADD COLUMN daily_imports_count INTEGER DEFAULT 0 NOT NULL");
  console.log("Coluna daily_imports_count adicionada!");
} catch (e: any) {
  console.log("daily_imports_count:", e.message);
}

try {
  db.exec("ALTER TABLE users ADD COLUMN last_import_reset TEXT DEFAULT 'CURRENT_TIMESTAMP' NOT NULL");
  console.log("Coluna last_import_reset adicionada!");
} catch (e: any) {
  console.log("last_import_reset:", e.message);
}

console.log("Migrações concluídas!");
