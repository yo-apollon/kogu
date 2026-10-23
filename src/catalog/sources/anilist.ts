import { type RateLimiter, createRateLimiter } from "../../lib/http/rateLimiter.js";
import {
  type RetryOptions,
  defaultShouldRetry,
  isRetryableStatus,
  parseRetryAfter,
  withRetry,
} from "../../lib/http/retry.js";
import {
  type LookupFn,
  SafeFetchError,
  type SafeFetchJsonResult,
  safeFetchJson,
} from "../../lib/http/safeFetch.js";
import { stripHtml } from "../../lib/text/normalize.js";
import { sleep as defaultSleep } from "../../lib/time.js";
import type {
  CatalogSource,
  DiscoverOptions,
  FetchLike,
  MediaType,
  RawCharacter,
  RawGender,
  RawSeries,
  SeriesStatus,
  SourceCursor,
} from "../types.js";

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const ANILIST_URL = "https://graphql.anilist.co";
export const ANILIST_HOST = "graphql.anilist.co";
/** Ritmo conservador: o limite publico do AniList e 30 req/min (90 quando estavel). */
export const ANILIST_RATE_PER_MIN = 25;

const ANILIST_USER_AGENT = "ArqonBot/2.0 (Discord gacha bot; AniList catalog sync)";
const MAX_PER_PAGE = 50;
/** `Media.characters` e uma conexao aninhada: mantemos paginas pequenas. */
const CHARACTERS_PAGE_SIZE = 25;
const DEFAULT_CHARACTER_LIMIT = 25;
const MAX_CHARACTER_LIMIT = 250;
const REFRESH_BATCH_SIZE = 50;
const DESCRIPTION_MAX_CHARS = 240;
const RECENT_RELEASE_DAYS = 30;
const DEFAULT_MAX_PAGES = 10;
/** Com `X-RateLimit-Remaining` <= este valor o adapter espaca as proximas requisicoes. */
const LOW_REMAINING_THRESHOLD = 3;
const LOW_REMAINING_SPACING_MS = Math.ceil((60_000 / ANILIST_RATE_PER_MIN) * 2);
/** Pausa usada quando o servidor manda 429/remaining 0 sem dizer por quanto tempo. */
const DEFAULT_PAUSE_MS = 60_000;
/** Teto para a pausa derivada de `X-RateLimit-Reset` (protege contra relogio dessincronizado). */
const MAX_PAUSE_MS = 90_000;
const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Tipos publicos                                                      */
/* ------------------------------------------------------------------ */

export type AniListMediaType = "ANIME" | "MANGA";

/**
 * - `trending` (padrao): TRENDING_DESC entre obras em exibicao/futuras (RELEASING e
 *   NOT_YET_RELEASED) mais as ja finalizadas que estrearam nos ultimos 30 dias (filmes, OVAs).
 * - `popular`: POPULARITY_DESC sem filtro (carga inicial/bootstrap).
 * - `season`: POPULARITY_DESC das obras que estreiam no trimestre corrente (jan-mar, abr-jun...).
 */
export type AniListMode = "trending" | "popular" | "season";

export interface AniListDiscoverOptions extends DiscoverOptions {
  mode?: AniListMode;
  /** Tipos de midia consultados (padrao: ANIME e MANGA). */
  types?: readonly AniListMediaType[];
  /** Itens por pagina (1-50, padrao 50). Ao retomar por cursor vale o `perPage` do cursor. */
  perPage?: number;
  /** Profundidade maxima de paginas por consulta numa passada (padrao 10). */
  maxPages?: number;
  /** Chamado apos cada pagina com o cursor da proxima posicao. `done: true` ao fim da passada. */
  onCursor?: (cursor: SourceCursor) => void;
}

export interface AniListSourceOptions {
  fetchImpl?: FetchLike;
  /** Limitador (p.ex. token bucket em Redis). Padrao: bucket local de 25 req/min. */
  rateLimiter?: RateLimiter;
  /** Relogio em ms epoch. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Apenas para testes: substitui a resolucao de DNS do safeFetch. */
  lookupImpl?: LookupFn;
  /** Sobrescreve a politica de retry (padrao: 4 retentativas, backoff exponencial com jitter). */
  retry?: Partial<RetryOptions>;
  userAgent?: string;
}

/** Erro devolvido no corpo GraphQL (`errors`). Nao e retentado, salvo status 5xx/429 declarado. */
export class AniListError extends Error {
  readonly graphqlStatus?: number;
  readonly messages: string[];

  constructor(messages: string[], graphqlStatus?: number) {
    super(`AniList GraphQL error: ${messages.length > 0 ? messages.join("; ") : "unknown error"}`);
    this.name = "AniListError";
    this.messages = messages;
    if (graphqlStatus !== undefined) this.graphqlStatus = graphqlStatus;
  }
}

/* ------------------------------------------------------------------ */
/* Mapeamentos puros                                                   */
/* ------------------------------------------------------------------ */

const FORMAT_TO_MEDIA_TYPE: Record<string, MediaType> = {
  TV: "ANIME",
  TV_SHORT: "ANIME",
  MOVIE: "ANIME",
  SPECIAL: "ANIME",
  OVA: "ANIME",
  ONA: "ANIME",
  MUSIC: "ANIME",
  MANGA: "MANGA",
  ONE_SHOT: "MANGA",
  NOVEL: "LIGHT_NOVEL",
};

/** `format` do AniList -> MediaType. Sem format conhecido, decide pelo `type` (ANIME/MANGA). */
export function mapAniListFormat(
  format: string | null | undefined,
  type: string | null | undefined = "ANIME"
): MediaType {
  const mapped = format ? FORMAT_TO_MEDIA_TYPE[format.toUpperCase()] : undefined;
  if (mapped) return mapped;
  return type?.toUpperCase() === "MANGA" ? "MANGA" : "ANIME";
}

/**
 * HIATUS segue como RELEASING (a obra continua em andamento); CANCELLED e desconhecido
 * viram FINISHED (nao abrem janela de lancamento).
 */
export function mapAniListStatus(status: string | null | undefined): SeriesStatus {
  switch (status?.toUpperCase()) {
    case "RELEASING":
    case "HIATUS":
      return "RELEASING";
    case "NOT_YET_RELEASED":
      return "UPCOMING";
    default:
      return "FINISHED";
  }
}

/** Genero declarado pelo AniList (texto livre). Ausente ou fora do padrao vira UNKNOWN, nunca sorteado. */
export function mapAniListGender(gender: string | null | undefined): RawGender {
  const key = gender
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (key === "female") return "FEMALE";
  if (key === "male") return "MALE";
  if (key === "nonbinary" || key === "enby") return "NONBINARY";
  return "UNKNOWN";
}

/** Descarta URLs vazias, invalidas, nao-https e a imagem placeholder `/default.jpg` do AniList. */
export function normalizeAniListImage(url: string | null | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (/\/default\.(jpe?g|png|webp)$/i.test(parsed.pathname)) return undefined;
  return parsed.href;
}

interface FuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

function fuzzyToDate(d: FuzzyDate | null | undefined): Date | undefined {
  if (!d || typeof d.year !== "number") return undefined;
  const date = new Date(Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toFuzzyDateInt(d: Date): number {
  return d.getUTCFullYear() * 10_000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function clean(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

function cleanDescription(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = stripHtml(raw)
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? undefined : truncate(text, DESCRIPTION_MAX_CHARS);
}

function mapRole(role: string | null | undefined): RawCharacter["role"] {
  const key = role?.toUpperCase();
  return key === "MAIN" || key === "SUPPORTING" ? key : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/* ------------------------------------------------------------------ */
/* Formato bruto da API                                                */
/* ------------------------------------------------------------------ */

interface PageInfo {
  hasNextPage?: boolean | null;
}

export interface AniListMedia {
  id?: number | null;
  idMal?: number | null;
  type?: string | null;
  format?: string | null;
  status?: string | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  startDate?: FuzzyDate | null;
  endDate?: FuzzyDate | null;
  popularity?: number | null;
  favourites?: number | null;
  coverImage?: { large?: string | null } | null;
  isAdult?: boolean | null;
  siteUrl?: string | null;
}

export interface AniListCharacterNode {
  id?: number | null;
  name?: {
    full?: string | null;
    native?: string | null;
    alternative?: Array<string | null> | null;
  } | null;
  gender?: string | null;
  description?: string | null;
  image?: { large?: string | null } | null;
  favourites?: number | null;
  siteUrl?: string | null;
  media?: {
    edges?: Array<{
      characterRole?: string | null;
      node?: { id?: number | null; isAdult?: boolean | null } | null;
    } | null> | null;
  } | null;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string; status?: number }> | null;
}

/** Converte uma midia do AniList em RawSeries. Retorna null se faltar id ou titulo. */
export function mapAniListMedia(
  media: AniListMedia | null | undefined,
  fallbackType: AniListMediaType = "ANIME"
): RawSeries | null {
  if (!media || typeof media.id !== "number" || !Number.isInteger(media.id)) return null;
  const title =
    clean(media.title?.romaji) ?? clean(media.title?.english) ?? clean(media.title?.native);
  if (!title) return null;

  const mediaType = mapAniListFormat(media.format, media.type ?? fallbackType);
  const series: RawSeries = {
    source: "ANILIST",
    externalId: String(media.id),
    title,
    mediaType,
    status: mapAniListStatus(media.status),
    popularity: media.popularity ?? media.favourites ?? 0,
    isAdult: media.isAdult === true,
  };

  const native = clean(media.title?.native);
  if (native) series.titleNative = native;
  const english = clean(media.title?.english);
  if (english) series.titleEnglish = english;
  const startDate = fuzzyToDate(media.startDate);
  if (startDate) series.startDate = startDate;
  const endDate = fuzzyToDate(media.endDate);
  if (endDate) series.endDate = endDate;
  const cover = normalizeAniListImage(media.coverImage?.large);
  if (cover) series.coverUrl = cover;
  const url = clean(media.siteUrl);
  if (url) series.url = url;
  // idMal de MANGA e do namespace de manga do MAL (colide com ids de anime): so anime vira crossId do Jikan.
  if (typeof media.idMal === "number" && mediaType === "ANIME") {
    series.crossIds = { JIKAN: String(media.idMal) };
  }
  return series;
}

interface CharacterContext {
  seriesExternalId: string;
  role?: RawCharacter["role"];
  isAdult: boolean;
}

function mapCharacterNode(
  node: AniListCharacterNode | null | undefined,
  ctx: CharacterContext
): RawCharacter | null {
  if (!node || typeof node.id !== "number" || !Number.isInteger(node.id)) return null;
  const name = clean(node.name?.full) ?? clean(node.name?.native);
  if (!name) return null;

  const character: RawCharacter = {
    source: "ANILIST",
    externalId: String(node.id),
    name,
    gender: mapAniListGender(node.gender),
    favourites: node.favourites ?? 0,
    seriesExternalId: ctx.seriesExternalId,
    isAdult: ctx.isAdult,
  };

  const native = clean(node.name?.native);
  if (native) character.nameNative = native;
  const aliases = [
    ...new Set(
      (node.name?.alternative ?? [])
        .map((a) => clean(a))
        .filter((a): a is string => a !== undefined && a !== name)
    ),
  ];
  if (aliases.length > 0) character.aliases = aliases;
  const description = cleanDescription(node.description);
  if (description) character.description = description;
  const image = normalizeAniListImage(node.image?.large);
  if (image) character.imageUrl = image;
  if (ctx.role) character.role = ctx.role;
  const url = clean(node.siteUrl);
  if (url) character.url = url;
  return character;
}

/** Personagens que trazem `media`: a serie e a primeira midia (mais popular). Sem midia: ignorado. */
function mapCharactersWithMedia(
  nodes: Array<AniListCharacterNode | null> | null | undefined
): RawCharacter[] {
  const out: RawCharacter[] = [];
  for (const node of nodes ?? []) {
    const edge = node?.media?.edges?.find(
      (e) => e?.node && typeof e.node.id === "number" && Number.isInteger(e.node.id)
    );
    if (!node || !edge?.node) continue;
    const character = mapCharacterNode(node, {
      seriesExternalId: String(edge.node.id),
      role: mapRole(edge.characterRole),
      isAdult: edge.node.isAdult === true,
    });
    if (character) out.push(character);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Consultas GraphQL                                                   */
/* ------------------------------------------------------------------ */

const MEDIA_FIELDS = `
  id idMal type format status
  title { romaji english native }
  startDate { year month day }
  endDate { year month day }
  popularity favourites
  coverImage { large }
  isAdult siteUrl`;

const CHARACTER_FIELDS = `
  id
  name { full native alternative }
  gender description
  image { large }
  favourites siteUrl`;

const CHARACTER_WITH_MEDIA_FIELDS = `${CHARACTER_FIELDS}
  media(sort: POPULARITY_DESC, perPage: 1) {
    edges { characterRole node { id isAdult } }
  }`;

const DISCOVER_QUERY = `
query ($page: Int, $perPage: Int, $type: MediaType, $sort: [MediaSort], $statusIn: [MediaStatus], $startAfter: FuzzyDateInt, $startBefore: FuzzyDateInt) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage hasNextPage lastPage perPage total }
    media(type: $type, sort: $sort, status_in: $statusIn, startDate_greater: $startAfter, startDate_lesser: $startBefore) {
      ${MEDIA_FIELDS}
    }
  }
}`;

const SERIES_CHARACTERS_QUERY = `
query ($id: Int, $page: Int, $perPage: Int) {
  Media(id: $id) {
    id
    isAdult
    characters(sort: FAVOURITES_DESC, page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      edges {
        role
        node {${CHARACTER_FIELDS}
        }
      }
    }
  }
}`;

const REFRESH_QUERY = `
query ($ids: [Int], $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    characters(id_in: $ids) {
      ${CHARACTER_WITH_MEDIA_FIELDS}
    }
  }
}`;

const TOP_CHARACTERS_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage hasNextPage lastPage }
    characters(sort: FAVOURITES_DESC) {
      ${CHARACTER_WITH_MEDIA_FIELDS}
    }
  }
}`;

/* ------------------------------------------------------------------ */
/* Planejamento do discover                                            */
/* ------------------------------------------------------------------ */

interface DiscoverUnit {
  type: AniListMediaType;
  sort: "TRENDING_DESC" | "POPULARITY_DESC";
  statusIn?: string[];
  startAfter?: number;
  startBefore?: number;
}

function seasonRange(now: Date): { after: number; before: number } {
  const year = now.getUTCFullYear();
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const start = Date.UTC(year, quarterStartMonth, 1);
  const end = Date.UTC(year, quarterStartMonth + 3, 1);
  // Os filtros do AniList sao exclusivos: `after` = dia anterior ao inicio, `before` = 1o dia do proximo.
  return { after: toFuzzyDateInt(new Date(start - DAY_MS)), before: toFuzzyDateInt(new Date(end)) };
}

function buildUnits(
  mode: AniListMode,
  types: readonly AniListMediaType[],
  nowMs: number
): DiscoverUnit[] {
  if (mode === "popular") {
    return types.map((type) => ({ type, sort: "POPULARITY_DESC" }));
  }
  if (mode === "season") {
    const { after, before } = seasonRange(new Date(nowMs));
    return types.map((type) => ({
      type,
      sort: "POPULARITY_DESC",
      startAfter: after,
      startBefore: before,
    }));
  }
  const since = toFuzzyDateInt(new Date(nowMs - RECENT_RELEASE_DAYS * DAY_MS));
  return [
    ...types.map((type): DiscoverUnit => ({
      type,
      sort: "TRENDING_DESC",
      statusIn: ["RELEASING", "NOT_YET_RELEASED"],
    })),
    ...types.map((type): DiscoverUnit => ({
      type,
      sort: "TRENDING_DESC",
      statusIn: ["FINISHED"],
      startAfter: since,
    })),
  ];
}

interface DiscoverPosition {
  page: number;
  unit: number;
  skip: number;
  perPage: number;
}

function readCursor(
  cursor: SourceCursor | undefined,
  mode: string,
  signature: string,
  unitCount: number
): DiscoverPosition | null {
  if (!cursor || cursor.done === true || cursor.mode !== mode || cursor.units !== signature) {
    return null;
  }
  const { page, unit, skip, perPage } = cursor;
  if (
    typeof page !== "number" ||
    typeof unit !== "number" ||
    typeof skip !== "number" ||
    typeof perPage !== "number" ||
    ![page, unit, skip, perPage].every(Number.isInteger)
  ) {
    return null;
  }
  if (
    page < 1 ||
    unit < 0 ||
    unit >= unitCount ||
    skip < 0 ||
    perPage < 1 ||
    perPage > MAX_PER_PAGE
  ) {
    return null;
  }
  return { page, unit, skip, perPage };
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

function intHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || !/^-?\d+$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

export class AniListSource implements CatalogSource {
  readonly id = "ANILIST" as const;
  readonly ratePerMin: number = ANILIST_RATE_PER_MIN;

  private readonly fetchImpl: FetchLike | undefined;
  private readonly lookupImpl: LookupFn | undefined;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retryOptions: Partial<RetryOptions>;
  private readonly userAgent: string;
  /** Nenhuma requisicao sai antes deste instante (ms epoch). */
  private pausedUntil = 0;

  constructor(opts: AniListSourceOptions = {}) {
    this.fetchImpl = opts.fetchImpl;
    this.lookupImpl = opts.lookupImpl;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.userAgent = opts.userAgent ?? ANILIST_USER_AGENT;
    this.limiter =
      opts.rateLimiter ??
      createRateLimiter({
        bucket: "anilist",
        ratePerMin: ANILIST_RATE_PER_MIN,
        burst: 5,
        now: this.now,
        sleep: this.sleep,
      });
    this.retryOptions = {
      retries: 4,
      baseMs: 2000,
      maxMs: 60_000,
      jitter: true,
      sleep: this.sleep,
      now: this.now,
      shouldRetry: (err) =>
        err instanceof AniListError
          ? err.graphqlStatus !== undefined && isRetryableStatus(err.graphqlStatus)
          : defaultShouldRetry(err),
      ...opts.retry,
    };
  }

  /**
   * Percorre `Page(media)` por modo (ver {@link AniListMode}). As consultas (tipo x fase) sao
   * intercaladas pagina a pagina, entao um `limit` pequeno ainda cobre ANIME e MANGA.
   *
   * Cursor (`opts.cursor`/`onCursor`): `{ mode, units, page, unit, skip, perPage, done }` aponta a
   * proxima posicao a buscar; `skip` conta itens ja entregues de uma pagina cortada por `limit`.
   * Ao fim da passada o cursor vem com `done: true` e posicao inicial (a proxima chamada recomeca).
   */
  async *discover(opts: AniListDiscoverOptions = {}): AsyncIterable<RawSeries> {
    const mode = opts.mode ?? "trending";
    const types =
      opts.types && opts.types.length > 0
        ? [...new Set(opts.types)]
        : (["ANIME", "MANGA"] as const);
    const units = buildUnits(mode, types, this.now());
    const signature = types.join(",");
    const limit = opts.limit ?? Number.POSITIVE_INFINITY;
    const maxPages = clampInt(opts.maxPages ?? DEFAULT_MAX_PAGES, 1, 1000);

    const resume = readCursor(opts.cursor, mode, signature, units.length);
    const perPage = resume?.perPage ?? clampInt(opts.perPage ?? MAX_PER_PAGE, 1, MAX_PER_PAGE);
    let page = resume?.page ?? 1;
    let unit = resume?.unit ?? 0;
    let skip = resume?.skip ?? 0;

    const emit = (position: { page: number; unit: number; skip: number }, done = false) =>
      opts.onCursor?.({ mode, units: signature, ...position, perPage, done });

    const exhausted = new Set<number>();
    let yielded = 0;

    while (page <= maxPages && exhausted.size < units.length) {
      for (; unit < units.length; unit++) {
        if (exhausted.has(unit)) continue;
        if (yielded >= limit) {
          emit({ page, unit, skip: 0 });
          return;
        }
        opts.signal?.throwIfAborted();

        const current = units[unit];
        const result = await this.fetchMediaPage(current, page, perPage);
        for (let i = skip; i < result.media.length; i++) {
          if (yielded >= limit) {
            emit({ page, unit, skip: i });
            return;
          }
          const series = mapAniListMedia(result.media[i], current.type);
          if (!series) continue;
          yielded++;
          yield series;
        }
        skip = 0;
        if (!result.hasNextPage) exhausted.add(unit);

        const nextUnit = unit + 1;
        emit(
          nextUnit < units.length
            ? { page, unit: nextUnit, skip: 0 }
            : { page: page + 1, unit: 0, skip: 0 }
        );
      }
      unit = 0;
      page++;
    }
    emit({ page: 1, unit: 0, skip: 0 }, true);
  }

  /**
   * Top personagens da serie por favoritos (`FAVOURITES_DESC`). `seriesExternalId` inexistente
   * (404) devolve lista vazia. `isAdult` do personagem herda o da serie.
   */
  async fetchCharacters(
    seriesExternalId: string,
    opts: { limit?: number } = {}
  ): Promise<RawCharacter[]> {
    const mediaId = Number(seriesExternalId);
    if (!Number.isInteger(mediaId) || mediaId <= 0) {
      throw new RangeError(`invalid AniList media id: ${seriesExternalId}`);
    }
    const limit = clampInt(opts.limit ?? DEFAULT_CHARACTER_LIMIT, 1, MAX_CHARACTER_LIMIT);
    const out: RawCharacter[] = [];

    for (let page = 1; out.length < limit; page++) {
      let data: {
        Media?: {
          isAdult?: boolean | null;
          characters?: {
            pageInfo?: PageInfo | null;
            edges?: Array<{
              role?: string | null;
              node?: AniListCharacterNode | null;
            } | null> | null;
          } | null;
        } | null;
      };
      try {
        data = await this.request(SERIES_CHARACTERS_QUERY, {
          id: mediaId,
          page,
          perPage: CHARACTERS_PAGE_SIZE,
        });
      } catch (err) {
        if (isNotFound(err)) return out;
        throw err;
      }

      const media = data.Media;
      const edges = media?.characters?.edges ?? [];
      for (const edge of edges) {
        const character = mapCharacterNode(edge?.node, {
          seriesExternalId: String(mediaId),
          role: mapRole(edge?.role),
          isAdult: media?.isAdult === true,
        });
        if (character) out.push(character);
      }
      if (edges.length === 0 || media?.characters?.pageInfo?.hasNextPage !== true) break;
    }

    out.sort((a, b) => b.favourites - a.favourites);
    return out.slice(0, limit);
  }

  /**
   * Revalida personagens por id em lotes de 50 (`Page(characters, id_in)`). Personagens sem
   * midia vinculada ou removidos do AniList nao aparecem no resultado.
   */
  async refresh(externalIds: string[]): Promise<RawCharacter[]> {
    const ids = [...new Set(externalIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const out: RawCharacter[] = [];
    for (let i = 0; i < ids.length; i += REFRESH_BATCH_SIZE) {
      const batch = ids.slice(i, i + REFRESH_BATCH_SIZE);
      const data = await this.request<{
        Page?: { characters?: Array<AniListCharacterNode | null> | null } | null;
      }>(REFRESH_QUERY, { ids: batch, page: 1, perPage: batch.length });
      out.push(...mapCharactersWithMedia(data.Page?.characters));
    }
    return out;
  }

  /**
   * Ranking global de personagens por favoritos (usado pelo job de rotacao). `seriesExternalId`
   * e a midia mais popular do personagem; quem nao tem midia e ignorado.
   */
  async topCharacters(opts: { page?: number; perPage?: number } = {}): Promise<RawCharacter[]> {
    const page = clampInt(opts.page ?? 1, 1, 100_000);
    const perPage = clampInt(opts.perPage ?? MAX_PER_PAGE, 1, MAX_PER_PAGE);
    const data = await this.request<{
      Page?: { characters?: Array<AniListCharacterNode | null> | null } | null;
    }>(TOP_CHARACTERS_QUERY, { page, perPage });
    return mapCharactersWithMedia(data.Page?.characters);
  }

  /* ---------------------------------------------------------------- */

  private async fetchMediaPage(
    unit: DiscoverUnit,
    page: number,
    perPage: number
  ): Promise<{ media: Array<AniListMedia | null>; hasNextPage: boolean }> {
    const data = await this.request<{
      Page?: { pageInfo?: PageInfo | null; media?: Array<AniListMedia | null> | null } | null;
    }>(DISCOVER_QUERY, {
      page,
      perPage,
      type: unit.type,
      sort: [unit.sort],
      statusIn: unit.statusIn,
      startAfter: unit.startAfter,
      startBefore: unit.startBefore,
    });
    return {
      media: data.Page?.media ?? [],
      hasNextPage: data.Page?.pageInfo?.hasNextPage === true,
    };
  }

  /** POST GraphQL com rate limit, pausa reativa (headers), retry em 429/5xx e erro em `errors`. */
  private request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      await this.waitForPause();
      await this.limiter.acquire();

      let result: SafeFetchJsonResult<GraphQLResponse<T>>;
      try {
        result = await safeFetchJson<GraphQLResponse<T>>(ANILIST_URL, {
          allowHosts: [ANILIST_HOST],
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, variables }),
          userAgent: this.userAgent,
          ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
          ...(this.lookupImpl ? { lookupImpl: this.lookupImpl } : {}),
        });
      } catch (err) {
        if (err instanceof SafeFetchError && err.status === 429) {
          this.pauseFor(err.retryAfterMs ?? DEFAULT_PAUSE_MS);
        }
        throw err;
      }

      this.observeRateHeaders(result.headers);
      const body = result.data;
      if (body?.errors && body.errors.length > 0) {
        const messages = body.errors.map((e) => e.message ?? "unknown error");
        throw new AniListError(
          messages,
          body.errors.find((e) => typeof e.status === "number")?.status
        );
      }
      if (!body || body.data === null || body.data === undefined) {
        throw new AniListError(["empty response (no data)"]);
      }
      return body.data;
    }, this.retryOptions);
  }

  private async waitForPause(): Promise<void> {
    const wait = this.pausedUntil - this.now();
    if (wait > 0) await this.sleep(wait);
  }

  private pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + Math.min(ms, MAX_PAUSE_MS));
  }

  /**
   * Remaining 0 -> espera ate `X-RateLimit-Reset` (epoch em segundos; sem o header, 60 s).
   * Remaining baixo -> espaca as proximas chamadas. `Retry-After` presente tambem pausa.
   */
  private observeRateHeaders(headers: Headers): void {
    const now = this.now();
    const retryAfter = parseRetryAfter(headers.get("retry-after"), now);
    if (retryAfter !== undefined) this.pauseFor(retryAfter);

    const remaining = intHeader(headers, "x-ratelimit-remaining");
    if (remaining === undefined) return;
    if (remaining <= 0) {
      const reset = intHeader(headers, "x-ratelimit-reset");
      const untilReset = reset !== undefined ? reset * 1000 - now : undefined;
      this.pauseFor(untilReset !== undefined && untilReset > 0 ? untilReset : DEFAULT_PAUSE_MS);
    } else if (remaining <= LOW_REMAINING_THRESHOLD) {
      this.pauseFor(LOW_REMAINING_SPACING_MS);
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    (err instanceof SafeFetchError && err.status === 404) ||
    (err instanceof AniListError && err.graphqlStatus === 404)
  );
}
