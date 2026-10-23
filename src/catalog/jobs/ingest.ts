import { openReleaseWindow, shouldOpenWindow } from "../releaseWindows.js";
import type { CatalogSource, DiscoverOptions, RawSeries, SourceCursor } from "../types.js";
import { newCounters, upsertCharacter, upsertSeries, type Counters } from "../upsert.js";
import type { JobContext } from "./context.js";

export interface IngestOptions {
  source: CatalogSource;
  /** Campos extras de DiscoverOptions que cada adapter entende (mode, perPage, onCursor...). */
  discover?: Record<string, unknown>;
  cursor?: SourceCursor;
  maxSeries: number;
  charactersPerSeries: number;
  /** Teto de personagens por serie (sobrescreve charactersPerSeries). */
  charactersFor?: (s: RawSeries) => number;
  openWindows?: boolean;
  syncRunId: number;
}

export interface IngestResult {
  counters: Counters;
  seriesSeen: number;
  windowsOpened: number;
  entitiesCreated: number;
  fatal?: string;
}

const MAX_CONSECUTIVE_ERRORS = 5;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Descobre series na fonte, grava serie + personagens e abre janelas de lancamento.
 * Erro numa serie conta em `errors` e segue; 5 erros seguidos interrompem (fonte fora do ar),
 * mantendo o que ja foi gravado.
 */
export async function ingest(ctx: JobContext, opts: IngestOptions): Promise<IngestResult> {
  const counters = newCounters();
  const out: IngestResult = { counters, seriesSeen: 0, windowsOpened: 0, entitiesCreated: 0 };
  let consecutive = 0;
  const base = () => ({ db: ctx.db, now: ctx.now(), syncRunId: opts.syncRunId, allowAdult: ctx.allowAdult, favoritesFloor: ctx.favoritesFloor });

  const discoverOpts = {
    ...(opts.discover ?? {}),
    limit: opts.maxSeries,
    ...(opts.cursor && Object.keys(opts.cursor).length > 0 ? { cursor: opts.cursor } : {}),
  } as DiscoverOptions;

  try {
    for await (const raw of opts.source.discover(discoverOpts)) {
      out.seriesSeen++;
      counters.seen++;
      try {
        const s = await upsertSeries(base(), raw);
        if (!s) {
          counters.skipped++;
          continue;
        }
        if (s.created) counters.created++;
        else if (s.updated) counters.updated++;

        if (opts.openWindows && shouldOpenWindow({ startDate: raw.startDate }, ctx.now())) {
          if (await openReleaseWindow(ctx.db, { seriesId: s.seriesId, source: raw.source, startDate: raw.startDate! })) {
            out.windowsOpened++;
          }
        }

        const limit = opts.charactersFor?.(raw) ?? opts.charactersPerSeries;
        const chars = limit > 0 ? await opts.source.fetchCharacters(raw.externalId, { limit }) : [];
        for (const c of chars.slice(0, limit)) {
          counters.seen++;
          try {
            const r = await upsertCharacter(base(), c, s);
            if (r.outcome === "created") {
              counters.created++;
              out.entitiesCreated++;
            } else if (r.outcome === "updated") counters.updated++;
            else if (r.outcome === "skipped") counters.skipped++;
            if (r.quarantined) counters.quarantined++;
          } catch (err) {
            counters.errors++;
            ctx.log.warn({ source: raw.source, externalId: c.externalId, err: msg(err) }, "personagem falhou");
          }
        }
        consecutive = 0;
      } catch (err) {
        counters.errors++;
        consecutive++;
        ctx.log.warn({ source: raw.source, externalId: raw.externalId, err: msg(err) }, "serie falhou");
        if (consecutive >= MAX_CONSECUTIVE_ERRORS) {
          out.fatal = `${MAX_CONSECUTIVE_ERRORS} falhas seguidas; ultima: ${msg(err)}`;
          break;
        }
      }
    }
  } catch (err) {
    out.fatal = msg(err);
  }
  if (out.entitiesCreated > 0) await ctx.requestRerank?.().catch(() => undefined);
  return out;
}
