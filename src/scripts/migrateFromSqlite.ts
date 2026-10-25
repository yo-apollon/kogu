/**
 * Migra o SQLite legado (arqon_local.db) para o Postgres.
 *
 * Uso: npm run migrate:sqlite -- [--dry-run] [--sqlite=<path>] [--database-url=<url>]
 *                                [--activate-legacy] [--backup-dir=<dir>]
 *
 * - O SQLite e aberto SEMPRE readonly. Antes de ler, .db/-wal/-shm sao copiados para
 *   .cache/backups/<timestamp>/ (nao altera nem apaga o original).
 * - Tudo roda em UMA transacao. --dry-run executa tudo (inclusive a verificacao) e da rollback.
 * - Idempotente: ON CONFLICT / NOT EXISTS em todos os inserts; segunda execucao insere 0 linhas.
 *   Linhas que o jogo altera depois (saldos, pactos, status, ranks ja atribuidos) nunca sao sobrescritas.
 * - Saida: relatorio JSON em stdout (progresso vai para stderr). Exit code 1 se a verificacao falhar.
 *
 * Decisoes de mapeamento (F1/F4):
 * - universe: ANIME/GAME/CINEMA copiados. MYTHOLOGY -> ANIME (type CHARACTER). WEAPON -> type WEAPON e
 *   universe ANIME quando a imagem vem do AniList (personagens/itens de anime/manga) ou GAME caso contrario.
 * - gender: copiado (FEMALE/MALE/NONBINARY/ITEM; qualquer outro valor vira UNKNOWN). A coluna legada pode
 *   ter sido sorteada, entao toda entidade entra PENDING_REVIEW com moderation_queue LEGACY_GENDER.
 *   `--activate-legacy` marca ACTIVE as entidades com imagem valida e genero MALE/FEMALE (ou ITEM de
 *   type WEAPON, que nao e sorteado); essas nao geram LEGACY_GENDER.
 * - Franquias/series: uma franquia e uma serie LEGACY (series_external_ids source LEGACY, chave = nome
 *   normalizado da franquia) por valor distinto de `entities.franchise` (agrupado por nome normalizado).
 * - popularity_rank: row_number sobre (rank legado, favoritos, aether, nome), apenas para entidades
 *   legadas ainda sem rank, em sequencia apos o maior rank existente. popularity_score/tier/roll_weight
 *   recebem valores iniciais a partir do rank; o job de rerank os recalcula depois.
 * - pacts: alias = custom_aliases.alias1; alias2/note = valor do pacto, senao de custom_aliases.
 *   aether_at_bind = round(base_aether * VARIANT_MULTIPLIER[variant]).
 * - disabled_series: casa por nome normalizado com series.title e, depois, franchises.name.
 *   Sem match vai para moderation_queue UNMATCHED_DISABLED_SERIES.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import postgres from "postgres";
import {
  CARD_VARIANTS,
  POPULARITY_WEIGHT,
  TIER_TOP_PERCENT,
  TIER_WEIGHT,
  VARIANT_MULTIPLIER,
  type CardVariant,
  type EntityTier,
} from "../config/gacha.js";
import { nameTokens, normalizeName, slugify } from "../lib/text/normalize.js";

// ---------------------------------------------------------------------------
// Tipos publicos
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  sqlitePath: string;
  databaseUrl: string;
  dryRun?: boolean;
  /** Marca ACTIVE as entidades legadas elegiveis (imagem + genero MALE/FEMALE). */
  activateLegacy?: boolean;
  /** Pasta raiz dos backups; `false` desliga. Padrao: <cwd>/.cache/backups. */
  backupRoot?: string | false;
  /** Relogio injetavel (datas invalidas viram este valor). */
  now?: Date;
  log?: (message: string) => void;
}

export interface TableReport {
  /** Linhas na origem (SQLite) ou itens planejados. */
  source: number;
  /** Linhas no destino dentro do escopo migrado, apos a execucao. */
  destination: number;
  /** Linhas criadas nesta execucao. */
  inserted: number;
}

export interface MigrationReport {
  ok: boolean;
  dryRun: boolean;
  activateLegacy: boolean;
  sqlite: string;
  backup: { dir: string; files: string[] } | null;
  startedAt: string;
  finishedAt: string;
  tables: Record<string, TableReport>;
  verification: {
    ok: boolean;
    pactsPerGuild: Array<{ guildId: string; source: number; destination: number }>;
    popularityRanksUnique: boolean;
  };
  pending: {
    entitiesPendingReview: number;
    entitiesActivated: number;
    legacyGenderQueued: number;
    gendersUnconfirmed: number;
    entitiesWithoutImage: number;
    invalidImageUrls: number;
    imageJsonParseErrors: number;
    universeRemapped: Record<string, number>;
    sourceEntitiesSharingRank: number;
    datesReplaced: Record<string, number>;
    placeholderGuilds: number;
    placeholderUsers: number;
    placeholderMembers: number;
    orphanPacts: number;
    orphanWishes: number;
    orphanAliases: number;
    unmatchedDisabledSeries: { count: number; names: string[] };
    slugRenamed: number;
    duplicatesCollapsed: Record<string, number>;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Sql = postgres.TransactionSql;

class RollbackSignal extends Error {
  constructor() {
    super("dry-run rollback");
  }
}

class VerificationError extends Error {}

const J = (value: unknown): string => JSON.stringify(value);
const CHUNK = 2000;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return typeof v === "number" ? String(v) : null;
  const t = v.trim();
  return t === "" ? null : t;
}

function int(v: unknown, fallback: number, min = Number.NEGATIVE_INFINITY): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  const r = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(min, Math.min(r, 2_147_483_647));
}

function bool(v: unknown): boolean {
  return v === 1 || v === true || v === "1" || v === "true" || v === "TRUE";
}

function sha(input: string, len = 6): string {
  return createHash("sha1").update(input).digest("hex").slice(0, len);
}

const SQLITE_UTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Converte datas do SQLite. "CURRENT_TIMESTAMP" literal, vazio ou invalido viram `now` (e sao contados). */
function makeDateParser(now: Date, replaced: Record<string, number>) {
  return (value: unknown, tag: string): Date => {
    const fallback = () => {
      replaced[tag] = (replaced[tag] ?? 0) + 1;
      return now;
    };
    let d: Date | null = null;
    if (typeof value === "number" && Number.isFinite(value)) {
      d = new Date(value < 1e11 ? value * 1000 : value);
    } else if (typeof value === "string") {
      const t = value.trim();
      if (t === "" || t.toUpperCase() === "CURRENT_TIMESTAMP") return fallback();
      if (SQLITE_UTC.test(t)) d = new Date(`${t.replace(" ", "T")}Z`);
      else if (/^\d{9,13}$/.test(t)) d = new Date(t.length <= 10 ? Number(t) * 1000 : Number(t));
      else d = new Date(t);
    }
    if (!d || Number.isNaN(d.getTime())) return fallback();
    const year = d.getUTCFullYear();
    return year < 1990 || year > 2100 ? fallback() : d;
  };
}

const ENTITY_TYPES = new Set(["CHARACTER", "WEAPON", "COMPANION", "DOMAIN"]);
const ENTITY_GENDERS = new Set(["FEMALE", "MALE", "NONBINARY", "ITEM", "UNKNOWN"]);
const SUGGESTION_STATUS = new Set(["PENDING", "APPROVED", "REJECTED"]);

// ---------------------------------------------------------------------------
// Backup e leitura do SQLite (readonly)
// ---------------------------------------------------------------------------

function backupSqlite(sqlitePath: string, root: string): { dir: string; files: string[] } {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, stamp);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = `${sqlitePath}${suffix}`;
    if (existsSync(src)) {
      const dest = path.join(dir, path.basename(src));
      copyFileSync(src, dest);
      files.push(dest);
    }
  }
  return { dir, files };
}

function readLegacy(sqlitePath: string): Record<string, Row[]> {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    const present = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Row[]).map((r) =>
        String(r.name)
      )
    );
    const read = (table: string): Row[] =>
      present.has(table) ? (db.prepare(`SELECT * FROM "${table}"`).all() as Row[]) : [];
    return {
      guilds: read("guilds"),
      users: read("users"),
      guild_profiles: read("guild_profiles"),
      entities: read("entities"),
      pacts: read("pacts"),
      wishes: read("wishes"),
      disabled_series: read("disabled_series"),
      custom_aliases: read("custom_aliases"),
      character_suggestions: read("character_suggestions"),
    };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Transformacao (puro)
// ---------------------------------------------------------------------------

interface SrcEntity {
  legacyId: string;
  slug: string;
  name: string;
  nameNative: string | null;
  nameNormalized: string;
  universe: "ANIME" | "GAME" | "CINEMA";
  type: string;
  gender: string;
  franchiseKey: string;
  franchiseName: string;
  description: string | null;
  images: string[];
  baseAether: number;
  legacyRank: number;
  likes: number;
  claims: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  createdAt: Date;
  eligible: boolean;
}

function parseImages(raw: unknown, counters: { invalid: number; parseErrors: number }): string[] {
  const text = typeof raw === "string" ? raw : "";
  if (text.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    counters.parseErrors++;
    return [];
  }
  if (!Array.isArray(parsed)) {
    counters.parseErrors++;
    return [];
  }
  const out: string[] = [];
  for (const item of parsed) {
    const candidate =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? ((item as Row).url ?? (item as Row).large ?? (item as Row).image)
          : null;
    const url = typeof candidate === "string" ? candidate.trim() : "";
    if (/^https?:\/\/\S+$/i.test(url) && url.length <= 2048) {
      if (!out.includes(url)) out.push(url);
    } else {
      counters.invalid++;
    }
  }
  return out;
}

function mapUniverse(
  rawUniverse: string,
  type: string,
  images: string[]
): { universe: SrcEntity["universe"]; type: string; remapped: string | null } {
  const u = rawUniverse.toUpperCase();
  if (u === "ANIME" || u === "GAME" || u === "CINEMA") {
    const t = type === "WEAPON" ? "WEAPON" : type;
    return { universe: u, type: t, remapped: null };
  }
  if (u === "WEAPON" || type === "WEAPON") {
    const fromAniList = images.some((i) => /(^|\/\/)s\d+\.anilist\.co\//i.test(i));
    const universe = fromAniList ? "ANIME" : "GAME";
    return { universe, type: "WEAPON", remapped: `${u}->${universe}` };
  }
  // MYTHOLOGY e desconhecidos: personagem de anime (a origem dos dados legados e o AniList).
  return { universe: "ANIME", type, remapped: `${u || "EMPTY"}->ANIME` };
}

function tierFor(index: number, total: number): EntityTier {
  const p = (index + 0.5) / total;
  if (p < TIER_TOP_PERCENT.MYTHIC) return "MYTHIC";
  if (p < TIER_TOP_PERCENT.LEGENDARY) return "LEGENDARY";
  if (p < TIER_TOP_PERCENT.EPIC) return "EPIC";
  if (p < TIER_TOP_PERCENT.RARE) return "RARE";
  return "COMMON";
}

function lowerCmp(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Ordem para o row_number: rank legado, favoritos, aether, nome, id (desempate estavel). */
function compareForRank(a: SrcEntity, b: SrcEntity): number {
  return (
    a.legacyRank - b.legacyRank ||
    b.likes - a.likes ||
    b.baseAether - a.baseAether ||
    lowerCmp(a.name, b.name) ||
    lowerCmp(a.legacyId, b.legacyId)
  );
}

// ---------------------------------------------------------------------------
// Migracao
// ---------------------------------------------------------------------------

async function scalar(q: PromiseLike<postgres.RowList<Row[]>>): Promise<number> {
  const rows = await q;
  return Number(rows[0]?.n ?? 0);
}

export async function migrateFromSqlite(opts: MigrateOptions): Promise<MigrationReport> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const activateLegacy = opts.activateLegacy === true;
  const startedAt = new Date().toISOString();
  const sqlitePath = path.resolve(opts.sqlitePath);

  if (!existsSync(sqlitePath)) throw new Error(`SQLite nao encontrado: ${sqlitePath}`);

  // 1. Backup antes de qualquer leitura.
  let backup: MigrationReport["backup"] = null;
  if (opts.backupRoot !== false) {
    backup = backupSqlite(sqlitePath, opts.backupRoot ?? path.resolve(".cache", "backups"));
    log(`Backup: ${backup.dir} (${backup.files.length} arquivo(s))`);
  }

  // 2. Leitura readonly.
  const legacy = readLegacy(sqlitePath);
  log(
    `Origem: ${legacy.entities.length} entidades, ${legacy.pacts.length} pactos, ${legacy.guilds.length} guild(s)`
  );

  const datesReplaced: Record<string, number> = {};
  const date = makeDateParser(now, datesReplaced);
  const imgCounters = { invalid: 0, parseErrors: 0 };
  const universeRemapped: Record<string, number> = {};
  const duplicatesCollapsed: Record<string, number> = {};
  const collapsed = (k: string, n = 1) => {
    duplicatesCollapsed[k] = (duplicatesCollapsed[k] ?? 0) + n;
  };

  // --- entidades ---
  const entities: SrcEntity[] = [];
  const seenLegacyIds = new Set<string>();
  for (const r of legacy.entities) {
    const legacyId = str(r.id);
    if (!legacyId || seenLegacyIds.has(legacyId)) continue;
    seenLegacyIds.add(legacyId);
    const name = str(r.name) ?? str(r.slug) ?? legacyId;
    const images = parseImages(r.images_json, imgCounters);
    const typeRaw = (str(r.type) ?? "CHARACTER").toUpperCase();
    const mapped = mapUniverse(
      str(r.universe) ?? "",
      ENTITY_TYPES.has(typeRaw) ? typeRaw : "CHARACTER",
      images
    );
    if (mapped.remapped)
      universeRemapped[mapped.remapped] = (universeRemapped[mapped.remapped] ?? 0) + 1;
    const genderRaw = (str(r.gender) ?? "UNKNOWN").toUpperCase();
    const gender = ENTITY_GENDERS.has(genderRaw)
      ? genderRaw
      : genderRaw === "NON_BINARY" || genderRaw === "OTHER"
        ? "NONBINARY"
        : "UNKNOWN";
    const franchiseName = str(r.franchise) ?? "Desconhecida";
    const slug = str(r.slug)
      ? slugify(String(r.slug)) || String(r.slug)
      : slugify(name) || `legacy-${sha(legacyId)}`;
    const tokens = nameTokens(name).join(" ");
    const eligible =
      images.length > 0 &&
      (gender === "MALE" || gender === "FEMALE" || (gender === "ITEM" && mapped.type === "WEAPON"));
    entities.push({
      legacyId,
      slug,
      name,
      nameNative: str(r.original_name),
      nameNormalized: tokens === "" ? name.toLowerCase() : tokens,
      universe: mapped.universe,
      type: mapped.type,
      gender,
      franchiseKey: normalizeName(franchiseName) || "desconhecida",
      franchiseName,
      description: str(r.description),
      images,
      baseAether: int(r.base_aether, 100, 0),
      legacyRank: int(r.popularity_rank, 99999),
      likes: int(r.likes_count, 0, 0),
      claims: int(r.claims_count, 0, 0),
      atk: int(r.base_atk, 50),
      def: int(r.base_def, 50),
      spd: int(r.base_spd, 50),
      hp: int(r.base_hp, 100),
      createdAt: date(r.created_at, "entities.created_at"),
      eligible,
    });
  }
  const entityByLegacy = new Map(entities.map((e) => [e.legacyId, e]));

  // slugs unicos dentro da origem
  const slugCount = new Map<string, number>();
  for (const e of entities) {
    const n = slugCount.get(e.slug) ?? 0;
    slugCount.set(e.slug, n + 1);
    if (n > 0) e.slug = `${e.slug}-${sha(e.legacyId)}`;
  }

  const rankCounts = new Map<number, number>();
  for (const e of entities) rankCounts.set(e.legacyRank, (rankCounts.get(e.legacyRank) ?? 0) + 1);
  const sourceEntitiesSharingRank = [...rankCounts.values()]
    .filter((n) => n > 1)
    .reduce((a, b) => a + b, 0);

  // --- franquias / series ---
  interface FranchiseGroup {
    key: string;
    name: string;
    slug: string;
    universe: SrcEntity["universe"];
  }
  const namesByKey = new Map<string, Map<string, number>>();
  const universesByKey = new Map<string, Map<SrcEntity["universe"], number>>();
  for (const e of entities) {
    const names = namesByKey.get(e.franchiseKey) ?? new Map<string, number>();
    names.set(e.franchiseName, (names.get(e.franchiseName) ?? 0) + 1);
    namesByKey.set(e.franchiseKey, names);
    const us = universesByKey.get(e.franchiseKey) ?? new Map<SrcEntity["universe"], number>();
    us.set(e.universe, (us.get(e.universe) ?? 0) + 1);
    universesByKey.set(e.franchiseKey, us);
  }
  const groups: FranchiseGroup[] = [];
  const usedFranchiseSlugs = new Set<string>();
  for (const key of [...namesByKey.keys()].sort()) {
    const name = [...namesByKey.get(key)!.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        Number(a[0] === a[0].toUpperCase()) - Number(b[0] === b[0].toUpperCase()) ||
        (a[0] < b[0] ? -1 : 1)
    )[0][0];
    let slug = slugify(name) || `n-${sha(key, 8)}`;
    if (usedFranchiseSlugs.has(slug)) slug = `${slug}-${sha(key)}`;
    usedFranchiseSlugs.add(slug);
    const universe = [...universesByKey.get(key)!.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
    )[0][0];
    groups.push({ key, name, slug, universe });
  }
  const groupByKey = new Map(groups.map((g) => [g.key, g]));

  // --- guilds / users / members ---
  const guildRows = new Map<string, Row>();
  for (const g of legacy.guilds) {
    const id = str(g.id);
    if (id && !guildRows.has(id)) guildRows.set(id, g);
  }
  const userRows = new Map<string, Row>();
  for (const u of legacy.users) {
    const id = str(u.id);
    if (id && !userRows.has(id)) userRows.set(id, u);
  }

  const profiles = new Map<string, Row>();
  for (const p of legacy.guild_profiles) {
    const g = str(p.guild_id);
    const u = str(p.user_id);
    if (!g || !u) continue;
    const key = `${g}:${u}`;
    if (profiles.has(key)) collapsed("guild_members");
    else profiles.set(key, p);
  }

  // pactos (so os de entidade existente entram; o resto e pendencia e derruba a verificacao)
  const sourcePactsPerGuild = new Map<string, number>();
  for (const p of legacy.pacts) {
    const g = str(p.guild_id);
    if (g) sourcePactsPerGuild.set(g, (sourcePactsPerGuild.get(g) ?? 0) + 1);
  }

  const aliasByPact = new Map<string, Row>();
  for (const a of [...legacy.custom_aliases].sort(
    (x, y) =>
      lowerCmp(String(x.created_at ?? ""), String(y.created_at ?? "")) ||
      lowerCmp(String(x.id ?? ""), String(y.id ?? ""))
  )) {
    const key = `${str(a.guild_id)}:${str(a.user_id)}:${str(a.entity_id)}`;
    aliasByPact.set(key, a); // o mais recente prevalece
  }

  interface SrcPact {
    guildId: string;
    userId: string;
    entityLegacyId: string;
    variant: CardVariant;
    awakeningKeys: number;
    isSoulmate: boolean;
    customImage: string | null;
    alias: string | null;
    alias2: string | null;
    note: string | null;
    embedColor: string | null;
    sortOrder: number;
    aetherAtBind: number;
    boundAt: Date;
  }
  const pacts: SrcPact[] = [];
  const pactKeys = new Set<string>();
  const usedAliasKeys = new Set<string>();
  let orphanPacts = 0;
  for (const p of legacy.pacts) {
    const guildId = str(p.guild_id);
    const userId = str(p.user_id);
    const entityLegacyId = str(p.entity_id);
    const ent = entityLegacyId ? entityByLegacy.get(entityLegacyId) : undefined;
    if (!guildId || !userId || !entityLegacyId || !ent) {
      orphanPacts++;
      continue;
    }
    const pk = `${guildId}:${entityLegacyId}`;
    if (pactKeys.has(pk)) {
      collapsed("pacts");
      continue;
    }
    pactKeys.add(pk);
    const variantRaw = (str(p.variant) ?? "STANDARD").toUpperCase();
    const variant: CardVariant = (CARD_VARIANTS as readonly string[]).includes(variantRaw)
      ? (variantRaw as CardVariant)
      : "STANDARD";
    const aliasKey = `${guildId}:${userId}:${entityLegacyId}`;
    const custom = aliasByPact.get(aliasKey);
    if (custom) usedAliasKeys.add(aliasKey);
    pacts.push({
      guildId,
      userId,
      entityLegacyId,
      variant,
      awakeningKeys: int(p.awakening_keys, 0, 0),
      isSoulmate: bool(p.is_soulmate),
      customImage: str(p.custom_image),
      alias: str(custom?.alias1),
      alias2: str(p.alias2) ?? str(custom?.alias2),
      note: str(p.note) ?? str(custom?.custom_note),
      embedColor: str(p.embed_color),
      sortOrder: int(p.sort_order, 0),
      aetherAtBind: Math.max(0, Math.round(ent.baseAether * VARIANT_MULTIPLIER[variant])),
      boundAt: date(p.bound_at, "pacts.bound_at"),
    });
  }
  const orphanAliases = [...aliasByPact.keys()].filter((k) => !usedAliasKeys.has(k)).length;

  interface SrcWish {
    guildId: string;
    userId: string;
    entityLegacyId: string;
    isStarwish: boolean;
    createdAt: Date;
  }
  const wishes: SrcWish[] = [];
  const wishKeys = new Set<string>();
  let orphanWishes = 0;
  for (const w of legacy.wishes) {
    const guildId = str(w.guild_id);
    const userId = str(w.user_id);
    const entityLegacyId = str(w.entity_id);
    if (!guildId || !userId || !entityLegacyId || !entityByLegacy.has(entityLegacyId)) {
      orphanWishes++;
      continue;
    }
    const k = `${guildId}:${userId}:${entityLegacyId}`;
    if (wishKeys.has(k)) {
      collapsed("wishes");
      continue;
    }
    wishKeys.add(k);
    wishes.push({
      guildId,
      userId,
      entityLegacyId,
      isStarwish: bool(w.is_starwish),
      createdAt: date(w.created_at, "wishes.created_at"),
    });
  }

  interface SrcDisabled {
    legacyId: string;
    guildId: string;
    userId: string;
    seriesName: string;
    isServerWide: boolean;
    createdAt: Date;
  }
  const disabled: SrcDisabled[] = [];
  for (const d of legacy.disabled_series) {
    const guildId = str(d.guild_id);
    const userId = str(d.user_id);
    const seriesName = str(d.series_name);
    if (!guildId || !userId || !seriesName) continue;
    disabled.push({
      legacyId: str(d.id) ?? sha(`${guildId}:${userId}:${seriesName}`),
      guildId,
      userId,
      seriesName,
      isServerWide: bool(d.is_server_wide),
      createdAt: date(d.created_at, "disabled_series.created_at"),
    });
  }

  interface SrcSuggestion {
    guildId: string;
    userId: string;
    characterName: string;
    status: string;
    anilistId: number | null;
    createdAt: Date;
  }
  const suggestions: SrcSuggestion[] = [];
  const suggestionKeys = new Set<string>();
  for (const s of legacy.character_suggestions) {
    const guildId = str(s.guild_id);
    const userId = str(s.user_id);
    const characterName = str(s.character_name);
    if (!guildId || !userId || !characterName) continue;
    const k = `${guildId}:${userId}:${characterName.toLowerCase()}`;
    if (suggestionKeys.has(k)) {
      collapsed("character_suggestions");
      continue;
    }
    suggestionKeys.add(k);
    const statusRaw = (str(s.status) ?? "PENDING").toUpperCase();
    suggestions.push({
      guildId,
      userId,
      characterName,
      status: SUGGESTION_STATUS.has(statusRaw) ? statusRaw : "PENDING",
      anilistId: s.anilist_id === null || s.anilist_id === undefined ? null : int(s.anilist_id, 0),
      createdAt: date(s.created_at, "character_suggestions.created_at"),
    });
  }

  // referencias que nao existem nas tabelas de origem viram placeholders
  const allGuildIds = new Set<string>(guildRows.keys());
  const allUserIds = new Set<string>(userRows.keys());
  const memberPairs = new Map<string, { guildId: string; userId: string }>();
  const addPair = (guildId: string, userId: string) => {
    allGuildIds.add(guildId);
    allUserIds.add(userId);
    memberPairs.set(`${guildId}:${userId}`, { guildId, userId });
  };
  for (const p of profiles.values()) addPair(String(str(p.guild_id)), String(str(p.user_id)));
  for (const p of pacts) addPair(p.guildId, p.userId);
  for (const w of wishes) addPair(w.guildId, w.userId);
  for (const d of disabled) {
    allGuildIds.add(d.guildId);
    allUserIds.add(d.userId);
  }
  for (const s of suggestions) {
    allGuildIds.add(s.guildId);
    allUserIds.add(s.userId);
  }
  for (const g of sourcePactsPerGuild.keys()) allGuildIds.add(g);
  const placeholderGuilds = [...allGuildIds].filter((id) => !guildRows.has(id)).length;
  const placeholderUsers = [...allUserIds].filter((id) => !userRows.has(id)).length;
  const placeholderMembers = [...memberPairs.keys()].filter((k) => !profiles.has(k)).length;

  const guildIdList = [...allGuildIds];
  const userIdList = [...allUserIds];
  const memberKeyList = [...memberPairs.keys()];
  const legacyIdList = entities.map((e) => e.legacyId);
  const franchiseSlugList = groups.map((g) => g.slug);
  const franchiseKeyList = groups.map((g) => g.key);
  const sourceImageCount = entities.reduce((n, e) => n + e.images.length, 0);

  // -------------------------------------------------------------------------
  // Postgres
  // -------------------------------------------------------------------------
  const sql = postgres(opts.databaseUrl, { max: 1, onnotice: () => {}, connect_timeout: 15 });

  const tables: Record<string, TableReport> = {};
  const report: MigrationReport = {
    ok: false,
    dryRun,
    activateLegacy,
    sqlite: sqlitePath,
    backup,
    startedAt,
    finishedAt: startedAt,
    tables,
    verification: { ok: false, pactsPerGuild: [], popularityRanksUnique: false },
    pending: {
      entitiesPendingReview: 0,
      entitiesActivated: 0,
      legacyGenderQueued: 0,
      gendersUnconfirmed: entities.filter((e) => ["MALE", "FEMALE", "NONBINARY"].includes(e.gender))
        .length,
      entitiesWithoutImage: entities.filter((e) => e.images.length === 0).length,
      invalidImageUrls: imgCounters.invalid,
      imageJsonParseErrors: imgCounters.parseErrors,
      universeRemapped,
      sourceEntitiesSharingRank,
      datesReplaced,
      placeholderGuilds,
      placeholderUsers,
      placeholderMembers,
      orphanPacts,
      orphanWishes,
      orphanAliases,
      unmatchedDisabledSeries: { count: 0, names: [] },
      slugRenamed: 0,
      duplicatesCollapsed,
    },
  };

  const counters = (tx: Sql): Record<string, () => Promise<number>> => ({
    franchises: () =>
      scalar(
        tx`SELECT count(*) AS n FROM franchises WHERE slug IN (SELECT jsonb_array_elements_text(${J(franchiseSlugList)}::text::jsonb))`
      ),
    series: () =>
      scalar(
        tx`SELECT count(*) AS n FROM series_external_ids WHERE source = 'LEGACY' AND external_id IN (SELECT jsonb_array_elements_text(${J(franchiseKeyList)}::text::jsonb))`
      ),
    entities: () =>
      scalar(
        tx`SELECT count(*) AS n FROM entities WHERE legacy_id IN (SELECT jsonb_array_elements_text(${J(legacyIdList)}::text::jsonb))`
      ),
    entity_series: () =>
      scalar(
        tx`SELECT count(*) AS n FROM entity_series es JOIN entities e ON e.id = es.entity_id WHERE e.legacy_id IN (SELECT jsonb_array_elements_text(${J(legacyIdList)}::text::jsonb))`
      ),
    entity_images: () =>
      scalar(
        tx`SELECT count(*) AS n FROM entity_images i JOIN entities e ON e.id = i.entity_id WHERE e.legacy_id IN (SELECT jsonb_array_elements_text(${J(legacyIdList)}::text::jsonb))`
      ),
    users: () =>
      scalar(
        tx`SELECT count(*) AS n FROM users WHERE id IN (SELECT jsonb_array_elements_text(${J(userIdList)}::text::jsonb))`
      ),
    guilds: () =>
      scalar(
        tx`SELECT count(*) AS n FROM guilds WHERE id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))`
      ),
    guild_members: () =>
      scalar(
        tx`SELECT count(*) AS n FROM guild_members WHERE guild_id || ':' || user_id IN (SELECT jsonb_array_elements_text(${J(memberKeyList)}::text::jsonb))`
      ),
    pacts: () =>
      scalar(
        tx`SELECT count(*) AS n FROM pacts WHERE guild_id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))`
      ),
    wishes: () =>
      scalar(
        tx`SELECT count(*) AS n FROM wishes WHERE guild_id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))`
      ),
    disabled_series: () =>
      scalar(
        tx`SELECT count(*) AS n FROM disabled_series WHERE guild_id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))`
      ),
    character_suggestions: () =>
      scalar(
        tx`SELECT count(*) AS n FROM character_suggestions WHERE guild_id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))`
      ),
    moderation_queue: () =>
      scalar(
        tx`SELECT count(*) AS n FROM moderation_queue WHERE details->>'origin' = 'migrateFromSqlite'`
      ),
  });

  let rolledBack = false;
  try {
    // Falha cedo e com mensagem clara se as migrations nao foram aplicadas.
    const [reg] =
      await sql`SELECT to_regclass('public.entities') AS t, to_regclass('public.pacts') AS p`;
    if (!reg?.t || !reg?.p)
      throw new Error("Tabelas ausentes no Postgres: rode `npm run db:migrate` antes.");

    await sql
      .begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext('arqon:migrateFromSqlite'))`;
        const count = counters(tx);
        const before: Record<string, number> = {};
        for (const [name, fn] of Object.entries(count)) before[name] = await fn();

        // ---- franquias e series LEGACY ----
        log("franquias/series...");
        for (const part of chunks(groups)) {
          await tx`
            INSERT INTO franchises (slug, name)
            SELECT x.slug, x.name
            FROM jsonb_to_recordset(${J(part.map((g) => ({ slug: g.slug, name: g.name })))}::text::jsonb)
              AS x(slug text, name text)
            ON CONFLICT (slug) DO NOTHING`;
        }
        const franchiseIdBySlug = new Map<string, number>();
        for (const r of await tx`
          SELECT id::int AS id, slug FROM franchises
          WHERE slug IN (SELECT jsonb_array_elements_text(${J(franchiseSlugList)}::text::jsonb))`) {
          franchiseIdBySlug.set(String(r.slug), Number(r.id));
        }

        const existingSeries = new Map<string, number>();
        for (const r of await tx`
          SELECT external_id, series_id::int AS series_id FROM series_external_ids
          WHERE source = 'LEGACY' AND external_id IN (SELECT jsonb_array_elements_text(${J(franchiseKeyList)}::text::jsonb))`) {
          existingSeries.set(String(r.external_id), Number(r.series_id));
        }
        const newGroups = groups.filter((g) => !existingSeries.has(g.key));
        for (const part of chunks(newGroups)) {
          await tx`
            INSERT INTO series (franchise_id, slug, title, media_type, universe)
            SELECT x.franchise_id, x.slug, x.title, x.media_type::media_type, x.universe::universe
            FROM jsonb_to_recordset(${J(
              part.map((g) => ({
                franchise_id: franchiseIdBySlug.get(g.slug) ?? null,
                slug: `legacy-${g.slug}`,
                title: g.name,
                media_type: g.universe === "GAME" ? "GAME" : "OTHER",
                universe: g.universe,
              }))
            )}::text::jsonb) AS x(franchise_id bigint, slug text, title text, media_type text, universe text)
            ON CONFLICT (slug) DO NOTHING`;
        }
        const seriesIdBySlug = new Map<string, number>();
        for (const r of await tx`
          SELECT id::int AS id, slug FROM series
          WHERE slug IN (SELECT jsonb_array_elements_text(${J(groups.map((g) => `legacy-${g.slug}`))}::text::jsonb))`) {
          seriesIdBySlug.set(String(r.slug), Number(r.id));
        }
        for (const part of chunks(newGroups)) {
          await tx`
            INSERT INTO series_external_ids (source, external_id, series_id)
            SELECT 'LEGACY', x.external_id, x.series_id
            FROM jsonb_to_recordset(${J(
              part.map((g) => ({
                external_id: g.key,
                series_id: seriesIdBySlug.get(`legacy-${g.slug}`),
              }))
            )}::text::jsonb) AS x(external_id text, series_id bigint)
            ON CONFLICT (source, external_id) DO NOTHING`;
        }
        const seriesIdByKey = new Map<string, number>();
        for (const g of groups) {
          const id = existingSeries.get(g.key) ?? seriesIdBySlug.get(`legacy-${g.slug}`);
          if (id !== undefined) seriesIdByKey.set(g.key, id);
        }

        // ---- entidades ----
        log("entidades...");
        // slug que pertence a outra entidade (nao legada ou outro legacy_id) ganha sufixo estavel
        const slugOwner = new Map<string, string | null>();
        for (const part of chunks(entities)) {
          for (const r of await tx`
            SELECT slug, legacy_id FROM entities
            WHERE slug IN (SELECT jsonb_array_elements_text(${J(part.map((e) => e.slug))}::text::jsonb))`) {
            slugOwner.set(String(r.slug), r.legacy_id === null ? null : String(r.legacy_id));
          }
        }
        let slugRenamed = 0;
        for (const e of entities) {
          if (slugOwner.has(e.slug) && slugOwner.get(e.slug) !== e.legacyId) {
            e.slug = `${e.slug}-${sha(e.legacyId, 8)}`;
            slugRenamed++;
          }
        }
        report.pending.slugRenamed = slugRenamed;

        for (const part of chunks(entities)) {
          await tx`
            INSERT INTO entities (
              legacy_id, slug, name, name_native, name_normalized, universe, type, gender,
              franchise_id, description, status, base_aether, likes_count, claims_count,
              base_atk, base_def, base_spd, base_hp, created_at)
            SELECT x.legacy_id, x.slug, x.name, x.name_native, x.name_normalized,
              x.universe::universe, x.type::entity_type, x.gender::gender,
              x.franchise_id, x.description, x.status::entity_status, x.base_aether, x.likes_count,
              x.claims_count, x.base_atk, x.base_def, x.base_spd, x.base_hp, x.created_at
            FROM jsonb_to_recordset(${J(
              part.map((e) => ({
                legacy_id: e.legacyId,
                slug: e.slug,
                name: e.name,
                name_native: e.nameNative,
                name_normalized: e.nameNormalized,
                universe: e.universe,
                type: e.type,
                gender: e.gender,
                franchise_id: franchiseIdBySlug.get(groupByKey.get(e.franchiseKey)!.slug) ?? null,
                description: e.description,
                status: activateLegacy && e.eligible ? "ACTIVE" : "PENDING_REVIEW",
                base_aether: e.baseAether,
                likes_count: e.likes,
                claims_count: e.claims,
                base_atk: e.atk,
                base_def: e.def,
                base_spd: e.spd,
                base_hp: e.hp,
                created_at: e.createdAt.toISOString(),
              }))
            )}::text::jsonb) AS x(
              legacy_id text, slug text, name text, name_native text, name_normalized text,
              universe text, type text, gender text, franchise_id bigint, description text,
              status text, base_aether int, likes_count int, claims_count int,
              base_atk int, base_def int, base_spd int, base_hp int, created_at timestamptz)
            ON CONFLICT (legacy_id) WHERE legacy_id IS NOT NULL DO UPDATE SET
              franchise_id = COALESCE(entities.franchise_id, EXCLUDED.franchise_id),
              status = CASE
                WHEN EXCLUDED.status = 'ACTIVE' AND entities.status = 'PENDING_REVIEW' THEN 'ACTIVE'::entity_status
                ELSE entities.status END`;
        }

        const entityIdByLegacy = new Map<string, number>();
        const rankByLegacy = new Map<string, number | null>();
        for (const part of chunks(entities)) {
          for (const r of await tx`
            SELECT id::int AS id, legacy_id, popularity_rank FROM entities
            WHERE legacy_id IN (SELECT jsonb_array_elements_text(${J(part.map((e) => e.legacyId))}::text::jsonb))`) {
            entityIdByLegacy.set(String(r.legacy_id), Number(r.id));
            rankByLegacy.set(
              String(r.legacy_id),
              r.popularity_rank === null ? null : Number(r.popularity_rank)
            );
          }
        }

        // ---- popularity_rank unico (constraint deferrable; checada no commit) ----
        log("ranks...");
        const toRank = entities
          .filter((e) => rankByLegacy.get(e.legacyId) === null)
          .sort(compareForRank);
        if (toRank.length > 0) {
          const offset = await scalar(
            tx`SELECT coalesce(max(popularity_rank), 0) AS n FROM entities`
          );
          const total = toRank.length;
          for (const part of chunks(toRank.map((e, i) => ({ e, i })))) {
            await tx`
              UPDATE entities AS t SET
                popularity_rank = x.rank, popularity_score = x.score,
                tier = x.tier::entity_tier, roll_weight = x.weight
              FROM jsonb_to_recordset(${J(
                part.map(({ e, i }) => {
                  const score = total <= 1 ? 1 : Math.round((1 - i / (total - 1)) * 10000) / 10000;
                  const tier = tierFor(i, total);
                  return {
                    legacy_id: e.legacyId,
                    rank: offset + i + 1,
                    score,
                    tier,
                    weight:
                      Math.round(TIER_WEIGHT[tier] * (1 + POPULARITY_WEIGHT * score) * 10000) /
                      10000,
                  };
                })
              )}::text::jsonb) AS x(legacy_id text, rank int, score real, tier text, weight real)
              WHERE t.legacy_id = x.legacy_id AND t.popularity_rank IS NULL`;
          }
        }
        // Forca a checagem do UNIQUE agora, nao so no commit.
        await tx`SET CONSTRAINTS uq_entities_popularity_rank IMMEDIATE`;
        const [dupRank] = await tx`
          SELECT count(popularity_rank) - count(DISTINCT popularity_rank) AS n FROM entities`;
        report.verification.popularityRanksUnique = Number(dupRank?.n ?? 0) === 0;

        // ---- entity_series (serie primaria = serie LEGACY da franquia) ----
        for (const part of chunks(entities)) {
          await tx`
            INSERT INTO entity_series (entity_id, series_id, role, is_primary)
            SELECT x.entity_id, x.series_id, 'MAIN',
              NOT EXISTS (SELECT 1 FROM entity_series p WHERE p.entity_id = x.entity_id AND p.is_primary)
            FROM jsonb_to_recordset(${J(
              part.flatMap((e) => {
                const entityId = entityIdByLegacy.get(e.legacyId);
                const seriesId = seriesIdByKey.get(e.franchiseKey);
                return entityId !== undefined && seriesId !== undefined
                  ? [{ entity_id: entityId, series_id: seriesId }]
                  : [];
              })
            )}::text::jsonb) AS x(entity_id bigint, series_id bigint)
            ON CONFLICT DO NOTHING`;
        }

        // ---- imagens ----
        log("imagens...");
        const imageRows = entities.flatMap((e) =>
          e.images.map((url, i) => ({
            entity_id: entityIdByLegacy.get(e.legacyId),
            url,
            primary: i === 0,
          }))
        );
        for (const part of chunks(imageRows)) {
          await tx`
            INSERT INTO entity_images (entity_id, url, source, status, is_primary)
            SELECT x.entity_id, x.url, 'LEGACY', 'ACTIVE',
              x.is_primary AND NOT EXISTS (
                SELECT 1 FROM entity_images p WHERE p.entity_id = x.entity_id AND p.is_primary)
            FROM jsonb_to_recordset(${J(
              part.map((r) => ({ entity_id: r.entity_id, url: r.url, is_primary: r.primary }))
            )}::text::jsonb) AS x(entity_id bigint, url text, is_primary boolean)
            ON CONFLICT DO NOTHING`;
        }

        // ---- guilds, users, members ----
        log("guilds/users/members...");
        const baseRollsByGuild = new Map<string, number>();
        const guildPayload = guildIdList.map((id) => {
          const g = guildRows.get(id);
          const baseRolls = int(g?.base_rolls, 10, 0);
          baseRollsByGuild.set(id, baseRolls);
          return {
            id,
            prefix: str(g?.prefix) ?? "$",
            language: str(g?.language) ?? "pt-BR",
            gamemode: int(g?.gamemode, 1),
            base_rolls: baseRolls,
            claim_cooldown_minutes: Math.max(1, int(g?.claim_cooldown_minutes, 180)),
            claim_window_seconds: Math.max(1, int(g?.claim_window_seconds, 45)),
            snipe_protection_level: int(g?.snipe_protection_level, 0),
            snipe_protection_seconds: int(g?.snipe_protection_seconds, 8),
            aether_snipe_protection_level: int(g?.aether_snipe_protection_level, 0),
            aether_snipe_protection_seconds: int(g?.aether_snipe_protection_seconds, 8),
            pact_limit: int(g?.pact_limit, 8100),
            server_aether_scrap: int(g?.server_aether_scrap, 0),
            created_at: date(g?.created_at, "guilds.created_at").toISOString(),
          };
        });
        for (const part of chunks(guildPayload)) {
          await tx`
            INSERT INTO guilds (id, prefix, language, gamemode, base_rolls, claim_cooldown_minutes,
              claim_window_seconds, snipe_protection_level, snipe_protection_seconds,
              aether_snipe_protection_level, aether_snipe_protection_seconds, pact_limit,
              server_aether_scrap, created_at)
            SELECT x.id, x.prefix, x.language, x.gamemode, x.base_rolls, x.claim_cooldown_minutes,
              x.claim_window_seconds, x.snipe_protection_level, x.snipe_protection_seconds,
              x.aether_snipe_protection_level, x.aether_snipe_protection_seconds, x.pact_limit,
              x.server_aether_scrap, x.created_at
            FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(
              id text, prefix text, language text, gamemode int, base_rolls int,
              claim_cooldown_minutes int, claim_window_seconds int, snipe_protection_level int,
              snipe_protection_seconds int, aether_snipe_protection_level int,
              aether_snipe_protection_seconds int, pact_limit int, server_aether_scrap int,
              created_at timestamptz)
            ON CONFLICT (id) DO NOTHING`;
        }

        const userPayload = userIdList.map((id) => {
          const u = userRows.get(id);
          return {
            id,
            username: str(u?.username) ?? `legacy-${id}`,
            preferred_language: str(u?.preferred_language) ?? "pt-BR",
            roll_resets: int(u?.roll_resets, 0, 0),
            is_vip: bool(u?.is_vip),
            vip_tier: int(u?.vip_tier, 0, 0),
            daily_imports_count: int(u?.daily_imports_count, 0, 0),
            last_import_reset: date(u?.last_import_reset, "users.last_import_reset").toISOString(),
            created_at: date(u?.created_at, "users.created_at").toISOString(),
          };
        });
        for (const part of chunks(userPayload)) {
          await tx`
            INSERT INTO users (id, username, preferred_language, roll_resets, is_vip, vip_tier,
              daily_imports_count, last_import_reset, created_at)
            SELECT x.id, x.username, x.preferred_language, x.roll_resets, x.is_vip, x.vip_tier,
              x.daily_imports_count, x.last_import_reset, x.created_at
            FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(
              id text, username text, preferred_language text, roll_resets int, is_vip boolean,
              vip_tier int, daily_imports_count int, last_import_reset timestamptz,
              created_at timestamptz)
            ON CONFLICT (id) DO NOTHING`;
        }

        const memberPayload = [...memberPairs.entries()].map(([key, pair]) => {
          const p = profiles.get(key);
          const baseRolls = baseRollsByGuild.get(pair.guildId) ?? 10;
          const remaining = p ? int(p.rolls_remaining, baseRolls) : baseRolls;
          return {
            guild_id: pair.guildId,
            user_id: pair.userId,
            aether_balance: Math.max(0, int(p?.aether_balance, 0)),
            astral_shards: int(p?.astral_shards, 0, 0),
            rolls_used: Math.max(0, baseRolls - remaining),
            stacked_rolls: int(p?.stacked_rolls, 0, 0),
            embed_color: str(p?.embed_color) ?? "#5865F2",
            relic_bronze: int(p?.relic_bronze, 0, 0),
            relic_silver: int(p?.relic_silver, 0, 0),
            relic_gold: int(p?.relic_gold, 0, 0),
            relic_sapphire: int(p?.relic_sapphire, 0, 0),
            relic_ruby: int(p?.relic_ruby, 0, 0),
            relic_emerald: int(p?.relic_emerald, 0, 0),
            created_at: date(p?.created_at, "guild_members.created_at").toISOString(),
          };
        });
        for (const part of chunks(memberPayload)) {
          await tx`
            INSERT INTO guild_members (guild_id, user_id, aether_balance, astral_shards, rolls_used,
              rolls_window, stacked_rolls, pacts_used, pact_window, embed_color, relic_bronze,
              relic_silver, relic_gold, relic_sapphire, relic_ruby, relic_emerald, created_at)
            SELECT x.guild_id, x.user_id, x.aether_balance, x.astral_shards, x.rolls_used,
              -1, x.stacked_rolls, 0, -1, x.embed_color, x.relic_bronze, x.relic_silver,
              x.relic_gold, x.relic_sapphire, x.relic_ruby, x.relic_emerald, x.created_at
            FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(
              guild_id text, user_id text, aether_balance bigint, astral_shards int, rolls_used int,
              stacked_rolls int, embed_color text, relic_bronze int, relic_silver int, relic_gold int,
              relic_sapphire int, relic_ruby int, relic_emerald int, created_at timestamptz)
            ON CONFLICT (guild_id, user_id) DO NOTHING`;
        }

        // ---- pactos ----
        log("pactos/wishes...");
        for (const part of chunks(pacts)) {
          await tx`
            INSERT INTO pacts (guild_id, user_id, entity_id, variant, awakening_keys, is_soulmate,
              custom_image, alias, alias2, note, embed_color, sort_order, aether_at_bind, bound_at)
            SELECT x.guild_id, x.user_id, x.entity_id, x.variant::card_variant, x.awakening_keys,
              x.is_soulmate, x.custom_image, x.alias, x.alias2, x.note, x.embed_color, x.sort_order,
              x.aether_at_bind, x.bound_at
            FROM jsonb_to_recordset(${J(
              part.map((p) => ({
                guild_id: p.guildId,
                user_id: p.userId,
                entity_id: entityIdByLegacy.get(p.entityLegacyId),
                variant: p.variant,
                awakening_keys: p.awakeningKeys,
                is_soulmate: p.isSoulmate,
                custom_image: p.customImage,
                alias: p.alias,
                alias2: p.alias2,
                note: p.note,
                embed_color: p.embedColor,
                sort_order: p.sortOrder,
                aether_at_bind: p.aetherAtBind,
                bound_at: p.boundAt.toISOString(),
              }))
            )}::text::jsonb) AS x(
              guild_id text, user_id text, entity_id bigint, variant text, awakening_keys int,
              is_soulmate boolean, custom_image text, alias text, alias2 text, note text,
              embed_color text, sort_order int, aether_at_bind int, bound_at timestamptz)
            ON CONFLICT (guild_id, entity_id) DO NOTHING`;
        }

        for (const part of chunks(wishes)) {
          await tx`
            INSERT INTO wishes (guild_id, user_id, entity_id, is_starwish, created_at)
            SELECT x.guild_id, x.user_id, x.entity_id, x.is_starwish, x.created_at
            FROM jsonb_to_recordset(${J(
              part.map((w) => ({
                guild_id: w.guildId,
                user_id: w.userId,
                entity_id: entityIdByLegacy.get(w.entityLegacyId),
                is_starwish: w.isStarwish,
                created_at: w.createdAt.toISOString(),
              }))
            )}::text::jsonb) AS x(
              guild_id text, user_id text, entity_id bigint, is_starwish boolean,
              created_at timestamptz)
            ON CONFLICT (guild_id, user_id, entity_id) DO NOTHING`;
        }

        // ---- disabled_series ----
        log("disabled_series...");
        const seriesByNorm = new Map<string, number>();
        for (const r of await tx`SELECT id::int AS id, title FROM series ORDER BY id`) {
          const k = normalizeName(String(r.title));
          if (k !== "" && !seriesByNorm.has(k)) seriesByNorm.set(k, Number(r.id));
        }
        const franchiseByNorm = new Map<string, number>();
        for (const r of await tx`SELECT id::int AS id, name FROM franchises ORDER BY id`) {
          const k = normalizeName(String(r.name));
          if (k !== "" && !franchiseByNorm.has(k)) franchiseByNorm.set(k, Number(r.id));
        }
        const matchedSeries: Row[] = [];
        const matchedFranchise: Row[] = [];
        const unmatched: SrcDisabled[] = [];
        for (const d of disabled) {
          const k = normalizeName(d.seriesName);
          const base = {
            guild_id: d.guildId,
            user_id: d.userId,
            is_server_wide: d.isServerWide,
            created_at: d.createdAt.toISOString(),
          };
          const sid = seriesByNorm.get(k);
          const fid = franchiseByNorm.get(k);
          if (sid !== undefined) matchedSeries.push({ ...base, target_id: sid });
          else if (fid !== undefined) matchedFranchise.push({ ...base, target_id: fid });
          else unmatched.push(d);
        }
        for (const [rows, column] of [
          [matchedSeries, "series_id"],
          [matchedFranchise, "franchise_id"],
        ] as const) {
          for (const part of chunks(rows)) {
            if (column === "series_id") {
              await tx`
                INSERT INTO disabled_series (guild_id, user_id, is_server_wide, series_id, created_at)
                SELECT x.guild_id, x.user_id, x.is_server_wide, x.target_id, x.created_at
                FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(
                  guild_id text, user_id text, is_server_wide boolean, target_id bigint,
                  created_at timestamptz)
                ON CONFLICT (guild_id, user_id, is_server_wide, series_id)
                  WHERE series_id IS NOT NULL DO NOTHING`;
            } else {
              await tx`
                INSERT INTO disabled_series (guild_id, user_id, is_server_wide, franchise_id, created_at)
                SELECT x.guild_id, x.user_id, x.is_server_wide, x.target_id, x.created_at
                FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(
                  guild_id text, user_id text, is_server_wide boolean, target_id bigint,
                  created_at timestamptz)
                ON CONFLICT (guild_id, user_id, is_server_wide, franchise_id)
                  WHERE franchise_id IS NOT NULL DO NOTHING`;
            }
          }
        }
        report.pending.unmatchedDisabledSeries = {
          count: unmatched.length,
          names: [...new Set(unmatched.map((d) => d.seriesName))].slice(0, 50),
        };

        // ---- character_suggestions ----
        for (const part of chunks(suggestions)) {
          await tx`
            INSERT INTO character_suggestions (guild_id, user_id, character_name, status, anilist_id, created_at)
            SELECT x.guild_id, x.user_id, x.character_name, x.status::review_status, x.anilist_id, x.created_at
            FROM jsonb_to_recordset(${J(
              part.map((s) => ({
                guild_id: s.guildId,
                user_id: s.userId,
                character_name: s.characterName,
                status: s.status,
                anilist_id: s.anilistId,
                created_at: s.createdAt.toISOString(),
              }))
            )}::text::jsonb) AS x(
              guild_id text, user_id text, character_name text, status text, anilist_id int,
              created_at timestamptz)
            WHERE NOT EXISTS (
              SELECT 1 FROM character_suggestions c
              WHERE c.guild_id = x.guild_id AND c.user_id = x.user_id
                AND lower(c.character_name) = lower(x.character_name))`;
        }

        // ---- moderation_queue ----
        log("moderation_queue...");
        const origin = "migrateFromSqlite";
        const modItems: Array<{ legacy_id: string; reason: string; details: Row }> = [];
        for (const e of entities) {
          const activated = activateLegacy && e.eligible;
          if (!activated) {
            modItems.push({
              legacy_id: e.legacyId,
              reason: "LEGACY_GENDER",
              details: { origin, legacyGender: e.gender, legacyId: e.legacyId },
            });
          }
          if (e.images.length === 0) {
            modItems.push({
              legacy_id: e.legacyId,
              reason: "NO_IMAGE",
              details: { origin, legacyId: e.legacyId },
            });
          }
        }
        for (const part of chunks(modItems)) {
          await tx`
            INSERT INTO moderation_queue (entity_id, reason, details)
            SELECT e.id, x.reason::moderation_reason, x.details
            FROM jsonb_to_recordset(${J(part)}::text::jsonb) AS x(legacy_id text, reason text, details jsonb)
            JOIN entities e ON e.legacy_id = x.legacy_id
            WHERE NOT EXISTS (
              SELECT 1 FROM moderation_queue m
              WHERE m.entity_id = e.id AND m.reason = x.reason::moderation_reason)`;
        }
        if (activateLegacy) {
          // Entidades ativadas agora nao precisam mais da revisao de genero criada por uma execucao anterior.
          await tx`
            UPDATE moderation_queue m
            SET status = 'APPROVED', reviewed_by = 'migrateFromSqlite:activate-legacy', reviewed_at = now()
            FROM entities e
            WHERE m.entity_id = e.id AND m.reason = 'LEGACY_GENDER' AND m.status = 'PENDING'
              AND m.details->>'origin' = 'migrateFromSqlite' AND e.status = 'ACTIVE'`;
        }
        for (const part of chunks(unmatched)) {
          await tx`
            INSERT INTO moderation_queue (reason, details)
            SELECT 'UNMATCHED_DISABLED_SERIES', x.details
            FROM jsonb_to_recordset(${J(
              part.map((d) => ({
                details: {
                  origin,
                  legacyId: d.legacyId,
                  guildId: d.guildId,
                  userId: d.userId,
                  seriesName: d.seriesName,
                  isServerWide: d.isServerWide,
                },
              }))
            )}::text::jsonb) AS x(details jsonb)
            WHERE NOT EXISTS (
              SELECT 1 FROM moderation_queue m
              WHERE m.reason = 'UNMATCHED_DISABLED_SERIES'
                AND m.details->>'legacyId' = x.details->>'legacyId')`;
        }

        // ---- pendencias do destino ----
        report.pending.entitiesPendingReview = await scalar(tx`
          SELECT count(*) AS n FROM entities
          WHERE status = 'PENDING_REVIEW'
            AND legacy_id IN (SELECT jsonb_array_elements_text(${J(legacyIdList)}::text::jsonb))`);
        report.pending.entitiesActivated = await scalar(tx`
          SELECT count(*) AS n FROM entities
          WHERE status = 'ACTIVE'
            AND legacy_id IN (SELECT jsonb_array_elements_text(${J(legacyIdList)}::text::jsonb))`);
        report.pending.legacyGenderQueued = await scalar(tx`
          SELECT count(*) AS n FROM moderation_queue
          WHERE reason = 'LEGACY_GENDER' AND status = 'PENDING' AND details->>'origin' = 'migrateFromSqlite'`);

        // ---- relatorio de contagens ----
        const sourceCounts: Record<string, number> = {
          franchises: groups.length,
          series: groups.length,
          entities: legacy.entities.length,
          entity_series: entities.length,
          entity_images: sourceImageCount,
          users: legacy.users.length,
          guilds: legacy.guilds.length,
          guild_members: legacy.guild_profiles.length,
          pacts: legacy.pacts.length,
          wishes: legacy.wishes.length,
          disabled_series: legacy.disabled_series.length,
          character_suggestions: legacy.character_suggestions.length,
          moderation_queue: modItems.length + unmatched.length,
        };
        for (const [name, fn] of Object.entries(count)) {
          const destination = await fn();
          tables[name] = {
            source: sourceCounts[name] ?? 0,
            destination,
            inserted: destination - (before[name] ?? 0),
          };
        }

        // ---- verificacao: pactos por guild ----
        const destPacts = new Map<string, number>();
        for (const r of await tx`
          SELECT guild_id, count(*)::int AS n FROM pacts
          WHERE guild_id IN (SELECT jsonb_array_elements_text(${J(guildIdList)}::text::jsonb))
          GROUP BY guild_id`) {
          destPacts.set(String(r.guild_id), Number(r.n));
        }
        const guildsToCheck = new Set([...sourcePactsPerGuild.keys(), ...destPacts.keys()]);
        let pactsOk = true;
        for (const guildId of [...guildsToCheck].sort()) {
          const source = sourcePactsPerGuild.get(guildId) ?? 0;
          const destination = destPacts.get(guildId) ?? 0;
          if (destination < source) pactsOk = false;
          report.verification.pactsPerGuild.push({ guildId, source, destination });
        }
        report.verification.ok = pactsOk && report.verification.popularityRanksUnique;
        if (!report.verification.ok) {
          throw new VerificationError(
            pactsOk
              ? "popularity_rank nao e unico"
              : "contagem de pactos por guild difere entre origem e destino"
          );
        }
        if (dryRun) throw new RollbackSignal();
      })
      .catch((err: unknown) => {
        if (err instanceof RollbackSignal) {
          rolledBack = true;
          return;
        }
        throw err;
      });
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = err instanceof Error ? err.message : String(err);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  if (dryRun && rolledBack) log("dry-run: transacao revertida, nada foi gravado.");
  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  dryRun: boolean;
  activateLegacy: boolean;
  sqlite: string;
  databaseUrl?: string;
  backupDir?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, activateLegacy: false, sqlite: "./arqon_local.db" };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (!v) throw new Error(`Flag ${flag} exige um valor.`);
      return v;
    };
    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--activate-legacy":
        args.activateLegacy = true;
        break;
      case "--sqlite":
        args.sqlite = value();
        break;
      case "--database-url":
        args.databaseUrl = value();
        break;
      case "--backup-dir":
        args.backupDir = value();
        break;
      default:
        throw new Error(
          `Flag desconhecida: ${flag}\nUso: migrate:sqlite [--dry-run] [--sqlite=<path>] [--database-url=<url>] [--activate-legacy] [--backup-dir=<dir>]`
        );
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let databaseUrl = args.databaseUrl?.trim();
  if (!databaseUrl) {
    const { requireEnv } = await import("../config/env.js");
    databaseUrl = requireEnv("DATABASE_URL");
  }
  const report = await migrateFromSqlite({
    sqlitePath: args.sqlite,
    databaseUrl,
    dryRun: args.dryRun,
    activateLegacy: args.activateLegacy,
    backupRoot: args.backupDir,
    log: (m) => console.error(m),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error("Falha na migracao:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
