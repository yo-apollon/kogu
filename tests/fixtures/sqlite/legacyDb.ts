import Database from "better-sqlite3";

/** DDL legado, copiado de src/database/index.ts (esse arquivo abre arqon_local.db ao ser importado). */
export const LEGACY_DDL = `
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY,
    prefix TEXT DEFAULT '$' NOT NULL,
    language TEXT DEFAULT 'pt-BR' NOT NULL,
    gamemode INTEGER DEFAULT 1 NOT NULL,
    base_rolls INTEGER DEFAULT 10 NOT NULL,
    claim_cooldown_minutes INTEGER DEFAULT 180 NOT NULL,
    claim_window_seconds INTEGER DEFAULT 45 NOT NULL,
    snipe_protection_level INTEGER DEFAULT 0 NOT NULL,
    snipe_protection_seconds INTEGER DEFAULT 8 NOT NULL,
    aether_snipe_protection_level INTEGER DEFAULT 0 NOT NULL,
    aether_snipe_protection_seconds INTEGER DEFAULT 8 NOT NULL,
    pact_limit INTEGER DEFAULT 8100 NOT NULL,
    server_aether_scrap INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    preferred_language TEXT DEFAULT 'pt-BR' NOT NULL,
    roll_resets INTEGER DEFAULT 0 NOT NULL,
    is_vip INTEGER DEFAULT 0 NOT NULL,
    vip_tier INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    aether_balance INTEGER DEFAULT 0 NOT NULL,
    astral_shards INTEGER DEFAULT 0 NOT NULL,
    rolls_remaining INTEGER DEFAULT 10 NOT NULL,
    stacked_rolls INTEGER DEFAULT 0 NOT NULL,
    pacts_available INTEGER DEFAULT 1 NOT NULL,
    embed_color TEXT DEFAULT '#5865F2',
    relic_bronze INTEGER DEFAULT 0 NOT NULL,
    relic_silver INTEGER DEFAULT 0 NOT NULL,
    relic_gold INTEGER DEFAULT 0 NOT NULL,
    relic_sapphire INTEGER DEFAULT 0 NOT NULL,
    relic_ruby INTEGER DEFAULT 0 NOT NULL,
    relic_emerald INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    original_name TEXT,
    universe TEXT NOT NULL,
    type TEXT DEFAULT 'CHARACTER' NOT NULL,
    gender TEXT DEFAULT 'FEMALE' NOT NULL,
    franchise TEXT NOT NULL,
    description TEXT,
    images_json TEXT DEFAULT '[]' NOT NULL,
    base_aether INTEGER DEFAULT 100 NOT NULL,
    popularity_rank INTEGER DEFAULT 99999 NOT NULL,
    likes_count INTEGER DEFAULT 0 NOT NULL,
    claims_count INTEGER DEFAULT 0 NOT NULL,
    base_atk INTEGER DEFAULT 50 NOT NULL,
    base_def INTEGER DEFAULT 50 NOT NULL,
    base_spd INTEGER DEFAULT 50 NOT NULL,
    base_hp INTEGER DEFAULT 100 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pacts (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    variant TEXT DEFAULT 'STANDARD' NOT NULL,
    awakening_keys INTEGER DEFAULT 0 NOT NULL,
    is_soulmate INTEGER DEFAULT 0 NOT NULL,
    custom_image TEXT,
    alias2 TEXT,
    note TEXT,
    embed_color TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    bound_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    UNIQUE(guild_id, entity_id)
  );

  CREATE TABLE IF NOT EXISTS wishes (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    is_starwish INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS disabled_series (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    series_name TEXT NOT NULL,
    is_server_wide INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_aliases (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    alias1 TEXT,
    alias2 TEXT,
    custom_note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS character_suggestions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    character_name TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' NOT NULL,
    anilist_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  );
`;

/** Colunas adicionadas depois por scripts/migrateColumns.ts. */
const LATE_COLUMNS = [
  "ALTER TABLE users ADD COLUMN daily_imports_count INTEGER DEFAULT 0 NOT NULL",
  "ALTER TABLE users ADD COLUMN last_import_reset TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL",
];

export const TS_LITERAL = "CURRENT_TIMESTAMP";
const ANILIST_IMG = (id: string) =>
  `https://s4.anilist.co/file/anilistcdn/character/large/${id}.png`;

export const SYNTHETIC = {
  guilds: ["g1", "g2"],
  /** legacy id -> dados esperados nos asserts */
  entityIds: {
    alpha: "ent-alpha",
    beta: "ent-beta",
    gamma: "ent-gamma",
    delta: "ent-delta",
    excal: "ent-excal",
    myth: "ent-myth",
    noimg: "ent-noimg",
    eowyn: "ent-eowyn",
  },
} as const;

/** SQLite legado sintetico cobrindo os casos de borda da migracao. */
export function buildSyntheticLegacyDb(
  file: string,
  extra?: (db: Database.Database) => void
): void {
  const db = new Database(file);
  try {
    db.exec(LEGACY_DDL);
    for (const stmt of LATE_COLUMNS) db.exec(stmt);

    const ins = {
      guild: db.prepare("INSERT INTO guilds (id, base_rolls, created_at) VALUES (?, ?, ?)"),
      user: db.prepare(
        "INSERT INTO users (id, username, is_vip, vip_tier, daily_imports_count, last_import_reset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ),
      profile: db.prepare(
        "INSERT INTO guild_profiles (id, user_id, guild_id, aether_balance, rolls_remaining, stacked_rolls, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ),
      entity: db.prepare(
        `INSERT INTO entities (id, slug, name, original_name, universe, type, gender, franchise, description,
           images_json, base_aether, popularity_rank, likes_count, base_atk, base_def, base_spd, base_hp, created_at)
         VALUES (@id, @slug, @name, @original_name, @universe, @type, @gender, @franchise, @description,
           @images_json, @base_aether, @popularity_rank, @likes_count, 70, 60, 50, 90, @created_at)`
      ),
      pact: db.prepare(
        "INSERT INTO pacts (id, guild_id, user_id, entity_id, variant, awakening_keys, alias2, note, sort_order, bound_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ),
      alias: db.prepare(
        "INSERT INTO custom_aliases (id, guild_id, user_id, entity_id, alias1, alias2, custom_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ),
      wish: db.prepare(
        "INSERT INTO wishes (id, guild_id, user_id, entity_id, is_starwish, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      disabled: db.prepare(
        "INSERT INTO disabled_series (id, guild_id, user_id, series_name, is_server_wide, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ),
      suggestion: db.prepare(
        "INSERT INTO character_suggestions (id, guild_id, user_id, character_name, status, anilist_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ),
    };

    ins.guild.run("g1", 10, TS_LITERAL);
    ins.guild.run("g2", 5, "2024-03-01 12:00:00");

    ins.user.run("u1", "alice", 1, 2, 3, TS_LITERAL, TS_LITERAL);
    ins.user.run("u2", "bob", 0, 0, 0, TS_LITERAL, "2024-01-02 03:04:05");
    ins.user.run("u3", "carol", 0, 0, 0, TS_LITERAL, TS_LITERAL); // sem perfil

    ins.profile.run("g1:u1", "u1", "g1", 666, 6, 5, TS_LITERAL); // usou 4 de 10
    ins.profile.run("g1:u2", "u2", "g1", 300, 12, 0, TS_LITERAL); // mais que base_rolls -> usado 0
    ins.profile.run("g2:u1", "u1", "g2", 10, 5, 1, TS_LITERAL);

    const e = SYNTHETIC.entityIds;
    const entity = (row: Record<string, unknown>) =>
      ins.entity.run({
        original_name: null,
        description: null,
        likes_count: 0,
        created_at: TS_LITERAL,
        ...row,
      });
    // franchise repetida com caixa diferente: "Naruto" / "NARUTO"
    entity({
      id: e.alpha,
      slug: "alpha",
      name: "Alpha",
      universe: "ANIME",
      type: "CHARACTER",
      gender: "FEMALE",
      franchise: "Naruto",
      images_json: JSON.stringify([ANILIST_IMG("b1"), ANILIST_IMG("b1b")]),
      base_aether: 500,
      popularity_rank: 1,
    });
    // rank duplicado (1) com aether menor: vem depois de alpha
    entity({
      id: e.beta,
      slug: "beta",
      name: "Beta",
      universe: "ANIME",
      type: "CHARACTER",
      gender: "MALE",
      franchise: "NARUTO",
      images_json: JSON.stringify([ANILIST_IMG("b2")]),
      base_aether: 300,
      popularity_rank: 1,
      created_at: "2024-05-01 10:00:00",
    });
    entity({
      id: e.gamma,
      slug: "gamma",
      name: "Gamma",
      universe: "ANIME",
      type: "CHARACTER",
      gender: "MALE",
      franchise: "Bleach",
      images_json: JSON.stringify([ANILIST_IMG("b3")]),
      base_aether: 400,
      popularity_rank: 2,
      created_at: "not-a-date",
    });
    entity({
      id: e.delta,
      slug: "delta",
      name: "Delta",
      universe: "GAME",
      type: "CHARACTER",
      gender: "MALE",
      franchise: "Elden Ring",
      images_json: JSON.stringify(["https://images.igdb.com/igdb/image/upload/d.png"]),
      base_aether: 200,
      popularity_rank: 5,
    });
    entity({
      id: e.excal,
      slug: "excalibur",
      name: "Excalibur",
      universe: "WEAPON",
      type: "WEAPON",
      gender: "ITEM",
      franchise: "Fate",
      images_json: JSON.stringify([ANILIST_IMG("b497")]),
      base_aether: 1100,
      popularity_rank: 3,
    });
    entity({
      id: e.myth,
      slug: "zeus",
      name: "Zeus",
      universe: "MYTHOLOGY",
      type: "CHARACTER",
      gender: "ALIEN",
      franchise: "Mitologia Grega",
      images_json: JSON.stringify([ANILIST_IMG("b4"), "nao-e-url"]),
      base_aether: 150,
      popularity_rank: 99999,
    });
    entity({
      id: e.noimg,
      slug: "sem-imagem",
      name: "Sem Imagem",
      universe: "ANIME",
      type: "CHARACTER",
      gender: "FEMALE",
      franchise: "Bleach",
      images_json: "[]",
      base_aether: 100,
      popularity_rank: 99999,
    });
    entity({
      id: e.eowyn,
      slug: "eowyn",
      name: "Éowyn Ünder",
      original_name: "エオウィン",
      universe: "CINEMA",
      type: "CHARACTER",
      gender: "FEMALE",
      franchise: "O Senhor dos Anéis",
      images_json: JSON.stringify([ANILIST_IMG("b5")]),
      base_aether: 250,
      popularity_rank: 99999,
    });

    // pactos em 2 guilds (5 no total)
    ins.pact.run(
      "g1:ent-alpha",
      "g1",
      "u1",
      e.alpha,
      "HOLO",
      2,
      null,
      "nota do pacto",
      1,
      TS_LITERAL
    );
    ins.pact.run(
      "g1:ent-gamma",
      "g1",
      "u1",
      e.gamma,
      "STANDARD",
      0,
      "apelido2 do pacto",
      null,
      2,
      "2024-06-01 00:00:00"
    );
    ins.pact.run("g1:ent-delta", "g1", "u2", e.delta, "FOIL", 1, null, null, 0, TS_LITERAL);
    ins.pact.run("g2:ent-alpha", "g2", "u1", e.alpha, "STANDARD", 0, null, null, 0, TS_LITERAL);
    ins.pact.run("g2:ent-excal", "g2", "u1", e.excal, "ASTRAL", 4, null, null, 0, TS_LITERAL);

    // custom_aliases: mescla com o pacto g1:u1:alpha; a linha de u2 nao tem pacto (orfa)
    ins.alias.run(
      "a1",
      "g1",
      "u1",
      e.alpha,
      "Alfa",
      "Alfinha",
      "nota custom",
      "2024-01-01 00:00:00"
    );
    ins.alias.run("a2", "g1", "u2", e.alpha, "Orfa", null, null, "2024-01-01 00:00:00");
    ins.alias.run(
      "a3",
      "g1",
      "u1",
      e.gamma,
      null,
      "alias2 custom",
      "nota do gamma",
      "2024-01-01 00:00:00"
    );

    // wishes: normal, starwish, duplicada e de usuario/perfil inexistente (placeholder)
    ins.wish.run("w1", "g1", "u2", e.gamma, 1, TS_LITERAL);
    ins.wish.run("w2", "g1", "u2", e.gamma, 0, TS_LITERAL);
    ins.wish.run("w3", "g1", "u9", e.alpha, 0, "2024-02-02 02:02:02");

    // disabled_series: casa ("NARUTO" == franquia/serie "Naruto"), casa acentos/caixa, nao casa
    ins.disabled.run("d1", "g1", "u1", "NARUTO", 0, TS_LITERAL);
    ins.disabled.run("d2", "g1", "u2", "elden  ring!", 1, TS_LITERAL);
    ins.disabled.run("d3", "g1", "u1", "Serie Que Nao Existe", 0, TS_LITERAL);

    ins.suggestion.run("s1", "g1", "u1", "Algum Personagem", "PENDING", 1234, TS_LITERAL);

    extra?.(db);
  } finally {
    db.close();
  }
}
