import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import path from "path";

// Cria banco SQLite local de alta velocidade caso o Postgres não esteja ativo
const sqlite = new Database(path.resolve("./arqon_local.db"));
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });
export { schema };

// Criação automática de tabelas locais caso não existam
sqlite.exec(`
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
`);



