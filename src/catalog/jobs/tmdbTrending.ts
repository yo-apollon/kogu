import type { JobDef } from "./context.js";
import { ingest } from "./ingest.js";

/** Elenco de live-action considerado por obra (todos vao para revisao REAL_PERSON). */
export const TMDB_LIVE_ACTION_CAST = 5;

/**
 * Trending do TMDB. Animacao entra automatico (ate 25 personagens); live-action traz so o
 * elenco principal e o adapter marca `isRealPerson`, entao cai em PENDING_REVIEW/REAL_PERSON.
 */
export const tmdbTrending: JobDef = {
  name: "tmdb.trending",
  queue: "tmdb",
  source: "TMDB",
  sourceId: "TMDB",
  schedule: { pattern: "0 3 * * *" },
  async run(ctx, input, handle) {
    const r = await ingest(ctx, {
      source: ctx.sources.TMDB!,
      discover: { mode: "trending" },
      maxSeries: input.limit ?? 60,
      charactersPerSeries: 25,
      charactersFor: (s) => (s.isAnimation ? 25 : TMDB_LIVE_ACTION_CAST),
      syncRunId: handle.runId,
    });
    return {
      counters: r.counters,
      ...(r.fatal ? { fatal: r.fatal } : {}),
      meta: { series: r.seriesSeen },
    };
  },
};
