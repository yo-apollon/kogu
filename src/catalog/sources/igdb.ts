import { getEnv } from "../../config/env.js";
import type { KV } from "../../infra/redis/kv.js";
import { childLogger } from "../../lib/logger.js";
import { createRateLimiter, type RateLimiter } from "../../lib/http/rateLimiter.js";
import { withRetry, type RetryOptions } from "../../lib/http/retry.js";
import { SafeFetchError, safeFetchJson, type LookupFn } from "../../lib/http/safeFetch.js";
import type {
  CatalogSource,
  DiscoverOptions,
  FetchLike,
  RawCharacter,
  RawGender,
  RawSeries,
  SeriesStatus,
  SourceId,
} from "../types.js";

/**
 * Adapter IGDB (API Apicalypse). Autenticacao: OAuth client_credentials da Twitch.
 *
 * - Jogos: POST https://api.igdb.com/v4/games (host `api.igdb.com`).
 * - Personagens: POST https://api.igdb.com/v4/characters.
 * - Token: POST https://id.twitch.tv/oauth2/token (host `id.twitch.tv`), guardado no KV com
 *   TTL `expires_in - 1h` e renovado sozinho. Sem credenciais o adapter fica desabilitado
 *   (`isConfigured() === false`, demais metodos lancam `SourceDisabledError`).
 * - Limites: ~170 req/min (3 req/s no maximo) e ate 4 requisicoes em voo; ate 500 itens por request.
 * - Imagens: `images.igdb.com/igdb/image/upload/t_{size}/{image_id}.jpg`
 *   (capas `t_cover_big`, retratos `t_720p`).
 *
 * IGDB nao tem favoritos por personagem: `RawCharacter.favourites` recebe a popularidade da
 * SERIE (a mesma de `RawSeries.popularity`, lembrada em memoria quando a serie passou por
 * `discover()` nesta instancia) ou 0 quando desconhecida. O scoring deve fazer o percentil
 * por serie, nao tratar esse valor como favoritos reais do personagem.
 *
 * IGDB tambem nao informa papel (MAIN/SUPPORTING): `role` fica indefinido.
 */

/** Fonte desabilitada por falta de credenciais/configuracao. Nao e uma falha transitoria. */
export class SourceDisabledError extends Error {
  readonly source: SourceId;

  constructor(source: SourceId, reason: string) {
    super(`Fonte ${source} desabilitada: ${reason}`);
    this.name = "SourceDisabledError";
    this.source = source;
  }
}

/** Falha ao obter o token OAuth da Twitch (mensagem nunca contem segredos). */
export class IgdbAuthError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "IgdbAuthError";
  }
}

export const IGDB_API_HOST = "api.igdb.com";
export const TWITCH_AUTH_HOST = "id.twitch.tv";
export const IGDB_API_BASE = `https://${IGDB_API_HOST}/v4`;
export const TWITCH_TOKEN_URL = `https://${TWITCH_AUTH_HOST}/oauth2/token`;
export const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload";
/** Chave do KV onde o token Twitch e compartilhado entre processos. */
export const IGDB_TOKEN_KV_KEY = "igdb:twitch:token";

export const IGDB_RATE_PER_MIN = 170;
export const IGDB_BURST = 4;
export const IGDB_MAX_CONCURRENCY = 4;
export const IGDB_PAGE_MAX = 500;

/** Janela do modo `releases`: lancados entre -30d e +7d. */
export const IGDB_RELEASE_WINDOW = { lookbackDays: 30, lookaheadDays: 7 } as const;

/** Tema "Erotic" do IGDB. */
export const IGDB_THEME_EROTIC = 42;

export type IgdbImageSize = "t_cover_big" | "t_720p" | "t_logo_med";
export type IgdbDiscoverMode = "releases" | "popular";

const DAY_MS = 86_400_000;
const TOKEN_EXPIRY_MARGIN_MS = 3_600_000;
const MIN_TOKEN_TTL_MS = 60_000;
const MAX_REMEMBERED_SERIES = 10_000;
const DEFAULT_DISCOVER_LIMIT: Record<IgdbDiscoverMode, number> = { releases: 500, popular: 200 };
const DEFAULT_CHARACTER_LIMIT = 25;

const GAME_FIELDS =
  "id,name,slug,url,first_release_date,cover.image_id,follows,hypes,total_rating_count,themes,age_ratings.*";
const CHARACTER_FIELDS = "id,name,slug,url,gender,description,akas,mug_shot.image_id,games";

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export interface IgdbCredentials {
  clientId?: string;
  clientSecret?: string;
}

export type IgdbKv = Pick<KV, "get" | "set" | "del"> & Partial<Pick<KV, "takeToken">>;

export interface AdapterLogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

export interface IgdbOptions {
  fetchImpl?: FetchLike;
  /** Resolucao de DNS injetavel (testes sem rede). */
  lookupImpl?: LookupFn;
  /** Limitador proprio; padrao: token bucket do KV (se tiver `takeToken`) ou local. */
  rateLimiter?: RateLimiter;
  /** Guarda o token Twitch; se tiver `takeToken`, tambem compartilha o limite entre processos. */
  kv?: IgdbKv;
  /** Relogio (ms epoch). */
  now?: () => number;
  /** `undefined` le TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET do ambiente; `null` desabilita. */
  credentials?: IgdbCredentials | null;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  retry?: Partial<RetryOptions>;
  logger?: AdapterLogger;
  /** Limiar de `hypes` no modo `releases` (padrao 10). */
  minHypes?: number;
  /** Limiar de `follows` no modo `releases` (padrao 50). */
  minFollows?: number;
}

export interface IgdbDiscoverOptions extends DiscoverOptions {
  /** `popular` (padrao): top por `total_rating_count`. `releases`: janela de lancamentos com hype. */
  mode?: IgdbDiscoverMode;
}

interface IgdbIdRef {
  id?: number;
  image_id?: string;
}

interface IgdbAgeRating {
  /** Legado: organizacao (1 = ESRB). */
  category?: number;
  /** Legado: classificacao (12 = ESRB AO). */
  rating?: number;
  organization?: { name?: string } | number;
  rating_category?: { rating?: string } | number;
}

export interface IgdbGame {
  id?: number;
  name?: string;
  slug?: string;
  url?: string;
  first_release_date?: number;
  cover?: IgdbIdRef;
  follows?: number;
  hypes?: number;
  total_rating_count?: number;
  themes?: Array<number | { id?: number }>;
  age_ratings?: IgdbAgeRating[];
}

export interface IgdbCharacter {
  id?: number;
  name?: string;
  slug?: string;
  url?: string;
  gender?: number;
  description?: string;
  akas?: string[];
  mug_shot?: IgdbIdRef;
  games?: number[];
}

interface StoredToken {
  accessToken: string;
  /** Instante (ms epoch) a partir do qual o token deve ser renovado. */
  refreshAt: number;
}

interface TwitchTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

/* ------------------------------------------------------------------ */
/* Funcoes puras de mapeamento                                         */
/* ------------------------------------------------------------------ */

function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function nonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function refId(x: number | { id?: number } | undefined): number | undefined {
  if (typeof x === "number") return x;
  if (x && typeof x === "object" && typeof x.id === "number") return x.id;
  return undefined;
}

/** URL de imagem do CDN do IGDB; `undefined` se o image_id for invalido. */
export function igdbImageUrl(imageId: unknown, size: IgdbImageSize): string | undefined {
  if (typeof imageId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(imageId)) return undefined;
  return `${IGDB_IMAGE_BASE}/${size}/${imageId}.jpg`;
}

/** 0 Male, 1 Female, 2 Other (-> NONBINARY, unico valor nao binario de RawGender); ausente -> UNKNOWN. */
export function mapIgdbGender(gender: unknown): RawGender {
  switch (gender) {
    case 0:
      return "MALE";
    case 1:
      return "FEMALE";
    case 2:
      return "NONBINARY";
    default:
      return "UNKNOWN";
  }
}

/**
 * Sem data ou data futura -> UPCOMING; lancado nos ultimos 30 dias (a janela do modo
 * `releases`) -> RELEASING; mais antigo -> FINISHED.
 */
export function mapIgdbStatus(firstReleaseSec: number | undefined, nowMs: number): SeriesStatus {
  if (typeof firstReleaseSec !== "number" || !Number.isFinite(firstReleaseSec)) return "UPCOMING";
  const releaseMs = firstReleaseSec * 1000;
  if (releaseMs > nowMs) return "UPCOMING";
  return nowMs - releaseMs <= IGDB_RELEASE_WINDOW.lookbackDays * DAY_MS ? "RELEASING" : "FINISHED";
}

function isEsrbAdultsOnly(ar: IgdbAgeRating): boolean {
  if (ar.category === 1 && ar.rating === 12) return true;
  const org = typeof ar.organization === "object" ? ar.organization?.name : undefined;
  const rc = typeof ar.rating_category === "object" ? ar.rating_category?.rating : undefined;
  return org === "ESRB" && rc === "AO";
}

/**
 * Adulto = tema 42 (Erotic) ou classificacao ESRB "Adults Only". PEGI 18 e afins NAO contam:
 * marcariam como adultos jogos comuns de acao.
 */
export function isAdultGame(game: Pick<IgdbGame, "themes" | "age_ratings">): boolean {
  if ((game.themes ?? []).some((t) => refId(t) === IGDB_THEME_EROTIC)) return true;
  return (game.age_ratings ?? []).some(
    (ar) => ar && typeof ar === "object" && isEsrbAdultsOnly(ar)
  );
}

/** Metrica nativa de popularidade: o maior entre follows, hypes e total_rating_count. */
export function igdbPopularity(
  game: Pick<IgdbGame, "follows" | "hypes" | "total_rating_count">
): number {
  return Math.max(
    numOrZero(game.follows),
    numOrZero(game.hypes),
    numOrZero(game.total_rating_count)
  );
}

export function parseIgdbGame(raw: IgdbGame, nowMs: number): RawSeries | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "number" || !Number.isInteger(raw.id) || raw.id <= 0) return null;
  const title = nonEmptyString(raw.name);
  if (!title) return null;

  const slug = nonEmptyString(raw.slug);
  const series: RawSeries = {
    source: "IGDB",
    externalId: String(raw.id),
    title,
    mediaType: "GAME",
    status: mapIgdbStatus(raw.first_release_date, nowMs),
    popularity: igdbPopularity(raw),
    isAdult: isAdultGame(raw),
  };
  if (typeof raw.first_release_date === "number" && Number.isFinite(raw.first_release_date)) {
    series.startDate = new Date(raw.first_release_date * 1000);
  }
  const coverUrl = igdbImageUrl(raw.cover?.image_id, "t_cover_big");
  if (coverUrl) series.coverUrl = coverUrl;
  const url = nonEmptyString(raw.url) ?? (slug ? `https://www.igdb.com/games/${slug}` : undefined);
  if (url) series.url = url;
  return series;
}

export function parseIgdbCharacter(
  raw: IgdbCharacter,
  seriesExternalId: string,
  seriesPopularity: number
): RawCharacter | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "number" || !Number.isInteger(raw.id) || raw.id <= 0) return null;
  const name = nonEmptyString(raw.name);
  if (!name) return null;

  const character: RawCharacter = {
    source: "IGDB",
    externalId: String(raw.id),
    name,
    gender: mapIgdbGender(raw.gender),
    favourites: seriesPopularity,
    seriesExternalId,
  };
  const aliases = (raw.akas ?? [])
    .map(nonEmptyString)
    .filter((a): a is string => a !== undefined && a !== name);
  if (aliases.length > 0) character.aliases = [...new Set(aliases)];
  const description = nonEmptyString(raw.description);
  if (description) character.description = description;
  // Sem mug_shot: imageUrl indefinido (vai para quarentena NO_IMAGE).
  const imageUrl = igdbImageUrl(raw.mug_shot?.image_id, "t_720p");
  if (imageUrl) character.imageUrl = imageUrl;
  const slug = nonEmptyString(raw.slug);
  const url =
    nonEmptyString(raw.url) ?? (slug ? `https://www.igdb.com/characters/${slug}` : undefined);
  if (url) character.url = url;
  return character;
}

/** Corpo Apicalypse. Valores interpolados vem de numeros validados, nunca de texto livre. */
function apicalypse(parts: {
  fields: string;
  where?: string;
  sort?: string;
  limit: number;
  offset?: number;
}): string {
  const lines = [`fields ${parts.fields};`];
  if (parts.where) lines.push(`where ${parts.where};`);
  if (parts.sort) lines.push(`sort ${parts.sort};`);
  lines.push(`limit ${parts.limit};`);
  if (parts.offset !== undefined) lines.push(`offset ${parts.offset};`);
  return lines.join("\n");
}

function assertIgdbId(id: string, what: string): string {
  if (!/^[1-9]\d{0,11}$/.test(id))
    throw new TypeError(`${what} IGDB invalido: ${JSON.stringify(id)}`);
  return id;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function statusOf(err: unknown): number | undefined {
  return err !== null &&
    typeof err === "object" &&
    typeof (err as { status?: unknown }).status === "number"
    ? (err as { status: number }).status
    : undefined;
}

/** Semaforo FIFO simples: repassa a vaga direto ao proximo da fila. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active++;
    } else {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** TTL no KV: `expires_in - 1h`; tokens de vida curta usam metade da vida (minimo 1 s). */
export function igdbTokenTtlMs(expiresInSec: number): number {
  const total = expiresInSec * 1000;
  const ttl = total - TOKEN_EXPIRY_MARGIN_MS;
  return Math.round(ttl >= MIN_TOKEN_TTL_MS ? ttl : Math.max(1000, total / 2));
}

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

export class IgdbSource implements CatalogSource {
  readonly id = "IGDB" as const;
  readonly ratePerMin = IGDB_RATE_PER_MIN;

  // Campos `#` nao sao enumeraveis: logar a instancia nunca vaza o segredo.
  readonly #clientId: string | undefined;
  readonly #clientSecret: string | undefined;
  readonly #fetchImpl: FetchLike | undefined;
  readonly #lookupImpl: LookupFn | undefined;
  readonly #kv: IgdbKv | undefined;
  readonly #now: () => number;
  readonly #sleep: ((ms: number) => Promise<void>) | undefined;
  readonly #random: (() => number) | undefined;
  readonly #retry: Partial<RetryOptions>;
  readonly #limiter: RateLimiter;
  readonly #semaphore = new Semaphore(IGDB_MAX_CONCURRENCY);
  readonly #minHypes: number;
  readonly #minFollows: number;
  readonly #seriesPopularity = new Map<string, number>();
  #logger: AdapterLogger | undefined;
  #tokenCache: StoredToken | undefined;
  #tokenInflight: Promise<string> | undefined;

  constructor(opts: IgdbOptions = {}) {
    const creds = opts.credentials === undefined ? readEnvCredentials() : opts.credentials;
    this.#clientId = nonEmptyString(creds?.clientId);
    this.#clientSecret = nonEmptyString(creds?.clientSecret);
    this.#fetchImpl = opts.fetchImpl;
    this.#lookupImpl = opts.lookupImpl;
    this.#kv = opts.kv;
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep;
    this.#random = opts.random;
    this.#retry = opts.retry ?? {};
    this.#logger = opts.logger;
    this.#minHypes = opts.minHypes ?? 10;
    this.#minFollows = opts.minFollows ?? 50;

    const takeToken = opts.kv?.takeToken;
    this.#limiter =
      opts.rateLimiter ??
      createRateLimiter({
        ...(takeToken && opts.kv ? { kv: { takeToken: takeToken.bind(opts.kv) } } : {}),
        bucket: "catalog:igdb",
        ratePerMin: IGDB_RATE_PER_MIN,
        burst: IGDB_BURST,
        now: this.#now,
        ...(opts.sleep ? { sleep: opts.sleep } : {}),
      });
  }

  /** True quando ha Client ID e Client Secret da Twitch. */
  isConfigured(): boolean {
    return this.#clientId !== undefined && this.#clientSecret !== undefined;
  }

  private get log(): AdapterLogger {
    if (!this.#logger) {
      const base = childLogger("catalog.igdb");
      this.#logger = {
        debug: (obj, msg) => base.debug(obj, msg),
        warn: (obj, msg) => base.warn(obj, msg),
      };
    }
    return this.#logger;
  }

  private assertConfigured(): { clientId: string; clientSecret: string } {
    if (this.#clientId === undefined || this.#clientSecret === undefined) {
      throw new SourceDisabledError("IGDB", "defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET");
    }
    return { clientId: this.#clientId, clientSecret: this.#clientSecret };
  }

  /* ---------------------------- discover --------------------------- */

  async *discover(opts: IgdbDiscoverOptions = {}): AsyncGenerator<RawSeries, void, undefined> {
    this.assertConfigured();
    const mode = opts.mode ?? "popular";
    const limit = clampInt(opts.limit ?? DEFAULT_DISCOVER_LIMIT[mode], 0, Number.MAX_SAFE_INTEGER);
    const startOffset = opts.cursor?.offset;
    let offset =
      typeof startOffset === "number" && Number.isInteger(startOffset) && startOffset >= 0
        ? startOffset
        : 0;
    const seen = new Set<string>();
    let yielded = 0;

    while (yielded < limit) {
      opts.signal?.throwIfAborted();
      const pageSize = Math.min(IGDB_PAGE_MAX, limit - yielded);
      const games = await this.query<IgdbGame>(
        "games",
        this.buildGamesQuery(mode, pageSize, offset)
      );
      const nowMs = this.#now();
      for (const raw of games) {
        const series = parseIgdbGame(raw, nowMs);
        if (!series || seen.has(series.externalId)) continue;
        seen.add(series.externalId);
        this.rememberPopularity(series.externalId, series.popularity);
        yield series;
        if (++yielded >= limit) return;
      }
      if (games.length < pageSize) return;
      offset += games.length;
    }
  }

  private buildGamesQuery(mode: IgdbDiscoverMode, limit: number, offset: number): string {
    // Exclui edicoes (version_parent) e DLC/expansoes (parent_game).
    const base = "version_parent = null & parent_game = null";
    if (mode === "releases") {
      const nowSec = Math.floor(this.#now() / 1000);
      const from = nowSec - IGDB_RELEASE_WINDOW.lookbackDays * 86_400;
      const to = nowSec + IGDB_RELEASE_WINDOW.lookaheadDays * 86_400;
      return apicalypse({
        fields: GAME_FIELDS,
        where:
          `first_release_date >= ${from} & first_release_date <= ${to}` +
          ` & (hypes >= ${this.#minHypes} | follows >= ${this.#minFollows}) & ${base}`,
        sort: "first_release_date desc",
        limit,
        offset,
      });
    }
    return apicalypse({
      fields: GAME_FIELDS,
      where: `total_rating_count > 0 & ${base}`,
      sort: "total_rating_count desc",
      limit,
      offset,
    });
  }

  private rememberPopularity(seriesId: string, popularity: number): void {
    const map = this.#seriesPopularity;
    if (!map.has(seriesId) && map.size >= MAX_REMEMBERED_SERIES) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(seriesId, popularity);
  }

  /* ------------------------ characters / refresh ------------------- */

  async fetchCharacters(gameId: string, opts: { limit?: number } = {}): Promise<RawCharacter[]> {
    this.assertConfigured();
    assertIgdbId(gameId, "id de jogo");
    const limit = clampInt(opts.limit ?? DEFAULT_CHARACTER_LIMIT, 0, IGDB_PAGE_MAX);
    if (limit === 0) return [];
    const rows = await this.query<IgdbCharacter>(
      "characters",
      apicalypse({ fields: CHARACTER_FIELDS, where: `games = (${gameId})`, sort: "id asc", limit })
    );
    const popularity = this.#seriesPopularity.get(gameId) ?? 0;
    const out: RawCharacter[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const c = parseIgdbCharacter(row, gameId, popularity);
      if (!c || seen.has(c.externalId)) continue;
      seen.add(c.externalId);
      out.push(c);
    }
    return out;
  }

  /**
   * Rele personagens por ID (`/characters where id = (...)`, em blocos de 500). A serie vem de
   * `games[0]`; `favourites` usa a popularidade lembrada dessa serie ou 0 (o chamador nao deve
   * sobrescrever um valor ja gravado por 0). IDs invalidos sao ignorados com aviso.
   */
  async refresh(externalIds: string[]): Promise<RawCharacter[]> {
    this.assertConfigured();
    const valid: string[] = [];
    for (const id of new Set(externalIds)) {
      if (/^[1-9]\d{0,11}$/.test(id)) valid.push(id);
      else this.log.warn({ id }, "igdb refresh: id invalido ignorado");
    }
    const out: RawCharacter[] = [];
    for (let i = 0; i < valid.length; i += IGDB_PAGE_MAX) {
      const chunk = valid.slice(i, i + IGDB_PAGE_MAX);
      const rows = await this.query<IgdbCharacter>(
        "characters",
        apicalypse({
          fields: CHARACTER_FIELDS,
          where: `id = (${chunk.join(",")})`,
          limit: chunk.length,
        })
      );
      for (const row of rows) {
        const seriesId = typeof row?.games?.[0] === "number" ? String(row.games[0]) : "";
        const c = parseIgdbCharacter(row, seriesId, this.#seriesPopularity.get(seriesId) ?? 0);
        if (c) out.push(c);
      }
    }
    return out;
  }

  /* --------------------------- HTTP / token ------------------------ */

  private retryOptions(label: string): Partial<RetryOptions> {
    return {
      ...this.#retry,
      ...(this.#sleep ? { sleep: this.#sleep } : {}),
      ...(this.#random ? { random: this.#random } : {}),
      now: this.#now,
      onRetry: (err, attempt, delayMs) => {
        const status = statusOf(err);
        this.log.warn(
          { endpoint: label, attempt, delayMs, ...(status === undefined ? {} : { status }) },
          "igdb retry"
        );
      },
    };
  }

  /** POST Apicalypse com limite de taxa, concorrencia maxima 4, retry e renovacao de token em 401. */
  private async query<T>(endpoint: "games" | "characters", body: string): Promise<T[]> {
    const { clientId } = this.assertConfigured();
    let reauthed = false;
    return withRetry(
      () =>
        this.#semaphore.run(async () => {
          for (;;) {
            const token = await this.getToken();
            await this.#limiter.acquire();
            try {
              const res = await safeFetchJson<unknown>(`${IGDB_API_BASE}/${endpoint}`, {
                allowHosts: [IGDB_API_HOST],
                method: "POST",
                headers: {
                  "client-id": clientId,
                  authorization: `Bearer ${token}`,
                  "content-type": "text/plain",
                },
                body,
                ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
                ...(this.#lookupImpl ? { lookupImpl: this.#lookupImpl } : {}),
              });
              if (!Array.isArray(res.data)) {
                throw new SafeFetchError(
                  "HTTP_ERROR",
                  `resposta inesperada do IGDB em /${endpoint}`
                );
              }
              return res.data as T[];
            } catch (err) {
              if (!reauthed && statusOf(err) === 401) {
                reauthed = true;
                await this.invalidateToken(token);
                continue;
              }
              throw err;
            }
          }
        }),
      this.retryOptions(endpoint)
    );
  }

  private async getToken(): Promise<string> {
    const cached = this.#tokenCache;
    if (cached && this.#now() < cached.refreshAt) return cached.accessToken;
    if (!this.#tokenInflight) {
      this.#tokenInflight = this.loadOrRequestToken().finally(() => {
        this.#tokenInflight = undefined;
      });
    }
    return this.#tokenInflight;
  }

  private async loadOrRequestToken(): Promise<string> {
    const stored = await this.readStoredToken();
    if (stored && this.#now() < stored.refreshAt) {
      this.#tokenCache = stored;
      return stored.accessToken;
    }
    const fresh = await this.requestToken();
    this.#tokenCache = fresh.token;
    await this.writeStoredToken(fresh.token, fresh.ttlMs);
    return fresh.token.accessToken;
  }

  private async requestToken(): Promise<{ token: StoredToken; ttlMs: number }> {
    const { clientId, clientSecret } = this.assertConfigured();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }).toString();

    let data: TwitchTokenResponse;
    try {
      const res = await withRetry(
        () =>
          safeFetchJson<TwitchTokenResponse>(TWITCH_TOKEN_URL, {
            allowHosts: [TWITCH_AUTH_HOST],
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
            ...(this.#fetchImpl ? { fetchImpl: this.#fetchImpl } : {}),
            ...(this.#lookupImpl ? { lookupImpl: this.#lookupImpl } : {}),
          }),
        this.retryOptions("twitch-token")
      );
      data = res.data;
    } catch (err) {
      const status = statusOf(err);
      // A mensagem nao inclui credenciais: o segredo so trafega no corpo da requisicao.
      throw new IgdbAuthError(
        `Falha ao obter token Twitch para o IGDB${status === undefined ? "" : ` (HTTP ${status})`}`,
        err
      );
    }
    const accessToken = nonEmptyString(data?.access_token);
    const expiresIn = data?.expires_in;
    if (
      !accessToken ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new IgdbAuthError("Resposta de token Twitch invalida");
    }
    const ttlMs = igdbTokenTtlMs(expiresIn);
    return { token: { accessToken, refreshAt: this.#now() + ttlMs }, ttlMs };
  }

  private async invalidateToken(failedToken: string): Promise<void> {
    if (this.#tokenCache?.accessToken === failedToken) this.#tokenCache = undefined;
    const kv = this.#kv;
    if (!kv) return;
    try {
      const stored = await this.readStoredToken();
      if (stored?.accessToken === failedToken) await kv.del(IGDB_TOKEN_KV_KEY);
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "igdb: falha ao invalidar token no kv"
      );
    }
  }

  private async readStoredToken(): Promise<StoredToken | undefined> {
    const kv = this.#kv;
    if (!kv) return undefined;
    try {
      const raw = await kv.get(IGDB_TOKEN_KV_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as Partial<StoredToken>;
      if (typeof parsed.accessToken === "string" && typeof parsed.refreshAt === "number") {
        return { accessToken: parsed.accessToken, refreshAt: parsed.refreshAt };
      }
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "igdb: falha ao ler token do kv"
      );
    }
    return undefined;
  }

  private async writeStoredToken(token: StoredToken, ttlMs: number): Promise<void> {
    const kv = this.#kv;
    if (!kv) return;
    try {
      await kv.set(IGDB_TOKEN_KV_KEY, JSON.stringify(token), { px: ttlMs });
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "igdb: falha ao gravar token no kv"
      );
    }
  }
}

function readEnvCredentials(): IgdbCredentials {
  const env = getEnv();
  return { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET };
}
