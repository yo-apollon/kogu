import { and, asc, eq, gt } from "drizzle-orm";
import { seriesExternalIds } from "../../infra/db/schema/index.js";
import type { DiscoverOptions, SourceCursor } from "../types.js";
import { newCounters, resolveSeriesRef, upsertCharacter, upsertSeries } from "../upsert.js";
import { openReleaseWindow, shouldOpenWindow } from "../releaseWindows.js";
import type { JobDef } from "./context.js";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Enriquecimento diario via Jikan (MAL): percorre as series que ja tem id JIKAN (vindo de crossIds
 * do AniList) em rotacao por `lastSeriesId` e anexa id externo, favoritos (snapshot) e imagem
 * alternativa aos personagens JA EXISTENTES. Nunca cria serie nem personagem.
 */
export const jikanEnrich: JobDef = {
  name: "jikan.enrich",
  queue: "jikan",
  source: "JIKAN",
  sourceId: "JIKAN",
  schedule: { pattern: "0 5 * * *" },
  async run(ctx, input, handle) {
    const batch = input.limit ?? 30;
    const last = Number(handle.cursor.lastSeriesId ?? 0) || 0;
    const jikan = ctx.sources.JIKAN!;
    const counters = newCounters();
    const rows = await ctx.db
      .select({ seriesId: seriesExternalIds.seriesId, externalId: seriesExternalIds.externalId })
      .from(seriesExternalIds)
      .where(and(eq(seriesExternalIds.source, "JIKAN"), gt(seriesExternalIds.seriesId, last)))
      .orderBy(asc(seriesExternalIds.seriesId))
      .limit(batch);

    let lastSeriesId = last;
    let fatal: string | undefined;
    let consecutive = 0;
    for (const row of rows) {
      try {
        const ref = await resolveSeriesRef(ctx.db, "JIKAN", row.externalId);
        if (!ref) continue;
        const chars = await jikan.fetchCharacters(row.externalId, { limit: 25 });
        for (const c of chars) {
          counters.seen++;
          const r = await upsertCharacter(
            { db: ctx.db, now: ctx.now(), syncRunId: handle.runId, allowAdult: ctx.allowAdult, favoritesFloor: ctx.favoritesFloor },
            c,
            ref,
            { createIfMissing: false }
          );
          if (r.outcome === "updated") counters.updated++;
          else if (r.outcome === "not_found" || r.outcome === "skipped") counters.skipped++;
          if (r.quarantined) counters.quarantined++;
        }
        consecutive = 0;
      } catch (err) {
        counters.errors++;
        ctx.log.warn({ series: row.externalId, err: msg(err) }, "jikan.enrich: serie falhou");
        if (++consecutive >= 5) {
          fatal = `5 falhas seguidas; ultima: ${msg(err)}`;
          break;
        }
      }
      lastSeriesId = row.seriesId;
    }
    const wrapped = !fatal && rows.length < batch;
    return {
      counters,
      cursor: (wrapped ? {} : { lastSeriesId }) as SourceCursor,
      ...(fatal ? { fatal } : {}),
      meta: { series: rows.length, wrapped },
    };
  },
};

/** `/seasons/now` a cada 12h: confere datas/status de series existentes e abre janelas. */
export const jikanSeasons: JobDef = {
  name: "jikan.seasons",
  queue: "jikan",
  source: "JIKAN",
  sourceId: "JIKAN",
  schedule: { every: 12 * 60 * 60 * 1000 },
  async run(ctx, input, handle) {
    const jikan = ctx.sources.JIKAN!;
    const counters = newCounters();
    let windows = 0;
    let fatal: string | undefined;
    try {
      for await (const raw of jikan.discover({ limit: input.limit ?? 100 } as DiscoverOptions)) {
        counters.seen++;
        try {
          const s = await upsertSeries(
            { db: ctx.db, now: ctx.now(), syncRunId: handle.runId },
            raw,
            { createIfMissing: false }
          );
          if (!s) {
            counters.skipped++;
            continue;
          }
          if (s.updated) counters.updated++;
          if (
            shouldOpenWindow({ startDate: raw.startDate }, ctx.now()) &&
            (await openReleaseWindow(ctx.db, { seriesId: s.seriesId, source: "JIKAN", startDate: raw.startDate! }))
          ) {
            windows++;
          }
        } catch (err) {
          counters.errors++;
          ctx.log.warn({ series: raw.externalId, err: msg(err) }, "jikan.seasons: serie falhou");
        }
      }
    } catch (err) {
      fatal = msg(err);
    }
    return { counters, ...(fatal ? { fatal } : {}), meta: { windowsOpened: windows } };
  },
};
