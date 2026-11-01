import { exportSiteCatalog } from "../siteExport.js";
import { newCounters } from "../upsert.js";
import type { JobDef } from "./context.js";

/**
 * Gera catalog.json e catalog.meta.json nos destinos de SITE_EXPORT_DIRS (separados por ';').
 * Sem destinos configurados o job nao faz nada. Nunca faz git: a publicacao e `npm run site:publish`.
 * Roda 20 min depois do catalog.rerank, na mesma fila (concorrencia 1).
 */
export const siteExport: JobDef = {
  name: "site.export",
  queue: "maintenance",
  source: "MANUAL",
  schedule: { pattern: "20 4 * * *" },
  async run(ctx) {
    const dirs = (process.env.SITE_EXPORT_DIRS ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    if (dirs.length === 0) {
      return { counters: newCounters(), meta: { skipped: "SITE_EXPORT_DIRS vazio" } };
    }
    const { meta, results } = await exportSiteCatalog(ctx.db, dirs, { now: ctx.now() });
    const written = results.filter((r) => r.status === "WRITTEN").length;
    return {
      counters: { ...newCounters(), seen: meta.total, updated: written },
      meta: { hash: meta.hash.slice(0, 12), total: meta.total, written, unchanged: results.length - written },
    };
  },
};
