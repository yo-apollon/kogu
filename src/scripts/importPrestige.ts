import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { rerankCatalog } from "../catalog/jobs/rerank.js";
import type { DbExecutor } from "../catalog/executor.js";
import { ENTITY_TIERS, type EntityTier } from "../config/gacha.js";
import { nameTokens, normalizeName, trigramSimilarity } from "../lib/text/normalize.js";

/**
 * Importa o prestigio curado (data/prestige/curated/fiction.json e people.json) para `entities`:
 * grava `niche_id`, `prestige`, `prestige_source` (CURATED, ou OVERRIDE quando o registro traz
 * `override` + `overrideReason`), `prestige_reason`, `tier_floor` e uma linha em `prestige_audit`.
 * Depois preenche o nicho das entidades sem curadoria (por franquia/universo/serie) e, com --apply,
 * roda o rerank. Dry-run por padrao.
 *
 * Uso: npm run catalog:prestige -- [--apply] [--niche=<chave>] [--dir=<pasta>] [--actor=<texto>]
 */

export const DEFAULT_CURATED_DIR = "data/prestige/curated";
const TIER_FLOORS = ENTITY_TIERS.filter((t) => t !== "MYTHIC");

export interface ImportOptions {
  apply: boolean;
  niche?: string;
  dir: string;
  actor: string;
}

export function parseArgs(argv: readonly string[]): ImportOptions {
  const out: ImportOptions = { apply: false, dir: DEFAULT_CURATED_DIR, actor: "catalog:prestige" };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.apply = false;
    else {
      const m = /^--(niche|dir|actor)=(.+)$/.exec(a);
      if (!m) throw new Error(`argumento desconhecido: ${a}`);
      if (m[1] === "niche") out.niche = m[2];
      else if (m[1] === "dir") out.dir = m[2];
      else out.actor = m[2];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Registros curados normalizados                                     */
/* ------------------------------------------------------------------ */

export interface CuratedRecord {
  origin: "fiction" | "people";
  /** Identificacao legivel para o relatorio. */
  label: string;
  name: string;
  niche: string;
  slug?: string;
  aliasSlugs: string[];
  catalogId?: number;
  series?: string;
  value: number;
  source: "CURATED" | "OVERRIDE";
  reason: string;
  reviewed: boolean;
  reviewedBy?: string;
  tierFloor: EntityTier | null;
  errors: string[];
}

type Json = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function resolveValue(r: Json, errors: string[]): { value: number; source: "CURATED" | "OVERRIDE"; reason: string } {
  const base = isNum(r.prestigeProposal) ? r.prestigeProposal : NaN;
  const rationale = str(r.rationale) ?? "";
  if (r.override !== undefined && r.override !== null) {
    const reasonText = str(r.overrideReason);
    if (!isNum(r.override) || r.override < 0 || r.override > 100) errors.push("override fora de 0..100");
    if (!reasonText) errors.push("override exige overrideReason");
    return { value: isNum(r.override) ? r.override : NaN, source: "OVERRIDE", reason: reasonText ?? "" };
  }
  if (!(base >= 0 && base <= 100)) errors.push("prestigeProposal ausente ou fora de 0..100");
  return { value: base, source: "CURATED", reason: rationale };
}

function floorOf(r: Json, defaultFloor: EntityTier | null, errors: string[]): EntityTier | null {
  if (r.tierFloor !== undefined && r.tierFloor !== null) {
    if (typeof r.tierFloor === "string" && (TIER_FLOORS as readonly string[]).includes(r.tierFloor)) {
      return r.tierFloor as EntityTier;
    }
    errors.push(`tierFloor invalido: ${String(r.tierFloor)}`);
    return null;
  }
  return defaultFloor;
}

/** fiction.json: `characters[]`. */
export function normalizeFiction(json: unknown): CuratedRecord[] {
  const list = ((json as Json | null)?.characters as Json[] | undefined) ?? [];
  return list.map((r) => {
    const errors: string[] = [];
    const name = str(r.name) ?? "";
    const niche = str(r.niche) ?? "";
    if (!name) errors.push("sem name");
    if (!niche) errors.push("sem niche");
    const v = resolveValue(r, errors);
    return {
      origin: "fiction" as const,
      label: `${name} [${str(r.series) ?? "?"}]`,
      name,
      niche,
      aliasSlugs: [],
      catalogId: isNum(r.catalogId) ? r.catalogId : undefined,
      series: str(r.series),
      ...v,
      reviewed: r.reviewed === true,
      reviewedBy: str(r.reviewedBy),
      tierFloor: floorOf(r, null, errors),
      errors,
    };
  });
}

/**
 * people.json: `people[]`. Pessoas reais da lista curada nunca ficam abaixo de RARE; `eliteActive: true`
 * (estrela atual com titulos grandes) sobe o piso para EPIC; `tierFloor` explicito vence os dois.
 */
export function normalizePeople(json: unknown): CuratedRecord[] {
  const list = ((json as Json | null)?.people as Json[] | undefined) ?? [];
  return list.map((r) => {
    const errors: string[] = [];
    const name = str(r.name) ?? "";
    const niche = str(r.niche) ?? "";
    const slug = str(r.slug);
    if (!name) errors.push("sem name");
    if (!niche) errors.push("sem niche");
    const v = resolveValue(r, errors);
    return {
      origin: "people" as const,
      label: slug ?? name,
      name,
      niche,
      slug,
      aliasSlugs: Array.isArray(r.aliasSlugs) ? r.aliasSlugs.filter((s): s is string => typeof s === "string") : [],
      catalogId: isNum(r.catalogId) ? r.catalogId : undefined,
      ...v,
      reviewed: r.reviewed === true,
      reviewedBy: str(r.reviewedBy),
      tierFloor: floorOf(r, r.eliteActive === true ? "EPIC" : "RARE", errors),
      errors,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Casamento com entities                                             */
/* ------------------------------------------------------------------ */

export interface EntityRow {
  id: number;
  slug: string;
  name: string;
  nameNormalized: string;
  seriesTitle: string | null;
  franchiseName: string | null;
  nicheKey: string | null;
  prestige: number | null;
  prestigeSource: string | null;
  tierFloor: string | null;
}

export type MatchResult =
  | { status: "matched"; ids: number[]; by: string }
  | { status: "ambiguous"; candidates: number[]; why: string }
  | { status: "unmatched" };

/** Nomes compativeis: iguais ou um conjunto de tokens contido no outro. */
export function namesConsistent(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  const [small, big] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return small.every((t) => big.includes(t));
}

function seriesConsistent(rec: CuratedRecord, e: EntityRow): boolean {
  if (!rec.series) return true;
  const want = normalizeName(rec.series);
  return [e.seriesTitle, e.franchiseName].some((c) => {
    if (!c) return false;
    const have = normalizeName(c);
    return have === want || have.includes(want) || want.includes(have) || trigramSimilarity(have, want) >= 0.5;
  });
}

/** Casa um registro curado com entidades. Nunca escolhe entre candidatos ambiguos. */
export function matchRecord(rec: CuratedRecord, entities: readonly EntityRow[]): MatchResult {
  const bySlug = new Map(entities.map((e) => [e.slug, e]));
  const wantedName = normalizeName(rec.name);
  const extra = rec.aliasSlugs.map((s) => bySlug.get(s)?.id).filter((x): x is number => x !== undefined);
  const done = (ids: number[], by: string): MatchResult => ({
    status: "matched",
    ids: [...new Set([...ids, ...extra])],
    by,
  });

  if (rec.slug) {
    const e = bySlug.get(rec.slug);
    if (e) return done([e.id], "slug");
  }
  if (rec.catalogId !== undefined) {
    const e = entities.find((x) => x.id === rec.catalogId);
    if (e && namesConsistent(e.name, rec.name)) return done([e.id], "catalogId+nome");
  }

  const equal = entities.filter((e) => e.nameNormalized === wantedName || normalizeName(e.name) === wantedName);
  const inSeries = equal.filter((e) => seriesConsistent(rec, e));
  const pool = rec.origin === "fiction" ? inSeries : equal;
  if (pool.length === 1) return done([pool[0].id], "nome");
  if (pool.length > 1) return { status: "ambiguous", candidates: pool.map((e) => e.id), why: "varios com o mesmo nome" };

  // Pessoas: o seed grava apelidos no nome ("Alex Poatan Pereira (Chama)"); aceita nome contido.
  const fuzzy = entities.filter(
    (e) => namesConsistent(rec.name, e.name) && (rec.origin === "people" || seriesConsistent(rec, e))
  );
  if (fuzzy.length === 1) return done([fuzzy[0].id], "nome parcial");
  if (fuzzy.length > 1) {
    return { status: "ambiguous", candidates: fuzzy.map((e) => e.id), why: "varios nomes parecidos" };
  }
  return extra.length > 0 ? done([], "alias") : { status: "unmatched" };
}

/* ------------------------------------------------------------------ */
/* Importacao                                                         */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

export interface ImportReport {
  apply: boolean;
  records: number;
  matched: number;
  written: number;
  unchanged: number;
  invalid: { label: string; errors: string[] }[];
  unmatched: string[];
  ambiguous: { label: string; candidates: number[]; why: string }[];
  unknownNiches: string[];
  backfilled: number;
  reranked: boolean;
}

export function reviewActor(rec: CuratedRecord, actor: string): string {
  return rec.reviewed ? `${actor}:reviewed:${rec.reviewedBy ?? "owner"}` : `${actor}:unreviewed`;
}

async function loadEntities(db: DbExecutor): Promise<EntityRow[]> {
  const rows = (await db.execute(sql`
    SELECT e.id::int AS id, e.slug, e.name, e.name_normalized AS nn, n.key AS niche_key,
           e.prestige, e.prestige_source, e.tier_floor,
           (SELECT s.title FROM entity_series es JOIN series s ON s.id = es.series_id
              WHERE es.entity_id = e.id ORDER BY es.is_primary DESC, es.series_id LIMIT 1) AS series_title,
           f.name AS franchise_name
    FROM entities e
    LEFT JOIN niches n ON n.id = e.niche_id
    LEFT JOIN franchises f ON f.id = e.franchise_id
    WHERE e.parent_id IS NULL AND e.status <> 'MERGED'`)) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    nameNormalized: r.nn as string,
    seriesTitle: (r.series_title as string | null) ?? null,
    franchiseName: (r.franchise_name as string | null) ?? null,
    nicheKey: (r.niche_key as string | null) ?? null,
    prestige: r.prestige === null || r.prestige === undefined ? null : Number(r.prestige),
    prestigeSource: (r.prestige_source as string | null) ?? null,
    tierFloor: (r.tier_floor as string | null) ?? null,
  }));
}

/** Chave do nicho por franquia, universo e serie (SQL, alias fixos `x` = entities e `f` = franchises). */
const NICHE_KEY_CASE = sql`
  CASE
    WHEN f.name ILIKE '%futebol%' THEN 'sport_football'
    WHEN f.name ILIKE '%nba%' OR f.name ILIKE '%basquete%' THEN 'sport_basketball'
    WHEN f.name ILIKE '%ufc%' OR f.name ILIKE '%mma%' THEN 'sport_mma'
    WHEN f.name ILIKE '%k-pop%' OR f.name ILIKE '%j-pop%' THEN 'idol'
    WHEN f.name ILIKE 'pop global%' THEN 'music_pop'
    WHEN f.name ILIKE 'lendas da m%' THEN 'music_other'
    WHEN EXISTS (SELECT 1 FROM entity_series es JOIN series s ON s.id = es.series_id
                 WHERE es.entity_id = x.id AND s.title ILIKE ANY (ARRAY[
                   '%solo leveling%', '%tower of god%', '%beginning after the end%', '%omniscient reader%',
                   '%lookism%', '%noblesse%', '%god of high school%', '%visual novel%']))
      THEN 'manhwa_vn'
    WHEN x.universe = 'GAME' THEN 'game'
    WHEN x.universe = 'CINEMA' THEN 'cinema_tv'
    ELSE 'anime'
  END`;

/** Nicho das entidades sem curadoria, por franquia/universo/serie. Devolve quantas receberam (ou ficariam sem). */
export async function backfillNiches(db: DbExecutor, apply: boolean): Promise<number> {
  if (!apply) {
    const r = (await db.execute(sql`
      SELECT count(*)::int AS n FROM entities e
      WHERE e.niche_id IS NULL AND e.parent_id IS NULL AND e.status <> 'MERGED'`)) as unknown as Row[];
    return Number(r[0]?.n ?? 0);
  }
  const res = (await db.execute(sql`
    UPDATE entities e SET niche_id = n.id
    FROM entities x
    LEFT JOIN franchises f ON f.id = x.franchise_id
    JOIN niches n ON n.key = (${NICHE_KEY_CASE})
    WHERE e.id = x.id AND e.niche_id IS NULL AND e.parent_id IS NULL AND e.status <> 'MERGED'
    RETURNING e.id`)) as unknown as Row[];
  return res.length;
}

/** Edicoes derivadas herdam o nicho da ancora (so para coerencia de consultas; o scoring as ignora). */
async function inheritEditionNiche(db: DbExecutor): Promise<void> {
  await db.execute(sql`
    UPDATE entities c SET niche_id = p.niche_id
    FROM entities p
    WHERE c.parent_id = p.id AND p.niche_id IS NOT NULL AND c.niche_id IS DISTINCT FROM p.niche_id`);
}

export async function importPrestige(
  db: DbExecutor,
  opts: ImportOptions,
  records: readonly CuratedRecord[],
  log: (line: string) => void = () => {}
): Promise<ImportReport> {
  const report: ImportReport = {
    apply: opts.apply,
    records: 0,
    matched: 0,
    written: 0,
    unchanged: 0,
    invalid: [],
    unmatched: [],
    ambiguous: [],
    unknownNiches: [],
    backfilled: 0,
    reranked: false,
  };
  const wanted = opts.niche ? records.filter((r) => r.niche === opts.niche) : [...records];
  report.records = wanted.length;

  const nicheRows = (await db.execute(sql`SELECT id::int AS id, key FROM niches`)) as unknown as Row[];
  const nicheId = new Map(nicheRows.map((r) => [r.key as string, r.id as number]));
  const entities = await loadEntities(db);
  const claimed = new Map<number, string>();

  interface Planned {
    rec: CuratedRecord;
    ids: number[];
  }
  const plan: Planned[] = [];
  for (const rec of wanted) {
    if (rec.errors.length > 0) {
      report.invalid.push({ label: rec.label, errors: rec.errors });
      continue;
    }
    if (!nicheId.has(rec.niche)) {
      if (!report.unknownNiches.includes(rec.niche)) report.unknownNiches.push(rec.niche);
      continue;
    }
    const m = matchRecord(rec, entities);
    if (m.status === "unmatched") {
      report.unmatched.push(rec.label);
      continue;
    }
    if (m.status === "ambiguous") {
      report.ambiguous.push({ label: rec.label, candidates: m.candidates, why: m.why });
      continue;
    }
    const clash = m.ids.find((id) => claimed.has(id));
    if (clash !== undefined) {
      report.ambiguous.push({
        label: rec.label,
        candidates: [clash],
        why: `mesma entidade ja casada com "${claimed.get(clash)}"`,
      });
      continue;
    }
    for (const id of m.ids) claimed.set(id, rec.label);
    plan.push({ rec, ids: m.ids });
    report.matched++;
  }

  const byId = new Map(entities.map((e) => [e.id, e]));
  const latestActor = new Map<number, string>();
  if (plan.length > 0) {
    const ids = plan.flatMap((p) => p.ids);
    const rows = (await db.execute(sql`
      SELECT DISTINCT ON (entity_id) entity_id::int AS id, actor FROM prestige_audit
      WHERE entity_id = ANY(${sql.raw(`ARRAY[${ids.map((i) => Number(i)).join(",")}]::bigint[]`)})
      ORDER BY entity_id, created_at DESC, id DESC`)) as unknown as Row[];
    for (const r of rows) latestActor.set(r.id as number, r.actor as string);
  }

  const apply = async (tx: DbExecutor) => {
    for (const { rec, ids } of plan) {
      const actor = reviewActor(rec, opts.actor);
      for (const id of ids) {
        const cur = byId.get(id)!;
        const same =
          cur.prestige !== null &&
          Math.abs(cur.prestige - rec.value) < 0.005 &&
          cur.prestigeSource === rec.source &&
          cur.nicheKey === rec.niche &&
          (cur.tierFloor ?? null) === rec.tierFloor &&
          latestActor.get(id) === actor;
        if (same) {
          report.unchanged++;
          continue;
        }
        report.written++;
        if (!opts.apply) continue;
        await tx.execute(sql`
          UPDATE entities SET niche_id = ${nicheId.get(rec.niche)!}, prestige = ${rec.value}::real,
            prestige_source = ${rec.source}, prestige_reason = ${rec.reason}, tier_floor = ${rec.tierFloor},
            updated_at = now()
          WHERE id = ${id}`);
        await tx.execute(sql`
          INSERT INTO prestige_audit (entity_id, previous, next, source, reason, actor)
          VALUES (${id}, ${cur.prestige}::real, ${rec.value}::real, ${rec.source}, ${rec.reason}, ${actor})`);
      }
    }
    if (opts.apply) await inheritEditionNiche(tx);
  };

  if (opts.apply) {
    await db.transaction(async (tx) => {
      await apply(tx as unknown as DbExecutor);
      report.backfilled = await backfillNiches(tx as unknown as DbExecutor, true);
      await inheritEditionNiche(tx as unknown as DbExecutor);
    });
    await rerankCatalog(db);
    report.reranked = true;
  } else {
    await apply(db);
    report.backfilled = await backfillNiches(db, false);
  }
  log(formatImportReport(report));
  return report;
}

export function formatImportReport(r: ImportReport): string {
  const lines = [
    `modo: ${r.apply ? "APPLY" : "DRY-RUN (nada gravado; use --apply)"}`,
    `registros: ${r.records}  casados: ${r.matched}  ${r.apply ? "gravados" : "a gravar"}: ${r.written}  sem mudanca: ${r.unchanged}`,
    `nicho preenchido por regra (sem curadoria): ${r.backfilled}${r.apply ? "" : " (entidades sem nicho hoje)"}`,
    `nao casados: ${r.unmatched.length}`,
    ...r.unmatched.map((u) => `  - ${u}`),
    `ambiguos: ${r.ambiguous.length}`,
    ...r.ambiguous.map((a) => `  - ${a.label}: ${a.why} (ids ${a.candidates.join(", ")})`),
    `invalidos: ${r.invalid.length}`,
    ...r.invalid.map((i) => `  - ${i.label}: ${i.errors.join("; ")}`),
  ];
  if (r.unknownNiches.length > 0) lines.push(`nichos desconhecidos (ignorados): ${r.unknownNiches.join(", ")}`);
  lines.push(r.apply ? `rerank: ${r.reranked ? "executado" : "nao executado"}` : "rerank: executado ao final do --apply");
  return lines.join("\n");
}

export async function loadCuratedRecords(dir: string): Promise<CuratedRecord[]> {
  const out: CuratedRecord[] = [];
  for (const [file, normalize] of [
    ["fiction.json", normalizeFiction],
    ["people.json", normalizePeople],
  ] as const) {
    try {
      out.push(...normalize(JSON.parse(await readFile(path.join(dir, file), "utf8"))));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const records = await loadCuratedRecords(opts.dir);
  const { db, closeDb } = await import("../infra/db/client.js");
  try {
    await importPrestige(db as unknown as DbExecutor, opts, records, (l) => console.log(l));
  } finally {
    await closeDb();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
