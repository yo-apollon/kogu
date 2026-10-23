import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startPostgres, type PgHarness } from "./pgHarness.js";

/**
 * Dry-run contra um SQLite real (ex.: arqon_local.db) num Postgres temporario.
 * So roda com ARQON_REAL_SQLITE=<caminho>; imprime o relatorio JSON. O SQLite e aberto readonly
 * e o teste confirma que .db e -wal ficam byte a byte iguais.
 */
const realSqlite = process.env.ARQON_REAL_SQLITE?.trim();

const sha256 = async (file: string) =>
  existsSync(file)
    ? createHash("sha256")
        .update(await readFile(file))
        .digest("hex")
    : null;

describe.skipIf(!realSqlite)("dry-run real contra SQLite existente", () => {
  let pg: PgHarness;
  let tmp: string;

  beforeAll(async () => {
    pg = await startPostgres();
    tmp = await mkdtemp(path.join(os.tmpdir(), "arqon-real-"));
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
    if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }, 60_000);

  it("relatorio bate com a origem, nada e gravado e o SQLite fica intacto", async () => {
    const file = path.resolve(realSqlite!);
    const before = [await sha256(file), await sha256(`${file}-wal`)];

    const { url } = await pg.createDatabase("arqon_real");
    const { runMigrations } = await import("../../../src/infra/db/migrate.js");
    await runMigrations(url);

    const { migrateFromSqlite } = await import("../../../src/scripts/migrateFromSqlite.js");
    const report = await migrateFromSqlite({
      sqlitePath: file,
      databaseUrl: url,
      dryRun: true,
      backupRoot: path.join(tmp, "backups"),
    });
    console.log(JSON.stringify(report, null, 2));

    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.verification.ok).toBe(true);
    expect(report.tables.entities.destination).toBe(report.tables.entities.source);
    expect(report.tables.pacts.destination).toBe(report.tables.pacts.source);

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [{ n }] = await sql`
        SELECT ((SELECT count(*) FROM entities) + (SELECT count(*) FROM pacts)
              + (SELECT count(*) FROM guilds) + (SELECT count(*) FROM users))::int AS n`;
      expect(n).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }

    expect([await sha256(file), await sha256(`${file}-wal`)]).toEqual(before);
  }, 120_000);
});
