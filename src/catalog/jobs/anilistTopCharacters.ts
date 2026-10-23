import type { SourceCursor } from "../types.js";
import type { JobDef } from "./context.js";
import { ingest } from "./ingest.js";

/** 20 paginas x 50 por execucao. */
export const TOP_PAGES_PER_RUN = 20;
export const TOP_PER_PAGE = 50;
/** Ao chegar neste ranking o cursor volta ao inicio. */
export const TOP_RANK_LIMIT = 20_000;

/**
 * Rotacao diaria pelas series mais populares. O cursor em catalog_sources guarda o do adapter
 * (page/unit/skip...) mais `rank` (series ja percorridas); passou de 20000 ou `done`: recomeca.
 */
export const anilistTopCharacters: JobDef = {
  name: "anilist.topCharacters",
  queue: "anilist",
  source: "ANILIST",
  sourceId: "ANILIST",
  schedule: { pattern: "30 2 * * *" },
  async run(ctx, input, handle) {
    const startRank = Number(handle.cursor.rank ?? 0) || 0;
    let adapterCursor: SourceCursor | undefined;
    const r = await ingest(ctx, {
      source: ctx.sources.ANILIST!,
      discover: {
        mode: "popular",
        perPage: TOP_PER_PAGE,
        maxPages: TOP_RANK_LIMIT / TOP_PER_PAGE,
        onCursor: (c: SourceCursor) => {
          adapterCursor = c;
        },
      },
      cursor: handle.cursor,
      maxSeries: input.limit ?? TOP_PAGES_PER_RUN * TOP_PER_PAGE,
      charactersPerSeries: 25,
      syncRunId: handle.runId,
    });
    const rank = startRank + r.seriesSeen;
    const restart = rank >= TOP_RANK_LIMIT || adapterCursor?.done === true;
    const cursor: SourceCursor = restart ? {} : { ...(adapterCursor ?? handle.cursor), rank };
    return {
      counters: r.counters,
      cursor,
      ...(r.fatal ? { fatal: r.fatal } : {}),
      meta: { series: r.seriesSeen, rank, restarted: restart },
    };
  },
};
