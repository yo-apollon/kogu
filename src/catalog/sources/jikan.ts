import { type RateLimiter, createRateLimiter } from "../../lib/http/rateLimiter.js";
import { type RetryOptions, withRetry } from "../../lib/http/retry.js";
import {
  type LookupFn,
  SafeFetchError,
  type SafeFetchJsonResult,
  safeFetchJson,
} from "../../lib/http/safeFetch.js";
import { sleep as defaultSleep } from "../../lib/time.js";
import type {
  CatalogSource,
  DiscoverOptions,
  FetchLike,
  RawCharacter,
  RawSeries,
  SeriesStatus,
  SourceCursor,
} from "../types.js";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const JIKAN_BASE_URL = "https://api.jikan.moe/v4";
export const JIKAN_HOST = "api.jikan.moe";
/** Limite publico do Jikan: 60 req/min e 3 req/s. Ficamos abaixo dos dois. */
export const JIKAN_RATE_PER_MIN = 50;
/** Intervalo minimo entre requisicoes de rede (no maximo 1 req/s). */
export const JIKAN_MIN_INTERVAL_MS = 1000;
/** O Jikan nao e oficial e cacheia por conta propria: respeitamos com TTL de 6 h. */
export const JIKAN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Jikan e uma API nao oficial e gratuita do MyAnimeList: identificamos o bot, cacheamos e
 * mantemos o ritmo baixo.
 */
const JIKAN_USER_AGENT = "KoguBot/2.0 (Discord gacha bot; Jikan v4 catalog sync; cached)";
const MAX_PER_PAGE = 25;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_CHARACTER_LIMIT = 25;
const MAX_CHARACTER_LIMIT = 250;
const CACHE_MAX_ENTRIES = 200;

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

/** Cache chave/valor com TTL. `get` devolve `undefined` em miss ou expiracao. */
export interface JikanCache {
  get(key: string): unknown;
  set(key: string, value: unknown, ttlMs: number): void;
}

/** Cache em memoria por URL com TTL e teto de entradas (descarta a mais antiga). */
export class MemoryTtlCache implements JikanCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(opts: { now?: () => number; maxEntries?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.maxEntries = opts.maxEntries ?? CACHE_MAX_ENTRIES;
  }

  get(key: string): unknown {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/* ------------------------------------------------------------------ */
/* Tipos publicos                                                      */
/* ------------------------------------------------------------------ */

export interface JikanDiscoverOptions extends DiscoverOptions {
  /** Itens por pagina (1-25, padrao 25). Ao retomar por cursor vale o `perPage` do cursor. */
  perPage?: number;
  /** Profundidade maxima de paginas numa passada (padrao 20). */
  maxPages?: number;
  /** Chamado apos cada pagina com o cursor da proxima posicao. `done: true` ao fim da passada. */
  onCursor?: (cursor: SourceCursor) => void;
}

export interface JikanSourceOptions {
  fetchImpl?: FetchLike;
  /** Limitador (p.ex. token bucket em Redis). Padrao: bucket local de 50 req/min, sem burst. */
  rateLimiter?: RateLimiter;
  /** Relogio em ms epoch (cache e intervalo minimo). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Apenas para testes: substitui a resolucao de DNS do safeFetch. */
  lookupImpl?: LookupFn;
  /** Cache injetavel (padrao: {@link MemoryTtlCache}). */
  cache?: JikanCache;
  /** TTL do cache em ms (padrao 6 h). */
  cacheTtlMs?: number;
  /** Sobrescreve a politica de retry (padrao: 4 retentativas, backoff exponencial com jitter). */
  retry?: Partial<RetryOptions>;
  userAgent?: string;
}

/* ------------------------------------------------------------------ */
/* Mapeamentos puros                                                   */
/* ------------------------------------------------------------------ */

/** "Currently Airing" -> RELEASING, "Not yet aired" -> UPCOMING; "Finished Airing"/desconhecido -> FINISHED. */
export function mapJikanStatus(status: string | null | undefined): SeriesStatus {
  switch (status?.trim().toLowerCase()) {
    case "currently airing":
      return "RELEASING";
    case "not yet aired":
      return "UPCOMING";
    default:
      return "FINISHED";
  }
}

/** Classificacao MAL "Rx - Hentai" e "R+ - Mild Nudity" contam como adulto; "R - 17+" nao. */
export function isJikanAdultRating(rating: string | null | undefined): boolean {
  return /^\s*(rx|r\+)/i.test(rating ?? "");
}

/**
 * Descarta URL vazia/invalida/nao-https e os placeholders do MAL (`questionmark_*.gif`,
 * `qm_*.gif`, `apple-touch-icon`).
 */
export function normalizeJikanImage(url: string | null | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (/questionmark|apple-touch-icon|\/qm_\d+\./i.test(parsed.pathname)) return undefined;
  return parsed.href;
}

function clean(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/* ------------------------------------------------------------------ */
/* Formato bruto da API                                                */
/* ------------------------------------------------------------------ */

export interface JikanAnime {
  mal_id?: number | null;
  url?: string | null;
  images?: { jpg?: { image_url?: string | null; large_image_url?: string | null } | null } | null;
  title?: string | null;
  title_english?: string | null;
  title_japanese?: string | null;
  type?: string | null;
  status?: string | null;
  aired?: { from?: string | null; to?: string | null } | null;
  rating?: string | null;
  members?: number | null;
  favorites?: number | null;
}

interface JikanCharacterRef {
  mal_id?: number | null;
  url?: string | null;
  images?: { jpg?: { image_url?: string | null } | null } | null;
  name?: string | null;
  name_kanji?: string | null;
  nicknames?: Array<string | null> | null;
  favorites?: number | null;
}

interface JikanAnimeCharacterEntry {
  character?: JikanCharacterRef | null;
  role?: string | null;
  favorites?: number | null;
}

interface JikanSeasonsResponse {
  pagination?: { has_next_page?: boolean | null } | null;
  data?: Array<JikanAnime | null> | null;
}

/**
 * Converte um anime do Jikan em RawSeries (sempre ANIME). `popularity` = membros (usuarios com o
 * titulo na lista, equivalente ao `popularity` do AniList), com fallback para favoritos.
 */
export function mapJikanAnime(anime: JikanAnime | null | undefined): RawSeries | null {
  if (!anime || typeof anime.mal_id !== "number" || !Number.isInteger(anime.mal_id)) return null;
  const title = clean(anime.title) ?? clean(anime.title_english) ?? clean(anime.title_japanese);
  if (!title) return null;

  const series: RawSeries = {
    source: "JIKAN",
    externalId: String(anime.mal_id),
    title,
    mediaType: "ANIME",
    status: mapJikanStatus(anime.status),
    popularity: anime.members ?? anime.favorites ?? 0,
    isAdult: isJikanAdultRating(anime.rating),
  };

  const english = clean(anime.title_english);
  if (english) series.titleEnglish = english;
  const native = clean(anime.title_japanese);
  if (native) series.titleNative = native;
  const startDate = parseDate(anime.aired?.from);
  if (startDate) series.startDate = startDate;
  const endDate = parseDate(anime.aired?.to);
  if (endDate) series.endDate = endDate;
  const cover =
    normalizeJikanImage(anime.images?.jpg?.large_image_url) ??
    normalizeJikanImage(anime.images?.jpg?.image_url);
  if (cover) series.coverUrl = cover;
  const url = clean(anime.url);
  if (url) series.url = url;
  return series;
}

/**
 * Jikan nao informa genero: sempre UNKNOWN. O job `jikan.enrich` so deve anexar external ids e
 * favoritos a entidades que ja existem (criadas por AniList/IGDB/TMDB), nunca criar entidades novas.
 * Os nomes seguem o formato do MAL ("Sobrenome, Nome").
 */
function mapCharacterRef(
  ref: JikanCharacterRef | null | undefined,
  ctx: { seriesExternalId: string; favourites: number; role?: RawCharacter["role"] }
): RawCharacter | null {
  if (!ref || typeof ref.mal_id !== "number" || !Number.isInteger(ref.mal_id)) return null;
  const name = clean(ref.name) ?? clean(ref.name_kanji);
  if (!name) return null;

  const character: RawCharacter = {
    source: "JIKAN",
    externalId: String(ref.mal_id),
    name,
    gender: "UNKNOWN",
    favourites: ctx.favourites,
    seriesExternalId: ctx.seriesExternalId,
  };

  const native = clean(ref.name_kanji);
  if (native) character.nameNative = native;
  const aliases = [
    ...new Set(
      (ref.nicknames ?? [])
        .map((n) => clean(n))
        .filter((n): n is string => n !== undefined && n !== name)
    ),
  ];
  if (aliases.length > 0) character.aliases = aliases;
  const image = normalizeJikanImage(ref.images?.jpg?.image_url);
  if (image) character.imageUrl = image;
  if (ctx.role) character.role = ctx.role;
  const url = clean(ref.url);
  if (url) character.url = url;
  return character;
}

function mapRole(role: string | null | undefined): RawCharacter["role"] {
  switch (role?.trim().toLowerCase()) {
    case "main":
      return "MAIN";
    case "supporting":
      return "SUPPORTING";
    default:
      return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Cursor                                                              */
/* ------------------------------------------------------------------ */

interface DiscoverPosition {
  page: number;
  skip: number;
  perPage: number;
}

function readCursor(cursor: SourceCursor | undefined): DiscoverPosition | null {
  if (!cursor || cursor.done === true) return null;
  const { page, skip, perPage } = cursor;
  if (typeof page !== "number" || typeof skip !== "number" || typeof perPage !== "number")
    return null;
  if (![page, skip, perPage].every(Number.isInteger)) return null;
  if (page < 1 || skip < 0 || perPage < 1 || perPage > MAX_PER_PAGE) return null;
  return { page, skip, perPage };
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class JikanSource implements CatalogSource {
  readonly id = "JIKAN" as const;
  readonly ratePerMin: number = JIKAN_RATE_PER_MIN;

  private readonly fetchImpl: FetchLike | undefined;
  private readonly lookupImpl: LookupFn | undefined;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: JikanCache;
  private readonly cacheTtlMs: number;
  private readonly retryOptions: Partial<RetryOptions>;
  private readonly userAgent: string;
  private lastRequestAt: number | undefined;
  /** Serializa o ritmo: chamadas concorrentes passam uma de cada vez pelo limiter e pelo intervalo minimo. */
  private paceQueue: Promise<void> = Promise.resolve();

  constructor(opts: JikanSourceOptions = {}) {
    this.fetchImpl = opts.fetchImpl;
    this.lookupImpl = opts.lookupImpl;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.userAgent = opts.userAgent ?? JIKAN_USER_AGENT;
    this.cache = opts.cache ?? new MemoryTtlCache({ now: this.now });
    this.cacheTtlMs = opts.cacheTtlMs ?? JIKAN_CACHE_TTL_MS;
    this.limiter =
      opts.rateLimiter ??
      createRateLimiter({
        bucket: "jikan",
        ratePerMin: JIKAN_RATE_PER_MIN,
        burst: 1,
        now: this.now,
        sleep: this.sleep,
      });
    // 429 e 5xx (incluindo 408) caem na politica padrao; 404 e demais 4xx nao sao retentados.
    this.retryOptions = {
      retries: 4,
      baseMs: 2000,
      maxMs: 30_000,
      jitter: true,
      sleep: this.sleep,
      now: this.now,
      ...opts.retry,
    };
  }

  /**
   * Anime em exibicao na temporada (`/seasons/now`), paginado. Deduplica `mal_id` repetido entre
   * paginas (o Jikan repete itens). Cursor: `{ page, skip, perPage, done }` com a mesma semantica do
   * adapter do AniList. Como as respostas sao cacheadas por URL, repetir a passada dentro do TTL
   * nao gera trafego.
   */
  async *discover(opts: JikanDiscoverOptions = {}): AsyncIterable<RawSeries> {
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const maxPages = clampInt(opts.maxPages ?? DEFAULT_MAX_PAGES, 1, 1000);
    const resume = readCursor(opts.cursor);
    const perPage = resume?.perPage ?? clampInt(opts.perPage ?? MAX_PER_PAGE, 1, MAX_PER_PAGE);
    let page = resume?.page ?? 1;
    let skip = resume?.skip ?? 0;

    const emit = (position: { page: number; skip: number }, done = false) =>
      opts.onCursor?.({ ...position, perPage, done });

    const seen = new Set<string>();
    let yielded = 0;

    while (page <= maxPages) {
      if (yielded >= limit) {
        emit({ page, skip: 0 });
        return;
      }
      opts.signal?.throwIfAborted();

      const body = await this.getJson<JikanSeasonsResponse>("/seasons/now", {
        page,
        limit: perPage,
      });
      const items = Array.isArray(body?.data) ? body.data : [];
      for (let i = skip; i < items.length; i++) {
        if (yielded >= limit) {
          emit({ page, skip: i });
          return;
        }
        const series = mapJikanAnime(items[i]);
        if (!series || seen.has(series.externalId)) continue;
        seen.add(series.externalId);
        yielded++;
        yield series;
      }
      skip = 0;

      if (body?.pagination?.has_next_page !== true) break;
      page++;
      emit({ page, skip: 0 });
    }
    emit({ page: 1, skip: 0 }, true);
  }

  /**
   * Personagens de um anime (`/anime/{mal_id}/characters`) ordenados por `favorites`.
   * `gender` e sempre UNKNOWN (o Jikan nao fornece) e `isAdult` fica indefinido. Anime
   * inexistente (404) devolve lista vazia.
   */
  async fetchCharacters(
    seriesExternalId: string,
    opts: { limit?: number } = {}
  ): Promise<RawCharacter[]> {
    const malId = Number(seriesExternalId);
    if (!Number.isInteger(malId) || malId <= 0) {
      throw new RangeError(`invalid MAL anime id: ${seriesExternalId}`);
    }
    const limit = clampInt(opts.limit ?? DEFAULT_CHARACTER_LIMIT, 1, MAX_CHARACTER_LIMIT);

    let body: { data?: Array<JikanAnimeCharacterEntry | null> | null };
    try {
      body = await this.getJson(`/anime/${malId}/characters`);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }

    const byId = new Map<string, RawCharacter>();
    for (const entry of Array.isArray(body?.data) ? body.data : []) {
      const character = mapCharacterRef(entry?.character, {
        seriesExternalId: String(malId),
        favourites: entry?.favorites ?? 0,
        role: mapRole(entry?.role),
      });
      if (!character) continue;
      const previous = byId.get(character.externalId);
      if (!previous || previous.favourites < character.favourites)
        byId.set(character.externalId, character);
    }
    return [...byId.values()].sort((a, b) => b.favourites - a.favourites).slice(0, limit);
  }

  /**
   * Revalida personagens por `mal_id` (`/characters/{id}`: favoritos, imagem, nome). Uma
   * requisicao por id, entao respeita o ritmo de ~1 req/s. Ids removidos do MAL (404) sao
   * ignorados. `seriesExternalId` vem vazio (o endpoint nao informa a obra): use `externalId`.
   */
  async refresh(externalIds: string[]): Promise<RawCharacter[]> {
    const ids = [...new Set(externalIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const out: RawCharacter[] = [];
    for (const id of ids) {
      let body: { data?: (JikanCharacterRef & { favorites?: number | null }) | null };
      try {
        body = await this.getJson(`/characters/${id}`);
      } catch (err) {
        if (isNotFound(err)) continue;
        throw err;
      }
      const character = mapCharacterRef(body?.data, {
        seriesExternalId: "",
        favourites: body?.data?.favorites ?? 0,
      });
      if (character) out.push(character);
    }
    return out;
  }

  /* ---------------------------------------------------------------- */

  /** GET JSON com cache por URL (TTL), ritmo controlado e retry em 429/5xx. */
  private async getJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${JIKAN_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const key = url.href;

    const cached = this.cache.get(key);
    if (cached !== undefined) return cached as T;

    const data = await withRetry(async () => {
      await this.pace();
      const result: SafeFetchJsonResult<T> = await safeFetchJson<T>(key, {
        allowHosts: [JIKAN_HOST],
        userAgent: this.userAgent,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
        ...(this.lookupImpl ? { lookupImpl: this.lookupImpl } : {}),
      });
      return result.data;
    }, this.retryOptions);

    this.cache.set(key, data, this.cacheTtlMs);
    return data;
  }

  private pace(): Promise<void> {
    const run = this.paceQueue.then(async () => {
      await this.limiter.acquire();
      if (this.lastRequestAt !== undefined) {
        const wait = this.lastRequestAt + JIKAN_MIN_INTERVAL_MS - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastRequestAt = this.now();
    });
    this.paceQueue = run.catch(() => {});
    return run;
  }
}

function isNotFound(err: unknown): boolean {
  return err instanceof SafeFetchError && err.status === 404;
}
