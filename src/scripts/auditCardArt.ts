/**
 * Auditoria da arte das cartas (SOMENTE LEITURA: so SELECT / leitura de arquivo).
 *
 *   npm run catalog:art-audit                         # entidades ACTIVE do banco (DATABASE_URL)
 *   npm run catalog:art-audit -- --catalog=docs/catalog.json   # catalogo exportado (sem banco)
 *
 * Saida: resumo por classificacao no console, as 40 piores e `.cache/art-audit.csv`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { classifyArt, isItemSubject, type ArtKind } from "../catalog/artQuality.js";
import type { DbExecutor } from "../catalog/executor.js";
import { pickEmblem } from "../canvas/emblems/pick.js";
import { entities, entityImages, entitySeries, series } from "../infra/db/schema/index.js";

export interface AuditInput {
  name: string;
  slug: string;
  universe: string;
  series: string;
  type: string | null;
  tier: string;
  imageUrl: string | null;
}

export interface AuditRow extends AuditInput {
  kind: ArtKind;
  trusted: boolean;
  reason: string;
  /** Entidades com NOME diferente que usam a mesma URL. */
  sharedWithOthers: number;
  /** Emblema que a carta passaria a usar (vazio = usa a imagem). */
  emblem: string;
}

const TIER_ORDER = ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"];
const norm = (s: string): string => s.trim().toLowerCase();

export function buildAuditRows(items: readonly AuditInput[]): AuditRow[] {
  const namesByUrl = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.imageUrl) continue;
    const set = namesByUrl.get(it.imageUrl) ?? new Set<string>();
    set.add(norm(it.name));
    namesByUrl.set(it.imageUrl, set);
  }
  return items.map((it) => {
    const c = classifyArt({ type: it.type, universe: it.universe, imageUrl: it.imageUrl, name: it.name });
    const shared = it.imageUrl ? Math.max(0, (namesByUrl.get(it.imageUrl)?.size ?? 1) - 1) : 0;
    const emblem = c.trusted ? "" : isItemSubject({ type: it.type, name: it.name }) ? pickEmblem(it.name) : "character";
    return { ...it, kind: c.kind, trusted: c.trusted, reason: c.reason, sharedWithOthers: shared, emblem };
  });
}

/** Pior primeiro: nao confiavel, mais compartilhada, tier mais alto. */
export function worstRows(rows: readonly AuditRow[], limit = 40): AuditRow[] {
  const score = (r: AuditRow): number =>
    (r.trusted ? 0 : 1000) + Math.min(r.sharedWithOthers, 50) * 10 + TIER_ORDER.indexOf(r.tier);
  return [...rows].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface AuditSummary {
  total: number;
  byKind: Record<string, number>;
  untrusted: number;
  /** Cartas que passam a usar emblema (nao confiaveis). */
  emblemCount: number;
  itemEmblems: number;
  characterEmblems: number;
  sharedImages: number;
}

export function summarize(rows: readonly AuditRow[]): AuditSummary {
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const untrusted = rows.filter((r) => !r.trusted);
  return {
    total: rows.length,
    byKind,
    untrusted: untrusted.length,
    emblemCount: untrusted.length,
    itemEmblems: untrusted.filter((r) => r.emblem !== "character").length,
    characterEmblems: untrusted.filter((r) => r.emblem === "character").length,
    sharedImages: rows.filter((r) => r.sharedWithOthers > 0).length,
  };
}

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(rows: readonly AuditRow[]): string {
  const head = ["name", "slug", "series", "universe", "type", "tier", "url", "kind", "trusted", "shared_with_other_names", "emblem", "reason"];
  const lines = rows.map((r) =>
    [r.name, r.slug, r.series, r.universe, r.type ?? "", r.tier, r.imageUrl ?? "", r.kind, r.trusted, r.sharedWithOthers, r.emblem, r.reason]
      .map(csvCell)
      .join(",")
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

export function formatSummary(s: AuditSummary): string {
  const kinds = Object.entries(s.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${k.padEnd(12)} ${n}`);
  return [
    `cartas auditadas: ${s.total}`,
    "por classificacao:",
    ...kinds,
    `nao confiaveis (passam a usar emblema): ${s.emblemCount} (itens: ${s.itemEmblems}, personagens: ${s.characterEmblems})`,
    `cartas cuja imagem e usada por outro nome: ${s.sharedImages}`,
  ].join("\n");
}

/** Leitura (SELECT) das entidades ACTIVE com imagem primaria e serie primaria. */
export async function loadFromDb(db: DbExecutor): Promise<AuditInput[]> {
  const rows = await db
    .select({
      name: entities.name,
      slug: entities.slug,
      universe: entities.universe,
      type: entities.type,
      tier: entities.tier,
      series: series.title,
      imageUrl: entityImages.url,
    })
    .from(entities)
    .leftJoin(entityImages, and(eq(entityImages.entityId, entities.id), eq(entityImages.isPrimary, true)))
    .leftJoin(entitySeries, and(eq(entitySeries.entityId, entities.id), eq(entitySeries.isPrimary, true)))
    .leftJoin(series, eq(series.id, entitySeries.seriesId))
    .where(eq(entities.status, "ACTIVE"))
    .orderBy(asc(entities.id));
  return rows.map((r) => ({ ...r, series: r.series ?? "", imageUrl: r.imageUrl ?? null }));
}


interface ExportedCard {
  id?: number;
  name: string;
  seriesTitle?: string | null;
  universe: string;
  tier: string;
  imageUrl?: string | null;
  type?: string | null;
  slug?: string;
}

/** Leitura do catalogo exportado (docs/catalog.json): sem tipo; o tipo e inferido pelo nome. */
export async function loadFromCatalogFile(file: string): Promise<AuditInput[]> {
  const cards = JSON.parse(await fs.readFile(file, "utf8")) as ExportedCard[];
  return cards.map((c) => ({
    name: c.name,
    slug: c.slug ?? String(c.id ?? c.name),
    universe: c.universe,
    series: c.seriesTitle ?? "",
    type: c.type ?? null,
    tier: c.tier,
    imageUrl: c.imageUrl ?? null,
  }));
}

async function main(): Promise<void> {
  const catalogArg = process.argv.slice(2).find((a) => a.startsWith("--catalog="))?.slice("--catalog=".length);
  let items: AuditInput[];
  let source: string;
  if (catalogArg) {
    items = await loadFromCatalogFile(path.resolve(catalogArg));
    source = catalogArg;
  } else {
    const { db, closeDb } = await import("../infra/db/client.js");
    try {
      items = await loadFromDb(db as unknown as DbExecutor);
    } finally {
      await closeDb();
    }
    source = "banco (somente SELECT)";
  }

  const rows = buildAuditRows(items);
  const out = path.resolve(".cache/art-audit.csv");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, toCsv(rows), "utf8");

  console.log(`fonte: ${source}`);
  console.log(formatSummary(summarize(rows)));
  console.log("\n40 piores:");
  for (const r of worstRows(rows)) {
    console.log(
      `  ${r.kind.padEnd(11)} ${r.trusted ? "ok " : "EMB"} x${String(r.sharedWithOthers).padEnd(2)} ${r.tier.padEnd(9)} ${r.name}${r.emblem ? ` -> ${r.emblem}` : ""}`
    );
  }
  console.log(`\nCSV: ${out}`);
}

const isEntrypoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
