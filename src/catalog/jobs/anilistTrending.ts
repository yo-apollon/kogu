import { ingest } from "./ingest.js";
import type { JobDef } from "./context.js";

/** Series em exibicao/futuras/recem-estreadas e os top 25 personagens de cada; abre janelas de lancamento. */
export const anilistTrending: JobDef = {
  name: "anilist.trending",
  queue: "anilist",
  source: "ANILIST",
  sourceId: "ANILIST",
  schedule: { every: 6 * 60 * 60 * 1000 },
  async run(ctx, input, handle) {
    const r = await ingest(ctx, {
      source: ctx.sources.ANILIST!,
      discover: { mode: "trending" },
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
