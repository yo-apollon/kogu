import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SourceDisabledError,
  TMDB_ATTRIBUTION,
  TmdbSource,
  cleanTmdbCharacterName,
  isTmdbAnimation,
  isTmdbBearerToken,
  mapTmdbGender,
  mapTmdbStatus,
  parseTmdbCharacterId,
  parseTmdbSeriesId,
  redactSecrets,
  redactUrl,
  tmdbImageUrl,
  type TmdbOptions,
} from "../../../src/catalog/sources/tmdb.js";
import type { AdapterLogger } from "../../../src/catalog/sources/igdb.js";
import type { FetchLike, RawSeries } from "../../../src/catalog/types.js";
import { SafeFetchError, type LookupFn } from "../../../src/lib/http/safeFetch.js";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const KEY = "0123456789abcdef0123456789abcdef";
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJlMTIz";

const lookupImpl: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function fixture<T = any>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/tmdb/${name}`, import.meta.url), "utf8")
  ) as T;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Call {
  url: string;
  host: string;
  path: string;
  params: URLSearchParams;
  method: string;
  headers: Record<string, string>;
}

type Handler = (call: Call, n: number) => Response | Promise<Response>;

function defaultRoutes(call: Call): Response {
  const page = Number(call.params.get("page") ?? "1");
  switch (call.path) {
    case "/3/trending/movie/week":
      if (page === 1) return json(fixture("trending-movie-week.json"));
      if (page === 2) {
        return json({
          page: 2,
          total_pages: 3,
          results: [
            {
              id: 9100,
              title: "Movie Page Two",
              original_title: "Movie Page Two",
              original_language: "en",
              genre_ids: [35],
              release_date: "2025-01-01",
              popularity: 12,
            },
          ],
        });
      }
      return json({ page, total_pages: 3, results: [] });
    case "/3/trending/tv/week":
      if (page === 1) return json(fixture("trending-tv-week.json"));
      return json({
        page,
        total_pages: 2,
        results: [
          {
            id: 8100,
            name: "Show Page Two",
            original_name: "Show Page Two",
            original_language: "en",
            genre_ids: [18],
            first_air_date: "2025-01-01",
            popularity: 7,
          },
        ],
      });
    case "/3/movie/9001":
      return json(fixture("movie-details-animation.json"));
    case "/3/movie/9002":
      return json(fixture("movie-details-live.json"));
    case "/3/tv/8001":
      return json(fixture("tv-details-animation.json"));
    case "/3/movie/9001/credits":
      return json(fixture("movie-credits-animation.json"));
    case "/3/movie/9002/credits":
      return json(fixture("movie-credits-live.json"));
    case "/3/tv/8001/credits":
      return json(fixture("tv-credits-animation.json"));
    default:
      return json(
        { status_code: 34, status_message: "The resource you requested could not be found." },
        404
      );
  }
}

function harness(handler: Handler = defaultRoutes) {
  const calls: Call[] = [];
  let n = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const u = new URL(input);
    const call: Call = {
      url: input,
      host: u.host,
      path: u.pathname,
      params: u.searchParams,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return handler(call, ++n);
  };
  return { fetchImpl, calls, paths: () => calls.map((c) => c.path) };
}

function makeClock(start = NOW) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

function captureLogger() {
  const entries: Array<{ level: "debug" | "warn"; obj: Record<string, unknown>; msg?: string }> =
    [];
  const logger: AdapterLogger = {
    debug: (obj, msg) => void entries.push({ level: "debug", obj, msg }),
    warn: (obj, msg) => void entries.push({ level: "warn", obj, msg }),
  };
  return { entries, logger };
}

function makeSource(
  h: ReturnType<typeof harness>,
  clock: ReturnType<typeof makeClock>,
  extra: Partial<TmdbOptions> = {}
) {
  return new TmdbSource({
    fetchImpl: h.fetchImpl,
    lookupImpl,
    credentials: { apiKey: KEY },
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    logger: captureLogger().logger,
    ...extra,
  });
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

/* ------------------------------------------------------------------ */

describe("atribuicao", () => {
  it("TMDB_ATTRIBUTION tem o texto exigido", () => {
    expect(TMDB_ATTRIBUTION).toBe(
      "Este produto usa a API do TMDB mas não é endossado ou certificado pelo TMDB."
    );
  });
});

describe("mapeamento puro", () => {
  it("gender do ator: 1 Female, 2 Male, 3 NonBinary, 0/ausente UNKNOWN", () => {
    expect(mapTmdbGender(1)).toBe("FEMALE");
    expect(mapTmdbGender(2)).toBe("MALE");
    expect(mapTmdbGender(3)).toBe("NONBINARY");
    expect(mapTmdbGender(0)).toBe("UNKNOWN");
    expect(mapTmdbGender(undefined)).toBe("UNKNOWN");
    expect(mapTmdbGender(7)).toBe("UNKNOWN");
  });

  it("status: futuro UPCOMING; filme 60 dias e serie 180 dias RELEASING; depois FINISHED", () => {
    const day = 86_400_000;
    expect(mapTmdbStatus("movie", undefined, NOW)).toBe("UPCOMING");
    expect(mapTmdbStatus("movie", new Date(NOW + day), NOW)).toBe("UPCOMING");
    expect(mapTmdbStatus("movie", new Date(NOW - 59 * day), NOW)).toBe("RELEASING");
    expect(mapTmdbStatus("movie", new Date(NOW - 61 * day), NOW)).toBe("FINISHED");
    expect(mapTmdbStatus("tv", new Date(NOW - 179 * day), NOW)).toBe("RELEASING");
    expect(mapTmdbStatus("tv", new Date(NOW - 181 * day), NOW)).toBe("FINISHED");
  });

  it("animacao = genero 16", () => {
    expect(isTmdbAnimation([16, 35])).toBe(true);
    expect(isTmdbAnimation([28])).toBe(false);
    expect(isTmdbAnimation(undefined)).toBe(false);
  });

  it("limpa o nome do personagem", () => {
    expect(cleanTmdbCharacterName("Mio (voice)")).toEqual({ name: "Mio", aliases: [] });
    expect(cleanTmdbCharacterName("Tony Stark / Iron Man")).toEqual({
      name: "Tony Stark",
      aliases: ["Iron Man"],
    });
    expect(cleanTmdbCharacterName("Victor Crane / The Warden (uncredited)")).toEqual({
      name: "Victor Crane",
      aliases: ["The Warden"],
    });
    expect(cleanTmdbCharacterName("AC/DC Fan")).toEqual({ name: "AC/DC Fan", aliases: [] });
    expect(cleanTmdbCharacterName("  Guard   #1  [as Bob] ")).toEqual({
      name: "Guard #1",
      aliases: [],
    });
    expect(cleanTmdbCharacterName("Self")).toBeNull();
    expect(cleanTmdbCharacterName("Himself - Host")).toBeNull();
    expect(cleanTmdbCharacterName("Selfish Giant")).toEqual({ name: "Selfish Giant", aliases: [] });
    expect(cleanTmdbCharacterName("")).toBeNull();
    expect(cleanTmdbCharacterName("(voice)")).toBeNull();
  });

  it("ids externos", () => {
    expect(parseTmdbSeriesId("movie:123")).toEqual({ kind: "movie", id: "123" });
    expect(parseTmdbSeriesId("tv:8001")).toEqual({ kind: "tv", id: "8001" });
    for (const bad of [
      "123",
      "movie:",
      "movie:abc",
      "tv:0",
      "film:1",
      "movie:1/credits",
      "movie:1:2",
      "",
    ]) {
      expect(() => parseTmdbSeriesId(bad)).toThrow(TypeError);
    }
    expect(parseTmdbCharacterId("movie:9002:31001:det-mara-quinn")).toEqual({
      series: { kind: "movie", id: "9002" },
      personId: "31001",
    });
    expect(parseTmdbCharacterId("movie:9002")).toBeNull();
    expect(parseTmdbCharacterId("movie:9002:abc:x")).toBeNull();
  });

  it("URLs de imagem validam o caminho e usam o host image.tmdb.org", () => {
    expect(tmdbImageUrl("/abc123.jpg", "w780")).toBe("https://image.tmdb.org/t/p/w780/abc123.jpg");
    expect(tmdbImageUrl("/abc123.jpg", "h632")).toBe("https://image.tmdb.org/t/p/h632/abc123.jpg");
    for (const bad of [null, undefined, "", "abc.jpg", "/../x", "/..", "/a/b.jpg", "/a b.jpg", 5]) {
      expect(tmdbImageUrl(bad, "w780")).toBeUndefined();
    }
  });

  it("chave v4 (JWT) usa Bearer", () => {
    expect(isTmdbBearerToken(BEARER)).toBe(true);
    expect(isTmdbBearerToken(KEY)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe("discover trending", () => {
  it("parseia filmes e series, alternando as paginas ate esgotar", async () => {
    const h = harness();
    const series = await collect(makeSource(h, makeClock()).discover({ mode: "trending" }));

    expect(series.map((s) => s.externalId)).toEqual([
      "movie:9001",
      "movie:9002",
      "movie:9003",
      "movie:9005", // 9004 (sem titulo) descartado
      "tv:8001",
      "tv:8002",
      "tv:8003",
      "movie:9100",
      "tv:8100",
    ]);
    expect(h.calls.map((c) => `${c.path}?page=${c.params.get("page")}`)).toEqual([
      "/3/trending/movie/week?page=1",
      "/3/trending/tv/week?page=1",
      "/3/trending/movie/week?page=2",
      "/3/trending/tv/week?page=2",
      "/3/trending/movie/week?page=3",
    ]);
    expect(h.calls[0].params.get("language")).toBe("en-US");
  });

  it("mapeia titulo, tipo, animacao, adulto, popularidade, datas, status e imagens", async () => {
    const h = harness();
    const series = await collect(makeSource(h, makeClock()).discover());
    const byId = new Map<string, RawSeries>(series.map((s) => [s.externalId, s]));

    const cloud = byId.get("movie:9001")!;
    expect(cloud).toMatchObject({
      source: "TMDB",
      title: "Cloud Kingdom",
      titleNative: "雲の王国",
      titleEnglish: "Cloud Kingdom",
      mediaType: "MOVIE",
      status: "RELEASING",
      isAnimation: true,
      isAdult: false,
      popularity: 812.4,
      coverUrl: "https://image.tmdb.org/t/p/w780/cloudKingdomPoster.jpg",
      url: "https://www.themoviedb.org/movie/9001",
    });
    expect(cloud.startDate?.toISOString()).toBe("2026-10-10T00:00:00.000Z");

    const iron = byId.get("movie:9002")!;
    expect(iron).toMatchObject({
      status: "UPCOMING",
      isAnimation: false,
      titleEnglish: "Iron Verdict",
    });
    expect(iron.coverUrl).toBeUndefined();
    expect(iron.titleNative).toBeUndefined();

    expect(byId.get("movie:9003")).toMatchObject({
      isAdult: true,
      status: "FINISHED",
      isAnimation: false,
    });

    const untitled = byId.get("movie:9005")!;
    expect(untitled.status).toBe("UPCOMING");
    expect(untitled.startDate).toBeUndefined();
    expect(untitled.coverUrl).toBeUndefined(); // caminho invalido rejeitado

    const moon = byId.get("tv:8001")!;
    expect(moon).toMatchObject({
      mediaType: "TV",
      titleNative: "月夜の探偵",
      status: "RELEASING",
      isAnimation: true,
      popularity: 300.8,
      url: "https://www.themoviedb.org/tv/8001",
    });
    expect(moon.titleEnglish).toBe("Moonlit Detective");
    expect(byId.get("tv:8002")).toMatchObject({ status: "FINISHED", isAnimation: false });
    expect(byId.get("tv:8003")).toMatchObject({ status: "UPCOMING", isAnimation: true });
  });

  it("respeita o limite e para de paginar", async () => {
    const h = harness();
    const series = await collect(makeSource(h, makeClock()).discover({ limit: 3 }));
    expect(series).toHaveLength(3);
    expect(h.paths()).toEqual(["/3/trending/movie/week"]);

    const h2 = harness();
    expect(await collect(makeSource(h2, makeClock()).discover({ limit: 0 }))).toEqual([]);
    expect(h2.calls).toHaveLength(0);
  });

  it("cursor.page define a pagina inicial e modo desconhecido falha", async () => {
    const h = harness();
    await collect(makeSource(h, makeClock()).discover({ limit: 1, cursor: { page: 2 } }));
    expect(h.calls[0].params.get("page")).toBe("2");

    await expect(
      collect(makeSource(harness(), makeClock()).discover({ mode: "popular" as any }))
    ).rejects.toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ */

describe("fetchCharacters", () => {
  it("live-action: pessoa real, foto do ator, nome limpo e ordem de billing", async () => {
    const h = harness();
    const chars = await makeSource(h, makeClock()).fetchCharacters("movie:9002");

    // Sem cache do discover: consulta os generos antes do elenco.
    expect(h.paths()).toEqual(["/3/movie/9002", "/3/movie/9002/credits"]);

    expect(chars.map((c) => c.name)).toEqual([
      "Det. Mara Quinn",
      "Victor Crane",
      "Courier",
      "Guard #1",
      "Bartender",
    ]);
    expect(chars.map((c) => c.externalId)).toEqual([
      "movie:9002:31001:det-mara-quinn",
      "movie:9002:31002:victor-crane",
      "movie:9002:31003:courier",
      "movie:9002:31006:guard-1",
      "movie:9002:31007:bartender",
    ]);
    expect(chars.map((c) => c.gender)).toEqual([
      "FEMALE",
      "MALE",
      "NONBINARY",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(chars.map((c) => c.role)).toEqual(["MAIN", "MAIN", "MAIN", "SUPPORTING", "SUPPORTING"]);
    expect(chars.every((c) => c.isRealPerson === true && c.source === "TMDB")).toBe(true);
    expect(chars.every((c) => c.seriesExternalId === "movie:9002")).toBe(true);

    expect(chars[0]).toMatchObject({
      favourites: 42.7,
      imageUrl: "https://image.tmdb.org/t/p/h632/danaProfile.jpg",
      url: "https://www.themoviedb.org/person/31001",
    });
    expect(chars[1].aliases).toEqual(["The Warden"]);
    expect(chars[2].imageUrl).toBeUndefined(); // sem profile_path
    expect(chars[4].favourites).toBe(0); // sem popularity
  });

  it("animacao: isRealPerson false e SEM imagem (foto do dublador nao e arte do personagem)", async () => {
    const h = harness();
    const chars = await makeSource(h, makeClock()).fetchCharacters("movie:9001");

    expect(chars.map((c) => c.name)).toEqual(["Mio", "King Tamon", "Narrator", "雲のしもべ"]);
    expect(chars.every((c) => c.isRealPerson === false)).toBe(true);
    expect(chars.every((c) => c.imageUrl === undefined)).toBe(true);
    expect(chars.every((c) => c.url === "https://www.themoviedb.org/movie/9001")).toBe(true);
    // Genero e favoritos vem do ator (voz).
    expect(chars.map((c) => c.gender)).toEqual(["FEMALE", "MALE", "UNKNOWN", "NONBINARY"]);
    expect(chars[0].favourites).toBe(20.5);
    expect(chars[3].externalId).toMatch(/^movie:9001:32004:n-[0-9a-f]{8}$/);
  });

  it("series de TV usam /tv/{id}/credits", async () => {
    const h = harness();
    const chars = await makeSource(h, makeClock()).fetchCharacters("tv:8001");
    expect(h.paths()).toEqual(["/3/tv/8001", "/3/tv/8001/credits"]);
    expect(chars.map((c) => c.externalId)).toEqual([
      "tv:8001:33001:detective-tsukishiro",
      "tv:8001:33002:assistant-hina",
    ]);
    expect(chars.every((c) => c.isRealPerson === false && c.imageUrl === undefined)).toBe(true);
  });

  it("usa o cache do discover e nao consulta generos de novo", async () => {
    const h = harness();
    const source = makeSource(h, makeClock());
    await collect(source.discover({ limit: 2 })); // movie:9001 (animacao) e movie:9002
    const before = h.calls.length;

    const animated = await source.fetchCharacters("movie:9001");
    expect(h.calls.slice(before).map((c) => c.path)).toEqual(["/3/movie/9001/credits"]);
    expect(animated.every((c) => c.isRealPerson === false)).toBe(true);

    await source.fetchCharacters("movie:9001");
    expect(h.paths().filter((p) => p === "/3/movie/9001")).toHaveLength(0);
  });

  it("limit restringe o elenco; 0 nao faz requisicao", async () => {
    const h = harness();
    const source = makeSource(h, makeClock());
    expect(await source.fetchCharacters("movie:9002", { limit: 2 })).toHaveLength(2);
    const before = h.calls.length;
    expect(await source.fetchCharacters("movie:9002", { limit: 0 })).toEqual([]);
    expect(h.calls.length).toBe(before);
  });

  it("recusa ids mal formados sem tocar a rede", async () => {
    const h = harness();
    const source = makeSource(h, makeClock());
    for (const bad of [
      "9002",
      "movie:abc",
      "tv:0",
      "movie:1/credits",
      "movie:1?api_key=x",
      "person:1",
    ]) {
      await expect(source.fetchCharacters(bad)).rejects.toBeInstanceOf(TypeError);
    }
    expect(h.calls).toHaveLength(0);
  });
});

describe("refresh", () => {
  it("agrupa por obra, devolve so os ids pedidos e pula obra removida e ids invalidos", async () => {
    const h = harness();
    const cap = captureLogger();
    const out = await makeSource(h, makeClock(), { logger: cap.logger }).refresh([
      "movie:9002:31001:det-mara-quinn",
      "movie:9002:31002:victor-crane",
      "movie:9001:32001:mio",
      "movie:9001:32001:mio",
      "tv:777:5:ghost", // 404
      "bogus",
    ]);

    expect(out.map((c) => c.externalId).sort()).toEqual([
      "movie:9001:32001:mio",
      "movie:9002:31001:det-mara-quinn",
      "movie:9002:31002:victor-crane",
    ]);
    expect(h.paths().filter((p) => p === "/3/movie/9002/credits")).toHaveLength(1);
    expect(cap.entries.some((e) => e.level === "warn" && e.obj.id === "bogus")).toBe(true);
    expect(cap.entries.some((e) => e.level === "warn" && e.obj.series === "tv:777")).toBe(true);
  });

  it("lista vazia nao faz requisicao", async () => {
    const h = harness();
    expect(await makeSource(h, makeClock()).refresh([])).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe("autenticacao e segredos", () => {
  it("chave v3 vai em api_key (query) e nao em header", async () => {
    const h = harness();
    await makeSource(h, makeClock()).fetchCharacters("movie:9001");
    for (const c of h.calls) {
      expect(c.host).toBe("api.themoviedb.org");
      expect(c.params.get("api_key")).toBe(KEY);
      expect(c.headers.authorization).toBeUndefined();
    }
  });

  it("chave v4 (eyJ...) vai em Authorization Bearer e NAO entra na URL", async () => {
    const h = harness();
    await makeSource(h, makeClock(), { credentials: { apiKey: BEARER } }).fetchCharacters(
      "movie:9001"
    );
    expect(h.calls.length).toBeGreaterThan(0);
    for (const c of h.calls) {
      expect(c.url).not.toContain(BEARER);
      expect(c.url).not.toContain("api_key");
      expect(c.headers.authorization).toBe(`Bearer ${BEARER}`);
    }
  });

  it("redactUrl e redactSecrets", () => {
    expect(redactUrl(`https://api.themoviedb.org/3/movie/1?api_key=${KEY}&page=2`)).toBe(
      "https://api.themoviedb.org/3/movie/1?api_key=REDACTED&page=2"
    );
    expect(redactUrl("https://api.themoviedb.org/3/movie/1?page=2")).toBe(
      "https://api.themoviedb.org/3/movie/1?page=2"
    );
    expect(redactUrl("nao e url api_key=abc")).not.toContain("abc");

    const text = `falhou ${KEY} e ${encodeURIComponent("a b/c")} e api_key=zzz e Bearer ${BEARER}`;
    const out = redactSecrets(text, [KEY, "a b/c"]);
    for (const leak of [KEY, "a%20b%2Fc", "zzz", BEARER]) expect(out).not.toContain(leak);
    expect(out).toContain("[REDACTED]");
  });

  it("chave nunca aparece em erro HTTP, log ou serializacao da instancia (v3 e v4)", async () => {
    for (const key of [KEY, BEARER]) {
      const cap = captureLogger();
      const h = harness(() => json({ status_message: `Invalid API key: ${key}` }, 500));
      const source = makeSource(h, makeClock(), {
        credentials: { apiKey: key },
        logger: cap.logger,
        retry: { retries: 1 },
      });
      const err = await source.fetchCharacters("movie:9001").catch((e) => e);

      expect(err).toBeInstanceOf(SafeFetchError);
      expect((err as SafeFetchError).status).toBe(500);
      const dump = JSON.stringify({
        entries: cap.entries,
        message: err.message,
        stack: err.stack,
        cause: String(err.cause),
        source,
      });
      expect(dump).not.toContain(key);
      expect(h.calls.length).toBe(2);
    }
  });

  it("falha de rede que embute a URL (com a chave) e redigida e perde a cause", async () => {
    for (const key of [KEY, BEARER]) {
      const cap = captureLogger();
      const h = harness((call) => {
        throw new Error(
          `connect ECONNREFUSED ${call.url} (Authorization: Bearer ${key}) key=${key}`
        );
      });
      const source = makeSource(h, makeClock(), {
        credentials: { apiKey: key },
        logger: cap.logger,
        retry: { retries: 1 },
      });
      const err = await source.fetchCharacters("movie:9001").catch((e) => e);

      expect(err).toBeInstanceOf(SafeFetchError);
      expect(err.message).toContain("[REDACTED]");
      expect(err.cause).toBeUndefined();
      expect(JSON.stringify({ m: err.message, s: err.stack, l: cap.entries })).not.toContain(key);
    }
  });

  it("logs de requisicao mostram a URL com api_key redigida", async () => {
    const cap = captureLogger();
    await makeSource(harness(), makeClock(), { logger: cap.logger }).fetchCharacters("movie:9001");
    const urls = cap.entries.filter((e) => e.level === "debug").map((e) => String(e.obj.url));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toContain("api_key=REDACTED");
      expect(u).not.toContain(KEY);
    }
  });
});

describe("sem chave", () => {
  it("fica desabilitado: isConfigured false e SourceDisabledError sem tocar a rede", async () => {
    const cases: TmdbOptions["credentials"][] = [null, {}, { apiKey: "" }, { apiKey: "   " }];
    for (const credentials of cases) {
      const h = harness();
      const source = makeSource(h, makeClock(), { credentials });
      expect(source.isConfigured()).toBe(false);
      await expect(collect(source.discover())).rejects.toBeInstanceOf(SourceDisabledError);
      await expect(source.fetchCharacters("movie:1")).rejects.toBeInstanceOf(SourceDisabledError);
      await expect(source.refresh(["movie:1:2:x"])).rejects.toBeInstanceOf(SourceDisabledError);
      expect(h.calls).toHaveLength(0);
    }
  });

  it("chave com formato invalido (espacos/CRLF) desabilita sem repetir o valor", async () => {
    const bad = "abc def\r\nX-Evil: 1";
    const source = makeSource(harness(), makeClock(), { credentials: { apiKey: bad } });
    expect(source.isConfigured()).toBe(false);
    const err = await source.fetchCharacters("movie:1").catch((e) => e);
    expect(err).toBeInstanceOf(SourceDisabledError);
    expect(err.source).toBe("TMDB");
    expect(err.message).toContain("TMDB_API_KEY");
    expect(err.message).not.toContain("abc def");
  });

  it("com chave esta configurado e expoe id e ratePerMin", () => {
    const source = makeSource(harness(), makeClock());
    expect(source.isConfigured()).toBe(true);
    expect(source.id).toBe("TMDB");
    expect(source.ratePerMin).toBe(1200);
  });
});

describe("rate limit e retry", () => {
  it("respeita 1200 req/min (burst 20, depois ~50 ms) com relogio e sleep falsos", async () => {
    const clock = makeClock();
    const h = harness();
    const source = makeSource(h, clock);

    await source.fetchCharacters("movie:9001"); // 2 requisicoes (generos + elenco)
    for (let i = 0; i < 18; i++) await source.fetchCharacters("movie:9001"); // +18 = 20
    expect(h.calls).toHaveLength(20);
    expect(clock.sleeps).toEqual([]);

    for (let i = 0; i < 5; i++) await source.fetchCharacters("movie:9001");
    expect(clock.sleeps).toHaveLength(5);
    for (const ms of clock.sleeps) {
      expect(ms).toBeGreaterThanOrEqual(45);
      expect(ms).toBeLessThanOrEqual(51);
    }
  });

  it("usa o rateLimiter injetado", async () => {
    let acquired = 0;
    const h = harness();
    const source = makeSource(h, makeClock(), {
      rateLimiter: { acquire: async () => void acquired++ },
    });
    await source.fetchCharacters("movie:9001");
    expect(acquired).toBe(h.calls.length);
  });

  it("429 com Retry-After e retentado respeitando a espera", async () => {
    const clock = makeClock();
    const cap = captureLogger();
    const h = harness((call, n) =>
      call.path.endsWith("/credits") && n === 2
        ? json({ status_code: 25 }, 429, { "retry-after": "3" })
        : defaultRoutes(call)
    );
    const chars = await makeSource(h, clock, { logger: cap.logger }).fetchCharacters("movie:9001");

    expect(chars).toHaveLength(4);
    expect(clock.sleeps).toContain(3000);
    expect(h.paths()).toEqual(["/3/movie/9001", "/3/movie/9001/credits", "/3/movie/9001/credits"]);
    const retry = cap.entries.find((e) => e.msg === "tmdb retry");
    expect(retry?.obj).toMatchObject({ status: 429, attempt: 1, delayMs: 3000 });
    expect(JSON.stringify(cap.entries)).not.toContain(KEY);
  });

  it("429 sem Retry-After usa backoff exponencial", async () => {
    const clock = makeClock();
    let failures = 2;
    const h = harness((call) => (failures-- > 0 ? json({}, 429) : defaultRoutes(call)));
    await makeSource(h, clock).fetchCharacters("movie:9001");
    expect(clock.sleeps).toEqual([750, 1500]);
  });

  it("404 nao e retentado", async () => {
    const clock = makeClock();
    const h = harness();
    const err = await makeSource(h, clock)
      .fetchCharacters("movie:1")
      .catch((e) => e);
    expect((err as SafeFetchError).status).toBe(404);
    expect(h.calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("so contata api.themoviedb.org", async () => {
    const h = harness();
    const source = makeSource(h, makeClock());
    await collect(source.discover({ limit: 2 }));
    await source.fetchCharacters("movie:9002");
    expect(new Set(h.calls.map((c) => c.host))).toEqual(new Set(["api.themoviedb.org"]));
  });
});
