import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { rerankCatalog } from "../catalog/jobs/rerank.js";
import type { DbExecutor } from "../catalog/executor.js";
import { EDITION_TIER, TIER_WEIGHT, type EntityEdition } from "../config/gacha.js";

/**
 * Gera as EDICOES de carta: cada personagem escolhido existe em BASIC (a propria carta, ancora),
 * EPIC e MYTHIC (linhas novas em `entities`, `parent_id` = ancora). Idempotente: o alvo e o "top N"
 * entre as cartas elegiveis (ancoras ja criadas contam), entao rodar de novo nao cria nada novo e
 * apenas completa edicoes faltantes de uma execucao interrompida.
 *
 * Uso: npm run catalog:editions -- [--top=150] [--universe=ANIME|GAME|CINEMA] [--series=<slug>]
 *                                  [--niche=<slug da franquia>] [--dry-run | --apply]
 */

export const DERIVED_EDITIONS = ["EPIC", "MYTHIC"] as const satisfies readonly EntityEdition[];
export const DEFAULT_TOP = 150;
const UNIVERSES = ["ANIME", "GAME", "CINEMA"] as const;

export interface GenerateEditionsOptions {
  top: number;
  universe?: (typeof UNIVERSES)[number];
  /** Slug de `series` (obra). */
  series?: string;
  /** Slug (ou parte do nome) da franquia: esportes, musica etc. ficam em `franchises` (ex.: "ufc-mma"). */
  niche?: string;
  apply: boolean;
}

export interface EditionsReport {
  apply: boolean;
  targets: number;
  newAnchors: number;
  existingAnchors: number;
  editionsCreated: number;
  byUniverse: Record<string, number>;
  reranked: boolean;
}

export function parseArgs(argv: readonly string[]): GenerateEditionsOptions {
  const out: GenerateEditionsOptions = { top: DEFAULT_TOP, apply: false };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a === "--dry-run") out.apply = false;
    else {
      const m = /^--(top|universe|series|niche)=(.+)$/.exec(a);
      if (!m) throw new Error(`argumento desconhecido: ${a}`);
      if (m[1] === "top") {
        const n = Number(m[2]);
        if (!Number.isInteger(n) || n <= 0) throw new Error("--top precisa ser um inteiro positivo");
        out.top = n;
      } else if (m[1] === "universe") {
        const u = m[2].toUpperCase();
        if (!(UNIVERSES as readonly string[]).includes(u)) throw new Error("--universe: ANIME, GAME ou CINEMA");
        out.universe = u as GenerateEditionsOptions["universe"];
      } else if (m[1] === "series") out.series = m[2];
      else out.niche = m[2];
    }
  }
  return out;
}

type Row = Record<string, unknown>;

interface Target {
  id: number;
  slug: string;
  universe: string;
  edition: string | null;
}

/** Elegiveis: ACTIVE, comuns ou ja ancoras, personagem, genero conhecido e imagem primaria ACTIVE. */
async function pickTargets(db: DbExecutor, o: GenerateEditionsOptions): Promise<Target[]> {
  const filters = [
    sql`e.status = 'ACTIVE'`,
    sql`e.parent_id IS NULL`,
    sql`(e.edition IS NULL OR e.edition = 'BASIC')`,
    sql`e.type = 'CHARACTER'`,
    sql`e.gender <> 'UNKNOWN'`,
    sql`EXISTS (SELECT 1 FROM entity_images i WHERE i.entity_id = e.id AND i.is_primary AND i.status = 'ACTIVE')`,
  ];
  if (o.universe) filters.push(sql`e.universe = ${o.universe}::universe`);
  if (o.series) {
    filters.push(sql`EXISTS (SELECT 1 FROM entity_series es JOIN series s ON s.id = es.series_id
                             WHERE es.entity_id = e.id AND s.slug = ${o.series})`);
  }
  if (o.niche) {
    filters.push(sql`EXISTS (SELECT 1 FROM franchises f WHERE f.id = e.franchise_id
                             AND (f.slug = ${o.niche} OR f.name ILIKE ${"%" + o.niche + "%"}))`);
  }
  const rows = (await db.execute(sql`
    SELECT e.id::int AS id, e.slug, e.universe::text AS universe, e.edition
    FROM entities e
    WHERE ${sql.join(filters, sql` AND `)}
    ORDER BY e.popularity_score DESC, e.id ASC
    LIMIT ${o.top}`)) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id as number,
    slug: r.slug as string,
    universe: r.universe as string,
    edition: (r.edition as string | null) ?? null,
  }));
}

/** Cria (se faltar) a edicao `edition` da ancora; devolve true se criou. */
async function createEdition(tx: DbExecutor, anchor: Target, edition: EntityEdition): Promise<boolean> {
  const tier = EDITION_TIER[edition];
  const suffix = edition.toLowerCase();
  const created = (await tx.execute(sql`
    INSERT INTO entities (
      slug, name, name_native, name_normalized, universe, type, gender, franchise_id, description,
      status, is_adult, popularity_score, tier, roll_weight, parent_id, edition
    )
    SELECT a.slug || ${"-" + suffix}, a.name, a.name_native, a.name_normalized, a.universe, a.type, a.gender,
           a.franchise_id, a.description, 'ACTIVE', a.is_adult, a.popularity_score,
           ${tier}::entity_tier, ${TIER_WEIGHT[tier]}::real, a.id, ${edition}
    FROM entities a
    WHERE a.id = ${anchor.id}
      AND NOT EXISTS (SELECT 1 FROM entities x WHERE x.parent_id = a.id AND x.edition = ${edition})
    ON CONFLICT (slug) DO NOTHING
    RETURNING id::int AS id`)) as unknown as Row[];
  if (created.length === 0) return false;
  const id = created[0].id as number;
  await tx.execute(sql`
    INSERT INTO entity_series (entity_id, series_id, role, is_primary)
    SELECT ${id}, series_id, role, is_primary FROM entity_series WHERE entity_id = ${anchor.id}
    ON CONFLICT DO NOTHING`);
  await tx.execute(sql`
    INSERT INTO entity_images (entity_id, url, source, status, is_primary, content_hash, width, height)
    SELECT ${id}, url, source, 'ACTIVE', true, content_hash, width, height
    FROM entity_images WHERE entity_id = ${anchor.id} AND is_primary AND status = 'ACTIVE'
    LIMIT 1`);
  return true;
}

export async function generateEditions(
  db: DbExecutor,
  o: GenerateEditionsOptions,
  log: (line: string) => void = () => {}
): Promise<EditionsReport> {
  const targets = await pickTargets(db, o);
  const report: EditionsReport = {
    apply: o.apply,
    targets: targets.length,
    newAnchors: 0,
    existingAnchors: 0,
    editionsCreated: 0,
    byUniverse: {},
    reranked: false,
  };

  for (const t of targets) {
    const isNew = t.edition === null;
    if (isNew) report.newAnchors++;
    else report.existingAnchors++;

    if (!o.apply) {
      // Dry-run: conta o que seria criado.
      const have = (await db.execute(sql`
        SELECT edition FROM entities WHERE parent_id = ${t.id} AND edition IN ('EPIC', 'MYTHIC')`)) as unknown as Row[];
      const missing = DERIVED_EDITIONS.filter((ed) => !have.some((h) => h.edition === ed)).length;
      report.editionsCreated += missing;
      if (missing > 0 || isNew) report.byUniverse[t.universe] = (report.byUniverse[t.universe] ?? 0) + 1;
      continue;
    }

    await db.transaction(async (tx) => {
      if (isNew) {
        await tx.execute(sql`
          UPDATE entities SET edition = 'BASIC', tier = ${EDITION_TIER.BASIC}::entity_tier,
                              popularity_rank = NULL, updated_at = now()
          WHERE id = ${t.id} AND edition IS NULL`);
      }
      let made = 0;
      for (const ed of DERIVED_EDITIONS) if (await createEdition(tx as unknown as DbExecutor, t, ed)) made++;
      report.editionsCreated += made;
      if (isNew || made > 0) report.byUniverse[t.universe] = (report.byUniverse[t.universe] ?? 0) + 1;
    });
  }

  if (o.apply && targets.length > 0) {
    await rerankCatalog(db);
    report.reranked = true;
  }
  log(formatEditionsReport(report));
  return report;
}

export function formatEditionsReport(r: EditionsReport): string {
  const lines = [
    `modo: ${r.apply ? "APPLY" : "DRY-RUN (nada gravado; use --apply)"}`,
    `alvos: ${r.targets}  ancoras novas: ${r.newAnchors}  ancoras ja existentes: ${r.existingAnchors}`,
    `edicoes ${r.apply ? "criadas" : "a criar"}: ${r.editionsCreated}`,
    `por universo: ${JSON.stringify(r.byUniverse)}`,
  ];
  lines.push(
    r.apply
      ? `rerank: ${r.reranked ? "executado" : "nao necessario"}`
      : "rerank: executado automaticamente ao final do --apply"
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { db, closeDb } = await import("../infra/db/client.js");
  try {
    await generateEditions(db as unknown as DbExecutor, opts, (l) => console.log(l));
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
