import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { TIER_MAX_SUPPLY, ENTITY_TIERS, type EntityTier } from "../config/gacha.js";
import { loadArtOverrides } from "../canvas/engine/artResolver.js";
import { resolveCardArt, type ArtOverride } from "./artQuality.js";
import type { DbExecutor } from "./executor.js";

/**
 * Exportador do catalogo publico para os sites (GitHub Pages e Vercel). Fonte unica: o banco do bot.
 * So SELECT. Campos publicos apenas (nada de usuarios, pactos, saldos). Modulo sem efeitos no import.
 */

export const SITE_SCHEMA_VERSION = 1;
export const CATALOG_FILE = "catalog.json";
export const META_FILE = "catalog.meta.json";

/** Raiz publica das fotos proprias; o catalogo antigo as guardava como `./assets/cards/x.jpg`. */
const OWN_ASSET_BASE = "https://yo-apollon.github.io/kogu/";

export interface SiteCard {
  id: number;
  slug: string;
  name: string;
  seriesTitle: string | null;
  universe: string;
  gender: string;
  tier: EntityTier;
  baseAether: number;
  popularityRank: number | null;
  /** Compat com os sites antigos: URL da arte quando `art.mode === 'IMAGE'`, senao null. */
  imageUrl: string | null;
  niche: string | null;
  nicheLabel: string | null;
  prestige: number | null;
  /** Posicao dentro do nicho (edicoes herdam a da carta ancora). */
  nicheRank: number | null;
  edition: string | null;
  parentSlug: string | null;
  stats: { atk: number; def: number; spd: number; hp: number };
  supply: { max: number | null; label: string | null };
  aliases: string[];
  art: { mode: "IMAGE"; url: string } | { mode: "EMBLEM"; emblem: string };
  updatedAt: string;
}

export interface SiteSchemaInfo {
  niche: boolean;
  prestige: boolean;
  edition: boolean;
}

type Row = Record<string, unknown>;

/** Detecta, por information_schema, o que existe no banco (migrations 0004/0005 podem faltar). */
export async function detectSiteSchema(db: Pick<DbExecutor, "execute">): Promise<SiteSchemaInfo> {
  const rows = (await db.execute(sql`
    SELECT table_name AS t, column_name AS c
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name IN ('entities', 'niches')`)) as unknown as Row[];
  const has = (t: string, c: string) => rows.some((r) => r.t === t && r.c === c);
  return {
    niche: has("entities", "niche_id") && has("niches", "key") && has("niches", "label_pt"),
    prestige: has("entities", "prestige"),
    edition: has("entities", "edition") && has("entities", "parent_id"),
  };
}

export function supplyOf(tier: EntityTier): { max: number | null; label: string | null } {
  const max = TIER_MAX_SUPPLY[tier] ?? null;
  if (max === null) return { max: null, label: null };
  return { max, label: max === 1 ? "1/1" : `até ${max} cópias` };
}

/** Aliases derivados: nome nativo, texto entre parenteses e nome sem parenteses. */
export function buildAliases(name: string, nameNative: string | null | undefined): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const s = (v ?? "").trim();
    if (s !== "" && s !== name) out.add(s);
  };
  add(nameNative);
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (m) {
    add(m[1]);
    add(m[2]);
  }
  return [...out];
}

function absolutizeOwnAsset(url: string | null): string | null {
  if (url === null) return null;
  const t = url.trim();
  if (/^\.?\/?assets\/cards\//i.test(t)) return OWN_ASSET_BASE + t.replace(/^\.?\//, "");
  return t;
}

function toGender(g: string): string {
  return g === "FEMALE" || g === "MALE" ? g : "OTHER";
}

/** Le as cartas publicas. Exclui adultas, inativas, mescladas e de genero desconhecido. */
export async function loadSiteCatalog(
  db: Pick<DbExecutor, "execute">,
  opts: { overrides?: ReadonlyMap<string, ArtOverride> | readonly ArtOverride[] } = {}
): Promise<SiteCard[]> {
  const info = await detectSiteSchema(db);
  const nicheSel = info.niche ? sql`n.key AS niche, n.label_pt AS niche_label` : sql`NULL::text AS niche, NULL::text AS niche_label`;
  const prestigeSel = info.prestige ? sql`e.prestige::float8 AS prestige` : sql`NULL::float8 AS prestige`;
  const editionSel = info.edition
    ? sql`e.edition AS edition, p.slug AS parent_slug`
    : sql`NULL::text AS edition, NULL::text AS parent_slug`;
  const nicheJoin = info.niche ? sql`LEFT JOIN niches n ON n.id = e.niche_id` : sql``;
  const parentJoin = info.edition ? sql`LEFT JOIN entities p ON p.id = e.parent_id` : sql``;

  const rows = (await db.execute(sql`
    SELECT e.id::int AS id, e.slug, e.name, e.name_native, e.description, e.universe::text AS universe,
           e.type::text AS type, e.gender::text AS gender, e.tier::text AS tier, e.base_aether AS base_aether,
           e.popularity_rank AS popularity_rank, e.base_atk, e.base_def, e.base_spd, e.base_hp,
           e.updated_at AS updated_at, s.title AS series_title, img.url AS image_url,
           ${nicheSel}, ${prestigeSel}, ${editionSel}
    FROM entities e
    LEFT JOIN entity_series es ON es.entity_id = e.id AND es.is_primary
    LEFT JOIN series s ON s.id = es.series_id
    LEFT JOIN entity_images img ON img.entity_id = e.id AND img.is_primary AND img.status = 'ACTIVE'
    ${nicheJoin}
    ${parentJoin}
    WHERE e.status = 'ACTIVE' AND e.is_adult = false AND e.merged_into_id IS NULL
      AND e.gender <> 'UNKNOWN' AND (s.id IS NULL OR s.is_adult = false)`)) as unknown as Row[];

  const overrides = opts.overrides ?? loadArtOverrides();

  const cards: SiteCard[] = rows.map((r) => {
    const tier = (ENTITY_TIERS as readonly string[]).includes(r.tier as string) ? (r.tier as EntityTier) : "COMMON";
    const rawUrl = absolutizeOwnAsset((r.image_url as string | null) ?? null);
    const art = resolveCardArt(
      {
        type: r.type as string,
        universe: r.universe as string,
        imageUrl: rawUrl,
        name: r.name as string,
        slug: r.slug as string,
        description: (r.description as string | null) ?? null,
      },
      overrides
    );
    const updated = r.updated_at instanceof Date ? r.updated_at : new Date(String(r.updated_at));
    return {
      id: Number(r.id),
      slug: r.slug as string,
      name: r.name as string,
      seriesTitle: (r.series_title as string | null) ?? null,
      universe: r.universe as string,
      gender: toGender(r.gender as string),
      tier,
      baseAether: Number(r.base_aether),
      popularityRank: r.popularity_rank === null ? null : Number(r.popularity_rank),
      imageUrl: art.mode === "IMAGE" ? art.url : null,
      niche: (r.niche as string | null) ?? null,
      nicheLabel: (r.niche_label as string | null) ?? null,
      prestige: r.prestige === null || r.prestige === undefined ? null : Math.round(Number(r.prestige) * 100) / 100,
      nicheRank: null,
      edition: (r.edition as string | null) ?? null,
      parentSlug: (r.parent_slug as string | null) ?? null,
      stats: { atk: Number(r.base_atk), def: Number(r.base_def), spd: Number(r.base_spd), hp: Number(r.base_hp) },
      supply: supplyOf(tier),
      aliases: buildAliases(r.name as string, r.name_native as string | null),
      art: art.mode === "IMAGE" ? { mode: "IMAGE", url: art.url } : { mode: "EMBLEM", emblem: art.emblem },
      updatedAt: Number.isNaN(updated.getTime()) ? new Date(0).toISOString() : updated.toISOString(),
    };
  });

  return sortAndRank(cards);
}

const nullsLast = (a: number | null, b: number | null, desc: boolean): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return desc ? b - a : a - b;
};

/** Ordena por nicho, prestigio (desc) ou popularity_rank; calcula `nicheRank` (edicoes herdam a ancora). */
export function sortAndRank(cards: SiteCard[]): SiteCard[] {
  const sorted = [...cards].sort((a, b) => {
    if (a.niche !== b.niche) {
      if (a.niche === null) return 1;
      if (b.niche === null) return -1;
      return a.niche < b.niche ? -1 : 1;
    }
    return (
      nullsLast(a.prestige, b.prestige, true) ||
      nullsLast(a.popularityRank, b.popularityRank, false) ||
      b.baseAether - a.baseAether ||
      a.id - b.id
    );
  });
  const counters = new Map<string, number>();
  const rankBySlug = new Map<string, number>();
  for (const c of sorted) {
    if (c.niche === null || c.parentSlug !== null) continue;
    const n = (counters.get(c.niche) ?? 0) + 1;
    counters.set(c.niche, n);
    rankBySlug.set(c.slug, n);
    c.nicheRank = n;
  }
  for (const c of sorted) {
    if (c.niche !== null && c.parentSlug !== null) c.nicheRank = rankBySlug.get(c.parentSlug) ?? null;
  }
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Conteudo, hash e meta                                               */
/* ------------------------------------------------------------------ */

export function serializeCatalog(cards: readonly SiteCard[]): string {
  return `[\n${cards.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`;
}

/** Hash do conteudo publico; ignora `updatedAt` para nao mudar quando so o timestamp do banco muda. */
export function hashCards(cards: readonly SiteCard[]): string {
  const stable = cards.map(({ updatedAt: _u, ...rest }) => rest);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export interface SiteMeta {
  schemaVersion: number;
  generatedAt: string;
  total: number;
  hash: string;
  counts: {
    byTier: Record<string, number>;
    byNiche: Record<string, number>;
    byUniverse: Record<string, number>;
  };
  files: string[];
}

export function buildMeta(cards: readonly SiteCard[], generatedAt: Date): SiteMeta {
  const inc = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  const byTier: Record<string, number> = {};
  const byNiche: Record<string, number> = {};
  const byUniverse: Record<string, number> = {};
  for (const c of cards) {
    inc(byTier, c.tier);
    inc(byNiche, c.niche ?? "none");
    inc(byUniverse, c.universe);
  }
  return {
    schemaVersion: SITE_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    total: cards.length,
    hash: hashCards(cards),
    counts: { byTier, byNiche, byUniverse },
    files: [CATALOG_FILE],
  };
}

/* ------------------------------------------------------------------ */
/* Destinos e escrita atomica                                          */
/* ------------------------------------------------------------------ */

/** `--out` tem prioridade; depois SITE_EXPORT_DIRS (separado por `;`); vazio = `docs` do projeto. */
export function resolveExportDirs(opts: { out?: readonly string[]; env?: string | undefined; cwd?: string }): string[] {
  const cwd = opts.cwd ?? process.cwd();
  const fromEnv = (opts.env ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const list = opts.out && opts.out.length > 0 ? [...opts.out] : fromEnv;
  const dirs = (list.length > 0 ? list : ["docs"]).map((d) => path.resolve(cwd, d));
  return [...new Set(dirs)];
}

export type DirWriteStatus = "WRITTEN" | "UNCHANGED" | "DRY_RUN";

export interface DirWriteResult {
  dir: string;
  status: DirWriteStatus;
}

async function assertDir(dir: string): Promise<void> {
  const abs = path.resolve(dir);
  if (path.parse(abs).root === abs) throw new Error(`destino invalido (raiz do disco): ${dir}`);
  let st;
  try {
    st = await fs.stat(abs);
  } catch {
    throw new Error(`destino nao existe: ${dir}`);
  }
  if (!st.isDirectory()) throw new Error(`destino nao e uma pasta: ${dir}`);
}

async function atomicWrite(dir: string, file: string, content: string): Promise<void> {
  const target = path.join(dir, file);
  const tmp = path.join(dir, `.${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function readExistingHash(dir: string): Promise<string | null> {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, META_FILE), "utf8")) as Partial<SiteMeta>;
    await fs.access(path.join(dir, CATALOG_FILE));
    return typeof meta.hash === "string" ? meta.hash : null;
  } catch {
    return null;
  }
}

export interface WriteOptions {
  dryRun?: boolean;
  /** Permite exportar 0 cartas (por padrao recusa, para nao apagar o site por engano). */
  allowEmpty?: boolean;
  now?: Date;
}

/** Valida TODOS os destinos antes de escrever em qualquer um; so grava onde o hash mudou. */
export async function writeCatalogFiles(
  cards: readonly SiteCard[],
  dirs: readonly string[],
  opts: WriteOptions = {}
): Promise<{ meta: SiteMeta; results: DirWriteResult[] }> {
  if (dirs.length === 0) throw new Error("nenhum destino informado");
  if (cards.length === 0 && !opts.allowEmpty) throw new Error("catalogo vazio: exportacao recusada");
  for (const d of dirs) await assertDir(d);

  const meta = buildMeta(cards, opts.now ?? new Date());
  const catalogText = serializeCatalog(cards);
  const results: DirWriteResult[] = [];
  for (const d of dirs) {
    const dir = path.resolve(d);
    if ((await readExistingHash(dir)) === meta.hash) {
      results.push({ dir, status: "UNCHANGED" });
      continue;
    }
    if (opts.dryRun) {
      results.push({ dir, status: "DRY_RUN" });
      continue;
    }
    // catalog.json primeiro e meta por ultimo: o meta so aparece com o catalogo ja no lugar.
    await atomicWrite(dir, CATALOG_FILE, catalogText);
    await atomicWrite(dir, META_FILE, `${JSON.stringify(meta, null, 2)}\n`);
    results.push({ dir, status: "WRITTEN" });
  }
  return { meta, results };
}

/** Exportacao completa: le o banco e escreve nos destinos. */
export async function exportSiteCatalog(
  db: Pick<DbExecutor, "execute">,
  dirs: readonly string[],
  opts: WriteOptions & { overrides?: ReadonlyMap<string, ArtOverride> | readonly ArtOverride[] } = {}
): Promise<{ cards: SiteCard[]; meta: SiteMeta; results: DirWriteResult[] }> {
  const cards = await loadSiteCatalog(db, opts.overrides ? { overrides: opts.overrides } : {});
  const { meta, results } = await writeCatalogFiles(cards, dirs, opts);
  return { cards, meta, results };
}
