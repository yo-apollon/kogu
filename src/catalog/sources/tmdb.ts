import { getEnv } from "../../config/env.js";
import type { KV } from "../../infra/redis/kv.js";
import { childLogger } from "../../lib/logger.js";
import { createRateLimiter, type RateLimiter } from "../../lib/http/rateLimiter.js";
import { withRetry, type RetryOptions } from "../../lib/http/retry.js";
import { SafeFetchError, safeFetchJson, type LookupFn } from "../../lib/http/safeFetch.js";
import { slugify } from "../../lib/text/normalize.js";
import type {
  CatalogSource,
  DiscoverOptions,
  FetchLike,
  RawCharacter,
  RawGender,
  RawSeries,
  SeriesStatus,
} from "../types.js";
import { SourceDisabledError, type AdapterLogger } from "./igdb.js";

export { SourceDisabledError };

/**
 * Adapter TMDB (API v3, host `api.themoviedb.org`; imagens em `image.tmdb.org`).
 *
 * Autenticacao: chave v3 em `api_key` (query) ou, se a chave comecar com `eyJ` (token v4,
 * JWT), `Authorization: Bearer` e a chave NAO entra na URL. A chave nunca e logada: URLs de
 * log passam por `redactUrl`, mensagens de erro por `redactSecrets` e a instancia guarda a
 * chave em campo privado (`#`), que nao e serializado.
 *
 * Atribuicao obrigatoria: exiba `TMDB_ATTRIBUTION` no `/help` (e onde dados do TMDB aparecerem).
 *
 * IDs externos (documentado porque o TMDB tem namespaces separados para filmes e series):
 * - Serie/obra: `movie:123` ou `tv:123`.
 * - Personagem: `movie:123:<personId>:<slug-do-personagem>` (o TMDB nao tem ID de personagem;
 *   a dupla ator + papel dentro da obra e estavel e permite `refresh()`).
 *
 * Limitacoes de personagens (leia antes de usar):
 * - Live-action: `isRealPerson: true` e `imageUrl` e a FOTO DO ATOR (`profile_path`). Essas
 *   entradas devem ir para revisao manual/quarentena, nunca entrar automaticamente no pool.
 * - Animacao: `isRealPerson: false` (o ator e apenas a voz) e `imageUrl` fica INDEFINIDO de
 *   proposito: a foto do dublador nao e arte do personagem. Esses personagens caem na
 *   quarentena NO_IMAGE ate alguem fornecer arte (ex.: via AniList/Jikan por dedupe). O
 *   `gender` e o do ator e pode divergir do personagem em animacao.
 * - `favourites` e a popularidade do ator (0 se ausente); `role` MAIN para os 5 primeiros do
 *   billing, SUPPORTING para os demais.
 * - `status` de series e heuristico (a lista de trending nao traz o status real): futuro ->
 *   UPCOMING; filme com ate 60 dias / serie com ate 180 dias da data de estreia -> RELEASING;
 *   demais -> FINISHED.
 */

export const TMDB_ATTRIBUTION =
  "Este produto usa a API do TMDB mas não é endossado ou certificado pelo TMDB.";

export const TMDB_API_HOST = "api.themoviedb.org";
export const TMDB_API_BASE = `https://${TMDB_API_HOST}/3`;
export const TMDB_IMAGE_HOST = "image.tmdb.org";
export const TMDB_IMAGE_BASE = `https://${TMDB_IMAGE_HOST}/t/p`;

export const TMDB_RATE_PER_MIN = 1200;
export const TMDB_BURST = 20;
export const TMDB_ANIMATION_GENRE_ID = 16;

/** Tamanhos validos: posters aceitam w780; fotos de perfil do TMDB nao tem w780 (usam h632). */
export const TMDB_POSTER_SIZE = "w780";
export const TMDB_PROFILE_SIZE = "h632";

export type TmdbKind = "movie" | "tv";
export type TmdbDiscoverMode = "trending";

const DAY_MS = 86_400_000;
const RELEASING_WINDOW_DAYS: Record<TmdbKind, number> = { movie: 60, tv: 180 };
const MAIN_BILLING_CUTOFF = 5;
const DEFAULT_DISCOVER_LIMIT = 100;
const DEFAULT_CHARACTER_LIMIT = 25;
const MAX_CHARACTER_LIMIT = 500;
const MAX_TRENDING_PAGES = 500;
const MAX_REMEMBERED = 10_000;
const REDACTED = "[REDACTED]";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export interface TmdbCredentials {
  apiKey?: string;
}

export interface TmdbOptions {
  fetchImpl?: FetchLike;
  /** Resolucao de DNS injetavel (testes sem rede). */
  lookupImpl?: LookupFn;
  /** Limitador proprio; padrao: token bucket do KV (se informado) ou local. */
  rateLimiter?: RateLimiter;
  /** Usado so para compartilhar o limite de taxa entre processos. */
  kv?: Pick<KV, "takeToken">;
  now?: () => number;
  /** `undefined` le TMDB_API_KEY do ambiente; `null` desabilita. */
  credentials?: TmdbCredentials | null;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retry?: Partial<RetryOptions>;
  logger?: AdapterLogger;
}

export interface TmdbDiscoverOptions extends DiscoverOptions {
  /** Unico modo hoje: `trending` (filmes e series da semana). */
  mode?: TmdbDiscoverMode;
}

export interface TmdbListItem {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  poster_path?: string | null;
  genre_ids?: number[];
  release_date?: string;
  first_air_date?: string;
  adult?: boolean;
  popularity?: number;
}

interface TmdbListPage {
  page?: number;
  results?: TmdbListItem[];
  total_pages?: number;
}

export interface TmdbCastMember {
  id?: number;
  name?: string;
  gender?: number;
  profile_path?: string | null;
  character?: string;
  order?: number;
  popularity?: number;
  adult?: boolean;
}

interface TmdbCredits {
  cast?: TmdbCastMember[];
}

interface TmdbDetails {
  genres?: Array<{ id?: number }>;
}

export interface TmdbSeriesRef {
  kind: TmdbKind;
  id: string;
}

/* ------------------------------------------------------------------ */
/* Redacao de segredos                                                 */
/* ------------------------------------------------------------------ */

/** Troca o valor de `api_key` por [REDACTED]; retorna a entrada intacta se nao for URL. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("api_key")) u.searchParams.set("api_key", "REDACTED");
    return u.href;
  } catch {
    return redactSecrets(url, []);
  }
}

/** Remove os segredos informados (literais e codificados) e padroes `api_key=`/`Bearer` do texto. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const variant of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(variant).join(REDACTED);
    }
  }
  return out
    .replace(/(api_key=)[^&\s"']+/gi, `$1${REDACTED}`)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`);
}

/** Recria o erro sem `cause` e com a mensagem redigida, preservando status/Retry-After para o retry. */
function sanitizeError(err: unknown, secrets: readonly string[]): SafeFetchError {
  const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets);
  if (err instanceof SafeFetchError) {
    return new SafeFetchError(err.code, message, {
      ...(err.status === undefined ? {} : { status: err.status }),
      ...(err.retryAfterMs === undefined ? {} : { retryAfterMs: err.retryAfterMs }),
    });
  }
  return new SafeFetchError("HTTP_ERROR", `request failed: ${message}`);
}

function statusOf(err: unknown): number | undefined {
  return err !== null &&
    typeof err === "object" &&
    typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;
}

/* ------------------------------------------------------------------ */
/* Funcoes puras de mapeamento                                         */
/* ------------------------------------------------------------------ */

function nonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Chaves v4 (JWT) comecam com `eyJ` e vao em Authorization; v3 vai em `api_key`. */
export function isTmdbBearerToken(key: string): boolean {
  return key.startsWith("eyJ");
}

/** `{path}` do TMDB -> URL completa; `undefined` se o caminho for invalido. */
export function tmdbImageUrl(path: unknown, size: string): string | undefined {
  if (typeof path !== "string" || !/^\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(path))
    return undefined;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function parseTmdbSeriesId(externalId: string): TmdbSeriesRef {
  const m = /^(movie|tv):([1-9]\d{0,9})$/.exec(externalId);
  if (!m)
    throw new TypeError(
      `id de serie TMDB invalido (use "movie:123" ou "tv:123"): ${JSON.stringify(externalId)}`
    );
  return { kind: m[1] as TmdbKind, id: m[2] };
}

export function parseTmdbCharacterId(
  externalId: string
): { series: TmdbSeriesRef; personId: string } | null {
  const m = /^(movie|tv):([1-9]\d{0,9}):(\d{1,12}):[a-z0-9-]+$/.exec(externalId);
  return m ? { series: { kind: m[1] as TmdbKind, id: m[2] }, personId: m[3] } : null;
}

function parseIsoDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? date
    : undefined;
}

export function mapTmdbStatus(
  kind: TmdbKind,
  start: Date | undefined,
  nowMs: number
): SeriesStatus {
  if (!start) return "UPCOMING";
  const t = start.getTime();
  if (t > nowMs) return "UPCOMING";
  return (nowMs - t) / DAY_MS <= RELEASING_WINDOW_DAYS[kind] ? "RELEASING" : "FINISHED";
}

/** 1 Female, 2 Male, 3 NonBinary, 0/ausente UNKNOWN. */
export function mapTmdbGender(gender: unknown): RawGender {
  switch (gender) {
    case 1:
      return "FEMALE";
    case 2:
      return "MALE";
    case 3:
      return "NONBINARY";
    default:
      return "UNKNOWN";
  }
}

export function isTmdbAnimation(genreIds: readonly unknown[] | undefined): boolean {
  return (genreIds ?? []).includes(TMDB_ANIMATION_GENRE_ID);
}

export function parseTmdbSeries(
  raw: TmdbListItem,
  kind: TmdbKind,
  nowMs: number
): RawSeries | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "number" || !Number.isInteger(raw.id) || raw.id <= 0) return null;
  const original = nonEmptyString(kind === "movie" ? raw.original_title : raw.original_name);
  const title = nonEmptyString(kind === "movie" ? raw.title : raw.name) ?? original;
  if (!title) return null;

  const start = parseIsoDate(kind === "movie" ? raw.release_date : raw.first_air_date);
  const popularity =
    typeof raw.popularity === "number" && Number.isFinite(raw.popularity)
      ? Math.max(0, raw.popularity)
      : 0;
  const series: RawSeries = {
    source: "TMDB",
    externalId: `${kind}:${raw.id}`,
    title,
    mediaType: kind === "movie" ? "MOVIE" : "TV",
    status: mapTmdbStatus(kind, start, nowMs),
    popularity,
    isAdult: raw.adult === true,
    isAnimation: isTmdbAnimation(raw.genre_ids),
    url: `https://www.themoviedb.org/${kind}/${raw.id}`,
  };
  if (original && original !== title) series.titleNative = original;
  // A lista vem em en-US: so e titulo em ingles se for o original em ingles ou uma traducao.
  if (raw.original_language === "en" || (original !== undefined && original !== title))
    series.titleEnglish = title;
  if (start) series.startDate = start;
  const coverUrl = tmdbImageUrl(raw.poster_path, TMDB_POSTER_SIZE);
  if (coverUrl) series.coverUrl = coverUrl;
  return series;
}

const SELF_REFERENCE = /^(self|himself|herself|themselves|themself)\b/i;

/**
 * Limpa o campo `character` do TMDB: remove anotacoes "(voice)", "(uncredited)", "[as ...]",
 * separa "Tony Stark / Iron Man" em nome + aliases e descarta aparicoes como "Self"/"Himself".
 */
export function cleanTmdbCharacterName(raw: string): { name: string; aliases: string[] } | null {
  const parts = raw
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+\/\s+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "" && !SELF_REFERENCE.test(p));
  const [name, ...rest] = parts;
  if (!name) return null;
  return { name, aliases: [...new Set(rest.filter((a) => a !== name))] };
}

export function tmdbCharacterExternalId(
  series: TmdbSeriesRef,
  personId: number,
  characterName: string
): string {
  return `${series.kind}:${series.id}:${personId}:${slugify(characterName, 60) || "x"}`;
}

/** Cast (ja em ordem de billing) -> personagens. Ver as limitacoes de animacao/live-action no topo. */
export function mapTmdbCast(
  cast: readonly TmdbCastMember[] | undefined,
  series: TmdbSeriesRef,
  isAnimation: boolean,
  limit: number
): RawCharacter[] {
  const seriesExternalId = `${series.kind}:${series.id}`;
  const ordered = [...(cast ?? [])]
    .filter((m): m is TmdbCastMember => !!m && typeof m === "object")
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  const out: RawCharacter[] = [];
  const seen = new Set<string>();
  for (const member of ordered) {
    if (out.length >= limit) break;
    if (typeof member.id !== "number" || !Number.isInteger(member.id) || member.id <= 0) continue;
    const cleaned = cleanTmdbCharacterName(nonEmptyString(member.character) ?? "");
    if (!cleaned) continue;
    const externalId = tmdbCharacterExternalId(series, member.id, cleaned.name);
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const popularity =
      typeof member.popularity === "number" && Number.isFinite(member.popularity)
        ? Math.max(0, member.popularity)
        : 0;
    const character: RawCharacter = {
      source: "TMDB",
      externalId,
      name: cleaned.name,
      gender: mapTmdbGender(member.gender),
      favourites: popularity,
      seriesExternalId,
      role:
        typeof member.order === "number" && member.order < MAIN_BILLING_CUTOFF
          ? "MAIN"
          : "SUPPORTING",
      isRealPerson: !isAnimation,
      // Animacao: pagina da obra (nao ha pagina de personagem). Live-action: pagina do ator.
      url: isAnimation
        ? `https://www.themoviedb.org/${series.kind}/${series.id}`
        : `https://www.themoviedb.org/person/${member.id}`,
    };
    if (cleaned.aliases.length > 0) character.aliases = cleaned.aliases;
    if (member.adult === true) character.isAdult = true;
    if (!isAnimation) {
      const imageUrl = tmdbImageUrl(member.profile_path, TMDB_PROFILE_SIZE);
      if (imageUrl) character.imageUrl = imageUrl;
    }
    out.push(character);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

function readEnvApiKey(): string | undefined {
  return getEnv().TMDB_API_KEY;
}

export class TmdbSource implements CatalogSource {
  readonly id = "TMDB" as const;
  readonly ratePerMin = TMDB_RATE_PER_MIN;

  // Campos `#` nao sao enumeraveis: logar a instancia nunca vaza a chave.
  readonly #apiKey: string | undefined;
  readonly #fetchImpl: FetchLike | undefined;
  readonly #lookupImpl: LookupFn | undefined;
  readonly #now: () => number;
  readonly #sleep: ((ms: number) => Promise<void>) | undefined;
  readonly #random: (() => number) | undefined;
  readonly #retry: Partial<RetryOptions>;
  readonly #limiter: RateLimiter;
  readonly #animationCache = new Map<string, boolean>();
  #logger: AdapterLogger | undefined;
  #invalidKey = false;

  constructor(opts: TmdbOptions = {}) {
    const raw =
      opts.credentials === undefined ? readEnvApiKey() : nonEmptyString(opts.credentials?.apiKey);
    const key = nonEmptyString(raw);
    // Formato defensivo: bloqueia espacos/CRLF (injecao de header) sem repetir o valor na mensagem.
    if (key !== undefined && !/^[A-Za-z0-9._~+/=-]+$/.test(key)) {
      this.#invalidKey = true;
    } else {
      this.#apiKey = key;
    }
    this.#fetchImpl = opts.fetchImpl;
    this.#lookupImpl = opts.lookupImpl;
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep;
    this.#random = opts.random;
    this.#retry = opts.retry ?? {};
    this.#logger = opts.logger;

    this.#limiter =
      opts.rateLimiter ??
      createRateLimiter({
        ...(opts.kv?.takeToken ? { kv: { takeToken: opts.kv.takeToken.bind(opts.kv) } } : {}),
        bucket: "catalog:tmdb",
        ratePerMin: TMDB_RATE_PER_MIN,
        burst: TMDB_BURST,
        now: this.#now,
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      });
  }

  /** True quando ha uma chave de API valida. */
  isConfigured(): boolean {
    return this.#apiKey !== undefined;
  }

  private get log(): AdapterLogger {
    if (!this.#logger) {
      const base = childLogger("catalog.tmdb");
      this.#logger = {
        debug: (obj, msg) => base.debug(obj, msg),
        warn: (obj, msg) => base.warn(obj, msg),
      };
    }
    return this.#logger;
  }

  private assertConfigured(): string {
    if (this.#apiKey === undefined) {
      throw new SourceDisabledError(
        "TMDB",
        this.#invalidKey ? "TMDB_API_KEY com formato invalido" : "defina TMDB_API_KEY"
      );
    }
    return this.#apiKey;
  }

  /* ---------------------------- discover --------------------------- */

  /**
   * Trending da semana. Alterna filmes e series pagina a pagina ate atingir `limit`
   * (padrao 100). Tudo e retornado; o filtro "so animacao entra automatico" e do pipeline
   * (`RawSeries.isAnimation`). `cursor.page` define a pagina inicial.
   */
  async *discover(opts: TmdbDiscoverOptions = {}): AsyncGenerator<RawSeries, void, undefined> {
    this.assertConfigured();
    const mode = opts.mode ?? "trending";
    if (mode !== "trending") throw new RangeError(`modo TMDB desconhecido: ${String(mode)}`);
    const limit = clampInt(opts.limit ?? DEFAULT_DISCOVER_LIMIT, 0, Number.MAX_SAFE_INTEGER);
    const startPage = opts.cursor?.page;
    let page =
      typeof startPage === "number" && Number.isInteger(startPage) && startPage >= 1
        ? startPage
        : 1;
    const exhausted: Record<TmdbKind, boolean> = { movie: false, tv: false };
    const seen = new Set<string>();
    let yielded = 0;

    while (yielded < limit && !(exhausted.movie && exhausted.tv)) {
      for (const kind of ["movie", "tv"] as const) {
        if (exhausted[kind]) continue;
        opts.signal?.throwIfAborted();
        const data = await this.get<TmdbListPage>(`/trending/${kind}/week`, {
          page,
          language: "en-US",
        });
        const results = Array.isArray(data?.results) ? data.results : [];
        const totalPages = Math.min(
          MAX_TRENDING_PAGES,
          typeof data?.total_pages === "number" ? data.total_pages : page
        );
        if (results.length === 0 || page >= totalPages) exhausted[kind] = true;

        const nowMs = this.#now();
        for (const item of results) {
          const series = parseTmdbSeries(item, kind, nowMs);
          if (!series || seen.has(series.externalId)) continue;
          seen.add(series.externalId);
          this.rememberAnimation(series.externalId, series.isAnimation === true);
          yield series;
          if (++yielded >= limit) return;
        }
      }
      page++;
    }
  }

  private rememberAnimation(seriesId: string, isAnimation: boolean): void {
    const map = this.#animationCache;
    if (!map.has(seriesId) && map.size >= MAX_REMEMBERED) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(seriesId, isAnimation);
  }

  /* ------------------------ characters / refresh ------------------- */

  /**
   * `seriesExternalId` no formato `movie:123` / `tv:123`. Descobre se a obra e animacao pelo
   * cache do `discover()` ou, na falta, por `GET /movie|tv/{id}` (genero 16). Em duvida (sem
   * genero) trata como live-action: o resultado e `isRealPerson: true`, que o pipeline poe em
   * quarentena, o lado seguro para fotos de pessoas.
   */
  async fetchCharacters(
    seriesExternalId: string,
    opts: { limit?: number } = {}
  ): Promise<RawCharacter[]> {
    this.assertConfigured();
    const ref = parseTmdbSeriesId(seriesExternalId);
    const limit = clampInt(opts.limit ?? DEFAULT_CHARACTER_LIMIT, 0, MAX_CHARACTER_LIMIT);
    if (limit === 0) return [];
    const isAnimation = await this.resolveIsAnimation(ref);
    const credits = await this.get<TmdbCredits>(`/${ref.kind}/${ref.id}/credits`, {
      language: "en-US",
    });
    return mapTmdbCast(credits?.cast, ref, isAnimation, limit);
  }

  private async resolveIsAnimation(ref: TmdbSeriesRef): Promise<boolean> {
    const key = `${ref.kind}:${ref.id}`;
    const cached = this.#animationCache.get(key);
    if (cached !== undefined) return cached;
    const details = await this.get<TmdbDetails>(`/${ref.kind}/${ref.id}`, { language: "en-US" });
    const isAnimation = (details?.genres ?? []).some((g) => g?.id === TMDB_ANIMATION_GENRE_ID);
    this.rememberAnimation(key, isAnimation);
    return isAnimation;
  }

  /**
   * Revalida personagens por ID (formato `movie:123:<personId>:<slug>`): agrupa por obra, rele
   * o elenco completo (1 a 2 requests por obra) e devolve so os IDs pedidos. IDs invalidos sao
   * ignorados com aviso; obra removida (404) e pulada.
   */
  async refresh(externalIds: string[]): Promise<RawCharacter[]> {
    this.assertConfigured();
    const bySeries = new Map<string, { ref: TmdbSeriesRef; wanted: Set<string> }>();
    for (const id of new Set(externalIds)) {
      const parsed = parseTmdbCharacterId(id);
      if (!parsed) {
        this.log.warn({ id }, "tmdb refresh: id invalido ignorado");
        continue;
      }
      const key = `${parsed.series.kind}:${parsed.series.id}`;
      const group = bySeries.get(key) ?? { ref: parsed.series, wanted: new Set<string>() };
      group.wanted.add(id);
      bySeries.set(key, group);
    }

    const out: RawCharacter[] = [];
    for (const [key, { wanted }] of bySeries) {
      try {
        const all = await this.fetchCharacters(key, { limit: MAX_CHARACTER_LIMIT });
        for (const c of all) if (wanted.has(c.externalId)) out.push(c);
      } catch (err) {
        if (statusOf(err) === 404) {
          this.log.warn({ series: key }, "tmdb refresh: obra nao encontrada (404), pulando");
          continue;
        }
        throw err;
      }
    }
    return out;
  }

  /* ------------------------------ HTTP ----------------------------- */

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const apiKey = this.assertConfigured();
    const bearer = isTmdbBearerToken(apiKey);
    const url = new URL(`${TMDB_API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    if (!bearer) url.searchParams.set("api_key", apiKey);
    const secrets = [apiKey];

    return withRetry(
      async () => {
        await this.#limiter.acquire();
        this.log.debug({ url: redactUrl(url.href) }, "tmdb request");
        try {
          const res = await safeFetchJson<T>(url.href, {
            allowHosts: [TMDB_API_HOST],
            ...(bearer ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
            ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
            ...(this.#lookupImpl ? { lookupImpl: this.#lookupImpl } : {}),
          });
          return res.data;
        } catch (err) {
          throw sanitizeError(err, secrets);
        }
      },
      {
        ...this.#retry,
        ...(this.#sleep ? { sleep: this.#sleep } : {}),
        ...(this.#random ? { random: this.#random } : {}),
        now: this.#now,
        onRetry: (err, attempt, delayMs) => {
          const status = statusOf(err);
          this.log.warn(
            { path, attempt, delayMs, ...(status === undefined ? {} : { status }) },
            "tmdb retry"
          );
        },
      }
    );
  }
}
