import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../catalog/executor.js";
import { mythicCap, roleRank, tierRank, thresholdsFor, type NicheFamily } from "../catalog/prestige.js";
import { ENTITY_TIERS, TIER_AETHER_BAND, type EntityTier } from "../config/gacha.js";

/**
 * Auditoria de prestigio (somente leitura): top 25 por nicho com tier e preco, invariantes do
 * spec (docs/raridade-por-nicho.md, secao 7), cartas sem nicho, curadas sem revisao e candidatas a
 * merge. Grava `.cache/prestige-audit.md`. Sai com codigo 1 se houver violacao de invariante.
 *
 * Uso: npm run catalog:audit -- [--niche=<chave>] [--top=25] [--out=<arquivo>]
 */

export const TOP_N = 25;
export const DEFAULT_OUT = ".cache/prestige-audit.md";

export interface AuditRow {
  id: number;
  slug: string;
  name: string;
  nameNormalized: string;
  nicheKey: string | null;
  nicheFamily: NicheFamily | null;
  prestige: number | null;
  prestigeSource: string | null;
  tier: EntityTier;
  baseAether: number;
  edition: string | null;
  parentId: number | null;
  seriesId: number | null;
  seriesTitle: string | null;
  role: string | null;
  tierFloor: EntityTier | null;
  /** Ator da ultima linha de prestige_audit; termina em ":unreviewed" quando a curadoria nao foi revisada. */
  lastActor: string | null;
}

export type ViolationKind =
  | "TIER_INVERSION"
  | "PRICE_INVERSION"
  | "SERIES_ROLE"
  | "MYTHIC_CAP"
  | "MYTHIC_BELOW_THRESHOLD"
  | "BAND";

export interface Violation {
  kind: ViolationKind;
  niche: string;
  detail: string;
  ids: number[];
}

export interface DuplicateGroup {
  normalizedName: string;
  sameSeries: boolean;
  members: { id: number; slug: string; name: string; series: string | null; niche: string | null }[];
}

export interface AuditResult {
  niches: {
    key: string;
    family: NicheFamily;
    count: number;
    byTier: Record<EntityTier, number>;
    top: AuditRow[];
    hasTop: boolean;
  }[];
  violations: Violation[];
  /** Inversoes causadas por piso de tier da curadoria (esperadas; so informativas). */
  floorExceptions: Violation[];
  withoutNiche: AuditRow[];
  unreviewed: AuditRow[];
  duplicates: DuplicateGroup[];
}

const isDerivedEdition = (r: AuditRow) => r.edition !== null && r.edition !== "BASIC" && r.parentId !== null;
const isRegular = (r: AuditRow) => r.edition === null;

/** Analise pura: recebe as linhas ja carregadas. */
export function analyzePrestige(rows: readonly AuditRow[], topN = TOP_N): AuditResult {
  const result: AuditResult = {
    niches: [],
    violations: [],
    floorExceptions: [],
    withoutNiche: [],
    unreviewed: [],
    duplicates: [],
  };
  const cards = rows.filter((r) => !isDerivedEdition(r));

  result.withoutNiche = cards.filter((r) => r.nicheKey === null);
  result.unreviewed = cards.filter(
    (r) =>
      (r.prestigeSource === "CURATED" || r.prestigeSource === "OVERRIDE") &&
      (r.lastActor === null || r.lastActor.endsWith(":unreviewed"))
  );

  const byNiche = new Map<string, AuditRow[]>();
  for (const r of cards) {
    if (!r.nicheKey || r.prestige === null) continue;
    let l = byNiche.get(r.nicheKey);
    if (!l) byNiche.set(r.nicheKey, (l = []));
    l.push(r);
  }

  for (const [key, all] of [...byNiche].sort((a, b) => a[0].localeCompare(b[0]))) {
    const family = all[0].nicheFamily ?? "fiction";
    const regular = all.filter(isRegular);
    const sorted = [...regular].sort((a, b) => b.prestige! - a.prestige! || a.id - b.id);
    const byTier = Object.fromEntries(ENTITY_TIERS.map((t) => [t, 0])) as Record<EntityTier, number>;
    for (const r of regular) byTier[r.tier]++;
    result.niches.push({
      key,
      family,
      count: regular.length,
      byTier,
      top: sorted.slice(0, topN),
      hasTop: regular.length === 0 || byTier.LEGENDARY + byTier.MYTHIC > 0,
    });

    // Invariante 1: monotonia de tier e preco no nicho (prestigio estritamente maior => tier/preco >=).
    let minTier: AuditRow | null = null;
    let minPrice: AuditRow | null = null;
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].prestige === sorted[i].prestige) j++;
      for (let k = i; k <= j; k++) {
        const r = sorted[k];
        const floored = r.tierFloor !== null && r.tier === r.tierFloor;
        if (minTier && tierRank(r.tier) > tierRank(minTier.tier)) {
          const v: Violation = {
            kind: "TIER_INVERSION",
            niche: key,
            detail: `${r.name} (${r.prestige}, ${r.tier}) acima de ${minTier.name} (${minTier.prestige}, ${minTier.tier})${floored ? " [piso da curadoria]" : ""}`,
            ids: [minTier.id, r.id],
          };
          (floored ? result.floorExceptions : result.violations).push(v);
        } else if (minPrice && r.baseAether > minPrice.baseAether) {
          const v: Violation = {
            kind: "PRICE_INVERSION",
            niche: key,
            detail: `${r.name} (${r.prestige}, ${r.baseAether}) custa mais que ${minPrice.name} (${minPrice.prestige}, ${minPrice.baseAether})${floored ? " [piso da curadoria]" : ""}`,
            ids: [minPrice.id, r.id],
          };
          (floored ? result.floorExceptions : result.violations).push(v);
        }
      }
      for (let k = i; k <= j; k++) {
        const r = sorted[k];
        if (!minTier || tierRank(r.tier) < tierRank(minTier.tier)) minTier = r;
        if (!minPrice || r.baseAether < minPrice.baseAether) minPrice = r;
      }
      i = j + 1;
    }

    // Invariante 5: teto de MYTHIC (so em nicho grande) e limiar.
    const th = thresholdsFor(family);
    const mythics = regular.filter((r) => r.tier === "MYTHIC");
    if (mythics.length > mythicCap(regular.length)) {
      result.violations.push({
        kind: "MYTHIC_CAP",
        niche: key,
        detail: `${mythics.length} miticas para ${regular.length} cartas (maximo ${mythicCap(regular.length)})`,
        ids: mythics.map((r) => r.id),
      });
    }
    for (const r of mythics) {
      if (r.prestige! < th.MYTHIC) {
        result.violations.push({
          kind: "MYTHIC_BELOW_THRESHOLD",
          niche: key,
          detail: `${r.name} e MYTHIC com prestigio ${r.prestige} (limiar ${th.MYTHIC})`,
          ids: [r.id],
        });
      }
    }
  }

  // Invariante 4: preco dentro da faixa do tier (toda carta, comum ou edicao).
  for (const r of rows) {
    const band = TIER_AETHER_BAND[r.tier];
    if (r.baseAether < band.min || r.baseAether > band.max) {
      result.violations.push({
        kind: "BAND",
        niche: r.nicheKey ?? "-",
        detail: `${r.name} (${r.tier}) custa ${r.baseAether}, fora de ${band.min}..${band.max}`,
        ids: [r.id],
      });
    }
  }

  // Invariante 2: coerencia na serie (papel maior nunca com prestigio menor).
  const bySeries = new Map<number, AuditRow[]>();
  for (const r of cards) {
    if (r.seriesId === null || r.prestige === null || r.nicheFamily !== "fiction") continue;
    let l = bySeries.get(r.seriesId);
    if (!l) bySeries.set(r.seriesId, (l = []));
    l.push(r);
  }
  for (const members of bySeries.values()) {
    const ordered = [...members].sort((a, b) => roleRank(b.role) - roleRank(a.role) || a.id - b.id);
    for (const high of ordered) {
      const low = ordered.find(
        (l) => roleRank(l.role) < roleRank(high.role) && l.prestige! > high.prestige!
      );
      if (low) {
        result.violations.push({
          kind: "SERIES_ROLE",
          niche: high.nicheKey ?? "-",
          detail: `${high.seriesTitle ?? "serie " + high.seriesId}: ${high.name} (${high.role ?? "sem papel"}, ${high.prestige}) abaixo de ${low.name} (${low.role ?? "sem papel"}, ${low.prestige})`,
          ids: [high.id, low.id],
        });
      }
    }
  }

  // Duplicatas: mesmo nome normalizado (candidatos a merge; nada e mesclado automaticamente).
  const byName = new Map<string, AuditRow[]>();
  for (const r of cards) {
    let l = byName.get(r.nameNormalized);
    if (!l) byName.set(r.nameNormalized, (l = []));
    l.push(r);
  }
  for (const [normalizedName, members] of byName) {
    if (members.length < 2) continue;
    const series = new Set(members.map((m) => m.seriesTitle ?? ""));
    result.duplicates.push({
      normalizedName,
      sameSeries: series.size < members.length,
      members: members.map((m) => ({
        id: m.id,
        slug: m.slug,
        name: m.name,
        series: m.seriesTitle,
        niche: m.nicheKey,
      })),
    });
  }
  result.duplicates.sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
  return result;
}

/* ------------------------------------------------------------------ */
/* Relatorio                                                          */
/* ------------------------------------------------------------------ */

const fmt = (n: number | null) => (n === null ? "-" : String(Math.round(n * 100) / 100));

export function renderAuditMarkdown(r: AuditResult): string {
  const L: string[] = ["# Auditoria de prestigio", ""];
  L.push("## Resumo", "");
  L.push(`- Nichos: ${r.niches.length}`);
  L.push(`- Violacoes de invariantes: ${r.violations.length}`);
  L.push(`- Inversoes por piso da curadoria (esperadas): ${r.floorExceptions.length}`);
  L.push(`- Cartas sem nicho: ${r.withoutNiche.length}`);
  L.push(`- Prestigio curado sem revisao: ${r.unreviewed.length}`);
  L.push(`- Grupos de duplicatas (candidatos a merge): ${r.duplicates.length}`, "");

  L.push("## Violacoes", "");
  if (r.violations.length === 0) L.push("Nenhuma.", "");
  for (const v of r.violations) L.push(`- [${v.kind}] ${v.niche}: ${v.detail}`);
  if (r.violations.length > 0) L.push("");

  if (r.floorExceptions.length > 0) {
    L.push("## Inversoes por piso da curadoria", "");
    for (const v of r.floorExceptions) L.push(`- [${v.kind}] ${v.niche}: ${v.detail}`);
    L.push("");
  }

  for (const n of r.niches) {
    L.push(`## ${n.key} (${n.family}, ${n.count} cartas)`, "");
    L.push(
      "Tiers: " + [...ENTITY_TIERS].reverse().map((t) => `${t} ${n.byTier[t]}`).join(", ") +
        (n.hasTop ? "" : "  **SEM TOPO (nenhuma LEGENDARY ou MYTHIC)**"),
      ""
    );
    L.push("| # | Carta | Prestigio | Origem | Tier | Preco |", "|---|---|---|---|---|---|");
    n.top.forEach((c, i) =>
      L.push(`| ${i + 1} | ${c.name} | ${fmt(c.prestige)} | ${c.prestigeSource ?? "-"} | ${c.tier} | ${c.baseAether} |`)
    );
    L.push("");
  }

  L.push("## Cartas sem nicho", "");
  if (r.withoutNiche.length === 0) L.push("Nenhuma.", "");
  for (const c of r.withoutNiche) L.push(`- #${c.id} ${c.name} (${c.slug})`);
  if (r.withoutNiche.length > 0) L.push("");

  L.push("## Prestigio curado sem revisao", "");
  if (r.unreviewed.length === 0) L.push("Nenhum.", "");
  for (const c of r.unreviewed) L.push(`- #${c.id} ${c.name} (${c.nicheKey}, ${fmt(c.prestige)}, ${c.prestigeSource})`);
  if (r.unreviewed.length > 0) L.push("");

  L.push("## Candidatos a merge (mesmo nome normalizado)", "");
  if (r.duplicates.length === 0) L.push("Nenhum.", "");
  for (const d of r.duplicates) {
    L.push(`- "${d.normalizedName}"${d.sameSeries ? " (mesma serie)" : ""}: ` +
      d.members.map((m) => `#${m.id} ${m.name} [${m.series ?? "sem serie"}]`).join("; "));
  }
  return L.join("\n") + "\n";
}

export function renderAuditConsole(r: AuditResult): string {
  const L: string[] = [];
  for (const n of r.niches) {
    L.push(`\n== ${n.key} (${n.count} cartas) ==  ` + [...ENTITY_TIERS].reverse().map((t) => `${t[0]}${n.byTier[t]}`).join(" "));
    n.top.forEach((c, i) =>
      L.push(`${String(i + 1).padStart(3)}. ${c.name.slice(0, 40).padEnd(40)} ${fmt(c.prestige).padStart(6)} ${c.tier.padEnd(9)} ${String(c.baseAether).padStart(6)}`)
    );
    if (!n.hasTop) L.push("  ! nicho sem topo (nenhuma LEGENDARY ou MYTHIC)");
  }
  L.push(`\nViolacoes: ${r.violations.length}`);
  for (const v of r.violations.slice(0, 100)) L.push(`  [${v.kind}] ${v.niche}: ${v.detail}`);
  if (r.violations.length > 100) L.push(`  ... e mais ${r.violations.length - 100} (veja o arquivo)`);
  L.push(`Inversoes por piso da curadoria (esperadas): ${r.floorExceptions.length}`);
  L.push(`Cartas sem nicho: ${r.withoutNiche.length}`);
  L.push(`Prestigio curado sem revisao: ${r.unreviewed.length}`);
  L.push(`Candidatos a merge: ${r.duplicates.length} grupos`);
  return L.join("\n");
}

/* ------------------------------------------------------------------ */
/* Banco                                                              */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

export async function loadAuditRows(db: DbExecutor, niche?: string): Promise<AuditRow[]> {
  const rows = (await db.execute(sql`
    SELECT e.id::int AS id, e.slug, e.name, e.name_normalized AS nn, n.key AS niche_key, n.family AS niche_family,
           e.prestige, e.prestige_source, e.tier::text AS tier, e.base_aether AS aether, e.edition,
           e.parent_id::int AS parent_id, e.tier_floor,
           ps.series_id::int AS series_id, ps.title AS series_title, ps.role AS role,
           (SELECT a.actor FROM prestige_audit a WHERE a.entity_id = e.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_actor
    FROM entities e
    LEFT JOIN niches n ON n.id = e.niche_id
    LEFT JOIN LATERAL (
      SELECT es.series_id, es.role, s.title FROM entity_series es JOIN series s ON s.id = es.series_id
      WHERE es.entity_id = e.id ORDER BY es.is_primary DESC, es.series_id ASC LIMIT 1
    ) ps ON true
    WHERE e.status = 'ACTIVE'`)) as unknown as Row[];
  const out = rows.map<AuditRow>((r) => ({
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    nameNormalized: r.nn as string,
    nicheKey: (r.niche_key as string | null) ?? null,
    nicheFamily: (r.niche_family as NicheFamily | null) ?? null,
    prestige: r.prestige === null || r.prestige === undefined ? null : Number(r.prestige),
    prestigeSource: (r.prestige_source as string | null) ?? null,
    tier: r.tier as EntityTier,
    baseAether: Number(r.aether),
    edition: (r.edition as string | null) ?? null,
    parentId: r.parent_id === null || r.parent_id === undefined ? null : Number(r.parent_id),
    seriesId: r.series_id === null || r.series_id === undefined ? null : Number(r.series_id),
    seriesTitle: (r.series_title as string | null) ?? null,
    role: (r.role as string | null) ?? null,
    tierFloor: (r.tier_floor as EntityTier | null) ?? null,
    lastActor: (r.last_actor as string | null) ?? null,
  }));
  // Edicoes BASIC (ancoras) tem tier fixo COMMON: ficam fora das checagens de tier/preco do nicho.
  return niche ? out.filter((r) => r.nicheKey === niche || r.nicheKey === null) : out;
}

export async function runAudit(
  db: DbExecutor,
  opts: { niche?: string; top?: number; out?: string } = {},
  log: (line: string) => void = () => {}
): Promise<AuditResult> {
  const result = analyzePrestige(await loadAuditRows(db, opts.niche), opts.top ?? TOP_N);
  const file = path.resolve(opts.out ?? DEFAULT_OUT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, renderAuditMarkdown(result), "utf8");
  log(renderAuditConsole(result));
  log(`\nRelatorio: ${file}`);
  return result;
}

async function main(): Promise<void> {
  const opts: { niche?: string; top?: number; out?: string } = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--(niche|top|out)=(.+)$/.exec(a);
    if (!m) throw new Error(`argumento desconhecido: ${a}`);
    if (m[1] === "niche") opts.niche = m[2];
    else if (m[1] === "out") opts.out = m[2];
    else opts.top = Math.max(1, Number(m[2]) || TOP_N);
  }
  const { db, closeDb } = await import("../infra/db/client.js");
  try {
    const r = await runAudit(db as unknown as DbExecutor, opts, (l) => console.log(l));
    if (r.violations.length > 0) process.exitCode = 1;
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
