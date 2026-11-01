import type { ScheduleSpec } from "../../infra/queue/schedules.js";
import type { JobDef } from "./context.js";
import { anilistTopCharacters } from "./anilistTopCharacters.js";
import { anilistTrending } from "./anilistTrending.js";
import { igdbPopular } from "./igdbPopular.js";
import { igdbReleases } from "./igdbReleases.js";
import { imagesVerify } from "./imagesVerify.js";
import { jikanEnrich, jikanSeasons } from "./jikanEnrich.js";
import { maintenancePrune } from "./maintenancePrune.js";
import { catalogRerank } from "./rerank.js";
import { siteExport } from "./siteExport.js";
import { releaseWindowsExpire } from "./releaseWindowsExpire.js";
import { tmdbTrending } from "./tmdbTrending.js";

/**
 * Tabela de jobs e agenda (UTC):
 *  anilist.trending 6h | anilist.topCharacters diario 02:30 | jikan.enrich diario 05:00 |
 *  jikan.seasons 12h | igdb.releases 12h | igdb.popular semanal (dom 04:00) | tmdb.trending diario 03:00 |
 *  catalog.rerank diario 04:00 | site.export diario 04:20 | images.verify 1h | releaseWindows.expire 1h | maintenance.prune diario 04:30.
 * Cada fila (queue) tem um worker com concorrencia 1, entao jobs da mesma fonte nunca se sobrepoem.
 */
export const JOBS: readonly JobDef[] = [
  anilistTrending,
  anilistTopCharacters,
  jikanEnrich,
  jikanSeasons,
  igdbReleases,
  igdbPopular,
  tmdbTrending,
  catalogRerank,
  siteExport,
  imagesVerify,
  releaseWindowsExpire,
  maintenancePrune,
];

export function findJob(name: string): JobDef | undefined {
  const exact = JOBS.find((j) => j.name === name);
  if (exact) return exact;
  const prefixed = JOBS.find((j) => j.name === `catalog.${name}`);
  if (prefixed) return prefixed;
  const bySuffix = JOBS.filter((j) => j.name.split(".").pop() === name);
  return bySuffix.length === 1 ? bySuffix[0] : undefined;
}

/** Job padrao de `sync:once --source=X`. */
export const DEFAULT_JOB_BY_SOURCE: Record<string, string> = {
  anilist: "anilist.topCharacters",
  jikan: "jikan.enrich",
  igdb: "igdb.popular",
  tmdb: "tmdb.trending",
};

export function toScheduleSpecs(defs: readonly JobDef[]): ScheduleSpec[] {
  return defs.map((d) => ({
    id: d.name,
    queue: d.queue,
    jobName: d.name,
    ...(d.schedule.every !== undefined ? { every: d.schedule.every } : {}),
    ...(d.schedule.pattern !== undefined ? { pattern: d.schedule.pattern } : {}),
  }));
}
