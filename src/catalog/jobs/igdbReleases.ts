import type { JobDef } from "./context.js";
import { ingest } from "./ingest.js";

/** Jogos lancados entre -30d e +7d acima do limiar de hype (o filtro e do adapter). */
export const igdbReleases: JobDef = {
  name: "igdb.releases",
  queue: "igdb",
  source: "IGDB",
  sourceId: "IGDB",
  schedule: { every: 12 * 60 * 60 * 1000 },
  async run(ctx, input, handle) {
    const r = await ingest(ctx, {
      source: ctx.sources.IGDB!,
      discover: { mode: "releases" },
      maxSeries: input.limit ?? 100,
      charactersPerSeries: 25,
      openWindows: true,
      syncRunId: handle.runId,
    });
    return {
      counters: r.counters,
      ...(r.fatal ? { fatal: r.fatal } : {}),
      meta: { series: r.seriesSeen, windowsOpened: r.windowsOpened },
    };
  },
};
