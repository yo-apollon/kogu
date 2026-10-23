import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSyntheticLegacyDb, SYNTHETIC } from "../../fixtures/sqlite/legacyDb.js";
import { startPostgres, type PgHarness } from "./pgHarness.js";

// Importado de forma tardia: nada de src/ le o .env local antes de DATABASE_URL ser lida pelo harness.
const migrator = () => import("../../../src/scripts/migrateFromSqlite.js");
const migrations = () => import("../../../src/infra/db/migrate.js");

const ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const execFileAsync = promisify(execFile);
const NOW = new Date("2030-01-01T00:00:00.000Z");

let pg: PgHarness;
let tmp: string;
let sqliteFile: string;
let sqliteWithOrphan: string;

async function freshDb(prefix: string): Promise<{ url: string; sql: postgres.Sql }> {
  const { url } = await pg.createDatabase(prefix);
  const { runMigrations } = await migrations();
  await runMigrations(url);
  return { url, sql: postgres(url, { max: 4, onnotice: () => {} }) };
}

const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function snapshot(sql: postgres.Sql) {
  const counts: Record<string, number> = {};
  for (const t of [
    "franchises",
    "series",
    "series_external_ids",
    "entities",
    "entity_series",
    "entity_images",
    "users",
    "guilds",
    "guild_members",
    "pacts",
    "wishes",
    "disabled_series",
    "character_suggestions",
    "moderation_queue",
  ]) {
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${t}`);
    counts[t] = r.n as number;
  }
  const ranks = await sql`SELECT legacy_id, popularity_rank FROM entities ORDER BY legacy_id`;
  const pacts = await sql`
    SELECT guild_id, user_id, e.legacy_id, variant::text AS variant, alias, alias2, note, aether_at_bind
    FROM pacts p JOIN entities e ON e.id = p.entity_id ORDER BY guild_id, e.legacy_id`;
  return { counts, ranks: [...ranks], pacts: [...pacts] };
}

beforeAll(async () => {
  pg = await startPostgres();
  tmp = await mkdtemp(path.join(os.tmpdir(), "arqon-mig-"));
  sqliteFile = path.join(tmp, "legacy.db");
  sqliteWithOrphan = path.join(tmp, "legacy-orphan.db");
  buildSyntheticLegacyDb(sqliteFile);
  buildSyntheticLegacyDb(sqliteWithOrphan, (db) => {
    db.prepare(
      "INSERT INTO pacts (id, guild_id, user_id, entity_id, variant) VALUES ('ghost', 'g1', 'u1', 'entidade-que-nao-existe', 'STANDARD')"
    ).run();
  });
}, 120_000);

afterAll(async () => {
  await pg?.stop();
  if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}, 60_000);

describe("migrateFromSqlite", () => {
  let url: string;
  let sql: postgres.Sql;

  beforeAll(async () => {
    ({ url, sql } = await freshDb("arqon_migsqlite"));
  }, 60_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("dry-run executa tudo, reporta e nao grava nada; SQLite fica intacto; backup criado", async () => {
    const { migrateFromSqlite } = await migrator();
    const hashBefore = await sha256(sqliteFile);
    const backupRoot = path.join(tmp, "backups");

    const report = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      dryRun: true,
      backupRoot,
      now: NOW,
    });

    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.tables.entities).toMatchObject({ source: 8, destination: 8, inserted: 8 });
    expect(report.tables.pacts).toMatchObject({ source: 5, destination: 5, inserted: 5 });
    expect(report.verification.ok).toBe(true);

    const snap = await snapshot(sql);
    expect(Object.values(snap.counts).every((n) => n === 0)).toBe(true);

    expect(await sha256(sqliteFile)).toBe(hashBefore);
    expect(report.backup?.files.map((f) => path.basename(f)).sort()).toEqual(["legacy.db"]);
    const stamps = await readdir(backupRoot);
    expect(stamps).toHaveLength(1);
    expect(await sha256(path.join(backupRoot, stamps[0], "legacy.db"))).toBe(hashBefore);
  });

  it("primeira execucao migra tudo com as regras de mapeamento", async () => {
    const { migrateFromSqlite } = await migrator();
    const report = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      backupRoot: false,
      now: NOW,
    });
    expect(report.error).toBeUndefined();
    expect(report.ok).toBe(true);

    expect(report.tables).toMatchObject({
      franchises: { source: 6, destination: 6, inserted: 6 },
      series: { source: 6, destination: 6, inserted: 6 },
      entities: { source: 8, destination: 8, inserted: 8 },
      entity_images: { source: 8, destination: 8, inserted: 8 },
      users: { source: 3, destination: 4, inserted: 4 }, // u9 vem de wish sem cadastro (placeholder)
      guilds: { source: 2, destination: 2, inserted: 2 },
      guild_members: { source: 3, destination: 4, inserted: 4 },
      pacts: { source: 5, destination: 5, inserted: 5 },
      wishes: { source: 3, destination: 2, inserted: 2 }, // 1 duplicada colapsada
      disabled_series: { source: 3, destination: 2, inserted: 2 },
      character_suggestions: { source: 1, destination: 1, inserted: 1 },
      moderation_queue: { source: 10, destination: 10, inserted: 10 },
    });
    expect(report.pending).toMatchObject({
      entitiesPendingReview: 8,
      entitiesActivated: 0,
      legacyGenderQueued: 8,
      gendersUnconfirmed: 6,
      entitiesWithoutImage: 1,
      invalidImageUrls: 1,
      sourceEntitiesSharingRank: 5,
      placeholderUsers: 1,
      placeholderMembers: 1,
      orphanPacts: 0,
      orphanAliases: 1,
      universeRemapped: { "WEAPON->ANIME": 1, "MYTHOLOGY->ANIME": 1 },
      unmatchedDisabledSeries: { count: 1, names: ["Serie Que Nao Existe"] },
    });
    expect(report.pending.datesReplaced["entities.created_at"]).toBe(7);
    expect(report.pending.duplicatesCollapsed).toEqual({ wishes: 1 });
    expect(report.verification.pactsPerGuild).toEqual([
      { guildId: "g1", source: 3, destination: 3 },
      { guildId: "g2", source: 2, destination: 2 },
    ]);

    // franquia repetida com caixa diferente vira UMA franquia/serie LEGACY
    const naruto = await sql`
      SELECT count(*)::int AS n FROM entities e JOIN franchises f ON f.id = e.franchise_id
      WHERE f.slug = 'naruto'`;
    expect(naruto[0].n).toBe(2);
    const legacySeries = await sql`
      SELECT s.title, s.slug FROM series_external_ids x JOIN series s ON s.id = x.series_id
      WHERE x.source = 'LEGACY' AND x.external_id = 'naruto'`;
    expect(legacySeries).toHaveLength(1);
    expect(legacySeries[0]).toMatchObject({ title: "Naruto", slug: "legacy-naruto" });

    // ranks unicos 1..8, desempate por rank legado -> favoritos -> aether -> nome
    const ranked = await sql`
      SELECT legacy_id, popularity_rank FROM entities ORDER BY popularity_rank`;
    const e = SYNTHETIC.entityIds;
    expect(ranked.map((r) => [r.legacy_id, r.popularity_rank])).toEqual([
      [e.alpha, 1],
      [e.beta, 2],
      [e.gamma, 3],
      [e.excal, 4],
      [e.delta, 5],
      [e.eowyn, 6],
      [e.myth, 7],
      [e.noimg, 8],
    ]);

    // universo/tipo/genero/status
    const byLegacy = async (id: string) =>
      (
        await sql`
          SELECT universe::text AS universe, type::text AS type, gender::text AS gender,
                 status::text AS status, name_native, name_normalized, created_at,
                 tier::text AS tier, popularity_score
          FROM entities WHERE legacy_id = ${id}`
      )[0];
    expect(await byLegacy(e.excal)).toMatchObject({
      universe: "ANIME",
      type: "WEAPON",
      gender: "ITEM",
      status: "PENDING_REVIEW",
    });
    expect(await byLegacy(e.myth)).toMatchObject({
      universe: "ANIME",
      type: "CHARACTER",
      gender: "UNKNOWN",
    });
    expect(await byLegacy(e.delta)).toMatchObject({ universe: "GAME" });
    const eowyn = await byLegacy(e.eowyn);
    expect(eowyn).toMatchObject({ universe: "CINEMA", name_native: "エオウィン" });
    expect(eowyn.name_normalized).toBe("eowyn under"); // tokens ordenados, sem acento
    expect((await byLegacy(e.alpha)).tier).toBe("EPIC"); // percentil (0+0.5)/8 = 6,25% -> EPIC
    expect((await byLegacy(e.alpha)).popularity_score).toBe(1);

    // datas: literal CURRENT_TIMESTAMP e invalida viram `now`; valida e preservada
    expect((await byLegacy(e.alpha)).created_at.toISOString()).toBe(NOW.toISOString());
    expect((await byLegacy(e.gamma)).created_at.toISOString()).toBe(NOW.toISOString());
    expect((await byLegacy(e.beta)).created_at.toISOString()).toBe("2024-05-01T10:00:00.000Z");

    // imagens: 1 primaria ativa por entidade com imagem; sem imagem => nenhuma
    const imgs = await sql`
      SELECT e.legacy_id, count(*)::int AS n, count(*) FILTER (WHERE i.is_primary)::int AS prim,
             min(i.url) FILTER (WHERE i.is_primary) AS primary_url, min(i.source::text) AS source
      FROM entity_images i JOIN entities e ON e.id = i.entity_id GROUP BY e.legacy_id`;
    const imgOf = (id: string) => imgs.find((r) => r.legacy_id === id);
    expect(imgOf(e.alpha)).toMatchObject({ n: 2, prim: 1, source: "LEGACY" });
    expect(imgOf(e.alpha)?.primary_url).toMatch(/b1\.png$/); // a primeira do array
    expect(imgOf(e.myth)).toMatchObject({ n: 1, prim: 1 }); // "nao-e-url" descartada
    expect(imgOf(e.noimg)).toBeUndefined();

    // moderacao
    const mod = await sql`
      SELECT reason::text AS reason, count(*)::int AS n FROM moderation_queue
      WHERE status = 'PENDING' GROUP BY reason`;
    const modMap = Object.fromEntries(mod.map((r) => [r.reason, r.n]));
    expect(modMap).toEqual({ LEGACY_GENDER: 8, NO_IMAGE: 1, UNMATCHED_DISABLED_SERIES: 1 });
    const unmatched = await sql`
      SELECT entity_id, details FROM moderation_queue WHERE reason = 'UNMATCHED_DISABLED_SERIES'`;
    expect(unmatched[0].entity_id).toBeNull();
    expect(unmatched[0].details).toMatchObject({
      seriesName: "Serie Que Nao Existe",
      guildId: "g1",
      userId: "u1",
    });

    // guild_members: rolls_used = max(0, base_rolls - rolls_remaining), janelas em -1
    const members = await sql`
      SELECT guild_id, user_id, rolls_used, rolls_window, pact_window, pacts_used, aether_balance::int AS aether, stacked_rolls
      FROM guild_members ORDER BY guild_id, user_id`;
    expect(
      members.map((m) => [m.guild_id, m.user_id, m.rolls_used, m.rolls_window, m.pact_window])
    ).toEqual([
      ["g1", "u1", 4, -1, -1],
      ["g1", "u2", 0, -1, -1],
      ["g1", "u9", 0, -1, -1],
      ["g2", "u1", 0, -1, -1],
    ]);
    expect(members[0]).toMatchObject({ aether: 666, stacked_rolls: 5 });

    // users
    const alice = (
      await sql`SELECT is_vip, vip_tier, daily_imports_count FROM users WHERE id = 'u1'`
    )[0];
    expect(alice).toMatchObject({ is_vip: true, vip_tier: 2, daily_imports_count: 3 });

    // pacts: merge de aliases, aether_at_bind pela variante, pactos em 2 guilds
    const pacts = await sql`
      SELECT p.guild_id, e.legacy_id, p.variant::text AS variant, p.alias, p.alias2, p.note, p.aether_at_bind, p.bound_at
      FROM pacts p JOIN entities e ON e.id = p.entity_id ORDER BY p.guild_id, e.legacy_id`;
    const pact = (g: string, id: string) =>
      pacts.find((p) => p.guild_id === g && p.legacy_id === id)!;
    expect(pact("g1", e.alpha)).toMatchObject({
      variant: "HOLO",
      alias: "Alfa",
      alias2: "Alfinha", // pacto sem alias2 => custom_aliases
      note: "nota do pacto", // valor do pacto prevalece
      aether_at_bind: 875, // 500 * 1.75
    });
    expect(pact("g1", e.gamma)).toMatchObject({
      alias: null,
      alias2: "apelido2 do pacto", // valor do pacto prevalece
      note: "nota do gamma", // pacto sem nota => custom_aliases
    });
    expect(pact("g1", e.gamma).bound_at.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(pact("g2", e.excal)).toMatchObject({ variant: "ASTRAL", aether_at_bind: 4400 });
    expect(pact("g2", e.alpha)).toMatchObject({
      alias: null,
      alias2: null,
      note: null,
      aether_at_bind: 500,
    });

    // wishes: duplicada colapsada, placeholder criado
    const wishes = await sql`
      SELECT w.guild_id, w.user_id, e.legacy_id, w.is_starwish FROM wishes w
      JOIN entities e ON e.id = w.entity_id ORDER BY w.user_id`;
    expect(wishes.map((w) => [w.user_id, w.legacy_id, w.is_starwish])).toEqual([
      ["u2", e.gamma, true],
      ["u9", e.alpha, false],
    ]);

    // disabled_series: casou por nome normalizado com series.title
    const dis = await sql`
      SELECT d.user_id, d.is_server_wide, s.title FROM disabled_series d
      JOIN series s ON s.id = d.series_id ORDER BY d.user_id`;
    expect(dis.map((d) => [d.user_id, d.is_server_wide, d.title])).toEqual([
      ["u1", false, "Naruto"],
      ["u2", true, "Elden Ring"],
    ]);

    // sugestoes
    const sug =
      await sql`SELECT character_name, status::text AS status, anilist_id FROM character_suggestions`;
    expect(sug).toHaveLength(1);
    expect(sug[0]).toMatchObject({
      character_name: "Algum Personagem",
      status: "PENDING",
      anilist_id: 1234,
    });
  });

  it("segunda execucao e idempotente: 0 inseridos e mesmo estado", async () => {
    const { migrateFromSqlite } = await migrator();
    const before = await snapshot(sql);

    const report = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      backupRoot: false,
      now: new Date("2031-06-06T00:00:00.000Z"), // relogio diferente nao pode mudar nada
    });
    expect(report.ok).toBe(true);
    for (const [table, t] of Object.entries(report.tables)) {
      expect(t.inserted, `inserted em ${table}`).toBe(0);
    }
    expect(report.tables.entities.destination).toBe(8);
    expect(report.tables.pacts.destination).toBe(5);

    const after = await snapshot(sql);
    expect(after).toEqual(before);

    const [{ n }] = await sql`
      SELECT (count(popularity_rank) - count(DISTINCT popularity_rank))::int AS n FROM entities`;
    expect(n).toBe(0);
  });

  it("--activate-legacy ativa so entidades elegiveis, fecha LEGACY_GENDER delas e nunca rebaixa", async () => {
    const { migrateFromSqlite } = await migrator();
    const report = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      activateLegacy: true,
      backupRoot: false,
      now: NOW,
    });
    expect(report.ok).toBe(true);
    // alpha, beta, gamma, delta, eowyn (MALE/FEMALE com imagem) + excalibur (ITEM de type WEAPON)
    expect(report.pending).toMatchObject({
      entitiesActivated: 6,
      entitiesPendingReview: 2,
      legacyGenderQueued: 2,
    });

    const status = await sql`
      SELECT status::text AS status, count(*)::int AS n FROM entities GROUP BY status ORDER BY status`;
    expect(status.map((s) => [s.status, s.n])).toEqual([
      ["ACTIVE", 6],
      ["PENDING_REVIEW", 2],
    ]);
    const stillPending = await sql`
      SELECT e.legacy_id FROM moderation_queue m JOIN entities e ON e.id = m.entity_id
      WHERE m.reason = 'LEGACY_GENDER' AND m.status = 'PENDING' ORDER BY e.legacy_id`;
    expect(stillPending.map((r) => r.legacy_id)).toEqual(
      [SYNTHETIC.entityIds.myth, SYNTHETIC.entityIds.noimg].sort()
    );

    // execucao sem a flag depois nao rebaixa
    const again = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      backupRoot: false,
      now: NOW,
    });
    expect(again.pending.entitiesActivated).toBe(6);
  });
});

describe("migrateFromSqlite: cenarios de borda", () => {
  it("pacto orfao derruba a verificacao e reverte a transacao inteira", async () => {
    const { url, sql } = await freshDb("arqon_migorphan");
    try {
      const { migrateFromSqlite } = await migrator();
      const report = await migrateFromSqlite({
        sqlitePath: sqliteWithOrphan,
        databaseUrl: url,
        backupRoot: false,
        now: NOW,
      });
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/pactos por guild/);
      expect(report.pending.orphanPacts).toBe(1);
      const g1 = report.verification.pactsPerGuild.find((g) => g.guildId === "g1");
      expect(g1).toEqual({ guildId: "g1", source: 4, destination: 3 });

      const [{ e, p, g }] = await sql`
        SELECT (SELECT count(*) FROM entities)::int AS e, (SELECT count(*) FROM pacts)::int AS p,
               (SELECT count(*) FROM guilds)::int AS g`;
      expect([e, p, g]).toEqual([0, 0, 0]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("coexiste com entidades existentes: slug em conflito ganha sufixo e ranks seguem o maior existente", async () => {
    const { url, sql } = await freshDb("arqon_migcoexist");
    try {
      await sql`
        INSERT INTO entities (slug, name, name_normalized, universe, popularity_rank)
        VALUES ('alpha', 'Alpha Outro', 'alpha outro', 'ANIME', 100)`;
      const { migrateFromSqlite } = await migrator();
      const report = await migrateFromSqlite({
        sqlitePath: sqliteFile,
        databaseUrl: url,
        backupRoot: false,
        now: NOW,
      });
      expect(report.ok).toBe(true);
      expect(report.pending.slugRenamed).toBe(1);

      const alpha = await sql`
        SELECT slug, popularity_rank FROM entities WHERE legacy_id = ${SYNTHETIC.entityIds.alpha}`;
      expect(alpha[0].slug).toMatch(/^alpha-[0-9a-f]{8}$/);
      expect(alpha[0].popularity_rank).toBe(101);
      const [{ n }] = await sql`
        SELECT (count(popularity_rank) - count(DISTINCT popularity_rank))::int AS n FROM entities`;
      expect(n).toBe(0);

      // idempotente tambem com o conflito de slug
      const second = await migrateFromSqlite({
        sqlitePath: sqliteFile,
        databaseUrl: url,
        backupRoot: false,
        now: NOW,
      });
      expect(second.ok).toBe(true);
      expect(second.tables.entities.inserted).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("falha com mensagem clara quando as migrations nao foram aplicadas", async () => {
    const { url } = await pg.createDatabase("arqon_migempty");
    const { migrateFromSqlite } = await migrator();
    const report = await migrateFromSqlite({
      sqlitePath: sqliteFile,
      databaseUrl: url,
      backupRoot: false,
    });
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/db:migrate/);
  });
});

describe("CLI", () => {
  const script = path.join(ROOT, "src", "scripts", "migrateFromSqlite.ts");
  const run = async (args: string[]) => {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--import", "tsx", script, ...args],
        {
          cwd: ROOT,
          timeout: 90_000,
          env: { ...process.env, DATABASE_URL: "" },
        }
      );
      return { code: 0, stdout };
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? "" };
    }
  };

  it("--dry-run imprime relatorio JSON e sai com 0; falha de verificacao sai com 1", async () => {
    const { url, sql } = await freshDb("arqon_migcli");
    try {
      const backupDir = path.join(tmp, "cli-backups");
      const ok = await run([
        "--dry-run",
        `--sqlite=${sqliteFile}`,
        `--database-url=${url}`,
        `--backup-dir=${backupDir}`,
      ]);
      expect(ok.code).toBe(0);
      const report = JSON.parse(ok.stdout) as {
        ok: boolean;
        dryRun: boolean;
        tables: Record<string, { source: number }>;
      };
      expect(report).toMatchObject({ ok: true, dryRun: true });
      expect(report.tables.pacts.source).toBe(5);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM entities`;
      expect(n).toBe(0);

      const bad = await run([
        `--sqlite=${sqliteWithOrphan}`,
        `--database-url=${url}`,
        `--backup-dir=${backupDir}`,
      ]);
      expect(bad.code).toBe(1);
      expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false });
      const [{ n: n2 }] = await sql`SELECT count(*)::int AS n FROM entities`;
      expect(n2).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 180_000);

  it("flag desconhecida sai com 1", async () => {
    const res = await run(["--nope"]);
    expect(res.code).toBe(1);
  });
});
