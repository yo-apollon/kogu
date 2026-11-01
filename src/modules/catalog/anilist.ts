/**
 * Busca de personagem por nome no AniList para `$import` / `$approvesuggest`.
 *
 * O adapter `catalog/sources/anilist.ts` (CatalogSource) so sabe varrer series e personagens por
 * id; nao ha busca textual nele e o `request` e privado. Por isso a consulta mora aqui, reaproveitando
 * do adapter as constantes e os mapeadores exportados (mapAniListMedia/Gender/Image) e a mesma
 * infra do pipeline: `safeFetchJson` (allowlist + anti-SSRF), `withRetry` e o token bucket
 * `catalog:anilist` (compartilhado com o worker quando ha Redis).
 */
import {
  ANILIST_HOST,
  ANILIST_RATE_PER_MIN,
  ANILIST_URL,
  mapAniListGender,
  mapAniListMedia,
  normalizeAniListImage,
  type AniListMedia,
} from "../../catalog/sources/anilist.js";
import type { FetchLike, RawCharacter, RawSeries } from "../../catalog/types.js";
import { type RateLimiter, createRateLimiter } from "../../lib/http/rateLimiter.js";
import { type RetryOptions, withRetry } from "../../lib/http/retry.js";
import { type LookupFn, SafeFetchError, safeFetchJson } from "../../lib/http/safeFetch.js";
import { nameTokens, trigramSimilarity } from "../../lib/text/normalize.js";

export interface CharacterMatch {
  series: RawSeries;
  character: RawCharacter;
}

/** Contrato injetavel (testes) da busca por nome. */
export interface CharacterFinder {
  find(query: string): Promise<CharacterMatch | null>;
}

/** Falha de infraestrutura ao falar com o AniList (rede, 5xx, 429 esgotado, GraphQL). */
export class CatalogApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CatalogApiError";
  }
}

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    characters(search: $search, sort: SEARCH_MATCH) {
      id
      name { full native alternative }
      gender description
      image { large }
      favourites siteUrl
      media(sort: POPULARITY_DESC, perPage: 1) {
        edges {
          characterRole
          node {
            id idMal type format status
            title { romaji english native }
            startDate { year month day }
            endDate { year month day }
            popularity favourites
            coverImage { large }
            isAdult siteUrl
          }
        }
      }
    }
  }
}`;

const SEARCH_PER_PAGE = 5;
const USER_AGENT = "KoguBot/2.0 (Discord gacha bot; AniList character import)";
/** Minimo de similaridade (trigramas) para aceitar um resultado cujos tokens nao contem a busca. */
const MIN_SIMILARITY = 0.35;

interface CharacterNode {
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
    edges?: Array<{ characterRole?: string | null; node?: AniListMedia | null } | null> | null;
  } | null;
}

interface SearchResponse {
  data?: { Page?: { characters?: Array<CharacterNode | null> | null } | null } | null;
  errors?: Array<{ message?: string; status?: number }> | null;
}

function clean(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** Nomes pelos quais o personagem e conhecido (principal, nativo e alternativos). */
function namesOf(node: CharacterNode): string[] {
  return [
    clean(node.name?.full),
    clean(node.name?.native),
    ...(node.name?.alternative ?? []).map((a) => clean(a)),
  ].filter((n): n is string => n !== undefined);
}

/**
 * O resultado "parece" a busca? Todos os tokens da busca aparecem nos nomes, ou a similaridade de
 * trigramas passa do minimo. Evita importar um personagem aleatorio quando o AniList devolve o
 * "menos pior" para um nome que nao existe.
 */
export function matchesQuery(query: string, names: readonly string[]): boolean {
  const wanted = nameTokens(query);
  if (wanted.length === 0) return false;
  const have = new Set(names.flatMap((n) => nameTokens(n)));
  if (wanted.every((token) => have.has(token))) return true;
  return names.some((n) => trigramSimilarity(query, n) >= MIN_SIMILARITY);
}

/** Converte o primeiro personagem com obra vinculada e nome compativel em serie + personagem. */
export function pickMatch(
  query: string,
  nodes: ReadonlyArray<CharacterNode | null> | null | undefined
): CharacterMatch | null {
  for (const node of nodes ?? []) {
    if (!node || typeof node.id !== "number" || !Number.isInteger(node.id)) continue;
    const name = clean(node.name?.full) ?? clean(node.name?.native);
    if (!name || !matchesQuery(query, namesOf(node))) continue;

    const edge = node.media?.edges?.find((e) => e?.node && typeof e.node.id === "number");
    const series = mapAniListMedia(edge?.node ?? null);
    if (!edge || !series) continue;

    const character: RawCharacter = {
      source: "ANILIST",
      externalId: String(node.id),
      name,
      gender: mapAniListGender(node.gender),
      favourites: node.favourites ?? 0,
      seriesExternalId: series.externalId,
      isAdult: series.isAdult,
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
    const description = clean(node.description);
    if (description) character.description = description;
    const image = normalizeAniListImage(node.image?.large);
    if (image) character.imageUrl = image;
    const role = edge.characterRole?.toUpperCase();
    if (role === "MAIN" || role === "SUPPORTING") character.role = role;
    const url = clean(node.siteUrl);
    if (url) character.url = url;
    return { series, character };
  }
  return null;
}

export interface AniListFinderOptions {
  fetchImpl?: FetchLike;
  lookupImpl?: LookupFn;
  /** Padrao: bucket local de 25 req/min. Em producao passe o bucket Redis `catalog:anilist`. */
  rateLimiter?: RateLimiter;
  retry?: Partial<RetryOptions>;
}

export function createAniListLimiter(kv?: Parameters<typeof createRateLimiter>[0]["kv"]): RateLimiter {
  return createRateLimiter({
    ...(kv ? { kv } : {}),
    bucket: "catalog:anilist",
    ratePerMin: ANILIST_RATE_PER_MIN,
    burst: 5,
  });
}

export class AniListCharacterFinder implements CharacterFinder {
  private readonly limiter: RateLimiter;

  constructor(private readonly opts: AniListFinderOptions = {}) {
    this.limiter = opts.rateLimiter ?? createAniListLimiter();
  }

  async find(query: string): Promise<CharacterMatch | null> {
    const search = query.trim();
    if (search === "") return null;
    let body: SearchResponse;
    try {
      body = await withRetry(
        async () => {
          await this.limiter.acquire();
          const res = await safeFetchJson<SearchResponse>(ANILIST_URL, {
            allowHosts: [ANILIST_HOST],
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              query: SEARCH_QUERY,
              variables: { search, perPage: SEARCH_PER_PAGE },
            }),
            userAgent: USER_AGENT,
            timeoutMs: 8_000,
            ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
            ...(this.opts.lookupImpl ? { lookupImpl: this.opts.lookupImpl } : {}),
          });
          return res.data;
        },
        { retries: 2, baseMs: 1_500, maxMs: 8_000, jitter: true, ...this.opts.retry }
      );
    } catch (err) {
      // 404 do AniList = sem resultado; o resto e falha de infraestrutura.
      if (err instanceof SafeFetchError && err.status === 404) return null;
      throw new CatalogApiError("falha ao consultar o AniList", err);
    }

    if (body.errors && body.errors.length > 0) {
      if (body.errors.some((e) => e.status === 404)) return null;
      throw new CatalogApiError(
        `AniList GraphQL: ${body.errors.map((e) => e.message ?? "erro").join("; ")}`
      );
    }
    return pickMatch(search, body.data?.Page?.characters);
  }
}
