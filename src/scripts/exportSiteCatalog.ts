/**
 * Exporta o catalogo publico (catalog.json + catalog.meta.json) do banco do bot para os sites.
 *
 *   npm run site:export                       # destinos de SITE_EXPORT_DIRS (separados por ';') ou ./docs
 *   npm run site:export -- --out=docs --out="../Kovu Anime/public/assets/kogu"
 *   npm run site:export -- --dry-run
 *
 * So le o banco (conexao read-only) e so escreve nos diretorios de destino. Nao faz git.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { exportSiteCatalog, resolveExportDirs, type SiteMeta, type DirWriteResult } from "../catalog/siteExport.js";
import { requireEnv } from "../config/env.js";
import * as schema from "../infra/db/schema/index.js";

export interface ExportArgs {
  out: string[];
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): ExportArgs {
  const args: ExportArgs = { out: [], dryRun: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--out=")) {
      const v = a.slice("--out=".length).trim();
      if (v !== "") args.out.push(v);
    }
  }
  return args;
}

export function formatReport(meta: SiteMeta, results: readonly DirWriteResult[]): string {
  const lines = [
    `cartas: ${meta.total}  hash: ${meta.hash.slice(0, 12)}  schema: v${meta.schemaVersion}`,
    `por tier: ${JSON.stringify(meta.counts.byTier)}`,
    `por nicho: ${JSON.stringify(meta.counts.byNiche)}`,
    ...results.map((r) => `${r.status.padEnd(9)} ${r.dir}`),
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dirs = resolveExportDirs({ out: args.out, env: process.env.SITE_EXPORT_DIRS });
  // Conexao somente leitura: o exportador nunca escreve no banco.
  const client = postgres(requireEnv("DATABASE_URL"), {
    max: 2,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { default_transaction_read_only: true },
  });
  try {
    const db = drizzle(client, { schema });
    const { meta, results } = await exportSiteCatalog(db, dirs, { dryRun: args.dryRun });
    console.log(formatReport(meta, results));
    if (args.dryRun) console.log("(dry-run: nada foi escrito)");
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
