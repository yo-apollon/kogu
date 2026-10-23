import type { JobDef } from "./context.js";
import { ingest } from "./ingest.js";

/** Top 200 jogos por avaliacoes e seus personagens (semanal). */
export const igdbPopular: JobDef = {
  name: "igdb.popular",
  queue: "igdb",
  source: "IGDB",
  sourceId: "IGDB",
  schedule: { pattern: "0 4 * * 0" },
  async run(ctx, input, handle) {
    const r = await ingest(ctx, {
      source: ctx.sources.IGDB!,
      discover: { mode: "popular" },
      maxSeries: input.limit ?? 200,
      charactersPerSeries: 25,
      syncRunId: handle.runId,
    });
    return {
      counters: r.counters,
      ...(r.fatal ? { fatal: r.fatal } : {}),
      meta: { series: r.seriesSeen },
    };
  },
};
