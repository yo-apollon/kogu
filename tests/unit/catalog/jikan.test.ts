import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  JIKAN_BASE_URL,
  JIKAN_CACHE_TTL_MS,
  type JikanCache,
  JikanSource,
  type JikanSourceOptions,
  MemoryTtlCache,
  isJikanAdultRating,
  mapJikanStatus,
  normalizeJikanImage,
} from "../../../src/catalog/sources/jikan.js";
import type { SourceCursor } from "../../../src/catalog/types.js";
import type { RateLimiter } from "../../../src/lib/http/rateLimiter.js";
import type { LookupFn } from "../../../src/lib/http/safeFetch.js";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/jikan/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURE_DIR}${name}`, "utf8");

const lookupPublic: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const noLimit: RateLimiter = { acquire: async () => {} };

interface Call {
  url: string;
  path: string;
  search: URLSearchParams;
  headers: Record<string, string>;
  at: number;
}

type Handler = (call: Call, n: number) => Response | Promise<Response>;

function reply(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

const fx = (name: string, init?: { status?: number; headers?: Record<string, string> }) =>
  reply(fixture(name), init);

function fakeClock(start = Date.UTC(2026, 9, 22, 12, 0, 0)) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

type Clock = ReturnType<typeof fakeClock>;

function setup(
  handler: Handler,
  extra: Partial<JikanSourceOptions> = {},
  clock: Clock = fakeClock()
) {
  const calls: Call[] = [];
  const source = new JikanSource({
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      const call: Call = {
        url: input,
        path: url.pathname,
        search: url.searchParams,
        headers: init?.headers as Record<string, string>,
        at: clock.now(),
      };
      calls.push(call);
      return handler(call, calls.length);
    },
    lookupImpl: lookupPublic,
    rateLimiter: noLimit,
    now: clock.now,
    sleep: clock.sleep,
    retry: { random: () => 0.5 },
    ...extra,
  });
  return { source, calls, clock };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}

const seasonsHandler: Handler = (call) => {
  if (call.path === "/v4/seasons/now") {
    return fx(call.search.get("page") === "2" ? "seasons-now-p2.json" : "seasons-now-p1.json");
  }
  return fx("error-not-found.json", { status: 404 });
};

const charactersHandler: Handler = (call) => {
  if (call.path === "/v4/anime/5114/characters") return fx("anime-characters-5114.json");
  if (call.path === "/v4/characters/11") return fx("character-11.json");
  if (call.path === "/v4/characters/40001") return fx("character-questionmark.json");
  return fx("error-not-found.json", { status: 404 });
};

/* ------------------------------------------------------------------ */
/* Mapeamentos e cache                                                 */
/* ------------------------------------------------------------------ */

describe("mapeamentos Jikan", () => {
  it.each([
    ["Currently Airing", "RELEASING"],
    ["Not yet aired", "UPCOMING"],
    ["Finished Airing", "FINISHED"],
    [null, "FINISHED"],
    ["Algo Novo", "FINISHED"],
  ] as const)("status %s vira %s", (status, expected) => {
    expect(mapJikanStatus(status)).toBe(expected);
  });

  it.each([
    ["Rx - Hentai", true],
    ["R+ - Mild Nudity", true],
    ["R - 17+ (violence & profanity)", false],
    ["PG-13 - Teens 13 or older", false],
    ["G - All Ages", false],
    [null, false],
  ] as const)("rating %s -> adulto=%s", (rating, expected) => {
    expect(isJikanAdultRating(rating)).toBe(expected);
  });

  it("rejeita imagens placeholder (questionmark, apple-touch-icon), vazias e http", () => {
    const ok = "https://cdn.myanimelist.net/images/characters/9/72533.jpg?s=abc";
    expect(normalizeJikanImage(ok)).toBe(ok);
    expect(
      normalizeJikanImage("https://cdn.myanimelist.net/images/questionmark_23.gif?s=f7dcbc4a")
    ).toBeUndefined();
    expect(
      normalizeJikanImage("https://cdn.myanimelist.net/img/sp/icon/apple-touch-icon-256.png")
    ).toBeUndefined();
    expect(normalizeJikanImage("https://cdn.myanimelist.net/images/qm_50.gif")).toBeUndefined();
    expect(normalizeJikanImage("")).toBeUndefined();
    expect(normalizeJikanImage(null)).toBeUndefined();
    expect(normalizeJikanImage("http://cdn.myanimelist.net/images/a.jpg")).toBeUndefined();
    expect(normalizeJikanImage("nao e url")).toBeUndefined();
  });
});

describe("MemoryTtlCache", () => {
  it("expira apos o TTL e respeita o relogio injetado", () => {
    const clock = fakeClock(0);
    const cache = new MemoryTtlCache({ now: clock.now });
    cache.set("a", { x: 1 }, 1000);
    expect(cache.get("a")).toEqual({ x: 1 });
    clock.advance(999);
    expect(cache.get("a")).toEqual({ x: 1 });
    clock.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("descarta as entradas mais antigas acima do teto", () => {
    const cache = new MemoryTtlCache({ now: () => 0, maxEntries: 2 });
    cache.set("a", 1, 1000);
    cache.set("b", 2, 1000);
    cache.set("c", 3, 1000);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* discover                                                            */
/* ------------------------------------------------------------------ */

describe("JikanSource.discover", () => {
  it("expoe id e ratePerMin do contrato", () => {
    const { source } = setup(seasonsHandler);
    expect(source.id).toBe("JIKAN");
    expect(source.ratePerMin).toBe(50);
  });

  it("converte /seasons/now em RawSeries e deduplica mal_id repetido entre paginas", async () => {
    const { source, calls } = setup(seasonsHandler);
    const series = await collect(source.discover());

    expect(calls.map((c) => c.search.get("page"))).toEqual(["1", "2"]);
    expect(series.map((s) => s.externalId)).toEqual(["52991", "61002", "62345", "63100"]);

    expect(series[0]).toStrictEqual({
      source: "JIKAN",
      externalId: "52991",
      title: "Sousou no Frieren",
      titleEnglish: "Frieren: Beyond Journey's End",
      titleNative: "葬送のフリーレン",
      mediaType: "ANIME",
      status: "RELEASING",
      startDate: new Date("2023-09-29T00:00:00+00:00"),
      popularity: 1_100_000,
      coverUrl: "https://cdn.myanimelist.net/images/anime/1015/138006l.jpg",
      isAdult: false,
      url: "https://myanimelist.net/anime/52991/Sousou_no_Frieren",
    });

    // OVA com rating Rx: adulto; sem titulo em ingles
    expect(series[1]).toMatchObject({ mediaType: "ANIME", isAdult: true, popularity: 880 });
    expect(series[1].titleEnglish).toBeUndefined();

    // ainda nao exibido: sem datas, capa placeholder descartada, popularity cai para favoritos
    expect(series[2]).toMatchObject({ status: "UPCOMING", isAdult: false, popularity: 3 });
    expect(series[2].startDate).toBeUndefined();
    expect(series[2].coverUrl).toBeUndefined();
    expect(series[2].titleNative).toBeUndefined();

    // filme finalizado com rating R+
    expect(series[3]).toMatchObject({
      status: "FINISHED",
      isAdult: true,
      startDate: new Date("2026-10-03T00:00:00.000Z"),
      endDate: new Date("2026-10-03T00:00:00.000Z"),
    });
  });

  it("chama o host do Jikan v4 com User-Agent identificavel", async () => {
    const { source, calls } = setup(seasonsHandler);
    await collect(source.discover({ limit: 1 }));

    expect(calls[0].url).toBe(`${JIKAN_BASE_URL}/seasons/now?page=1&limit=25`);
    expect(new URL(calls[0].url).host).toBe("api.jikan.moe");
    expect(calls[0].headers["user-agent"]).toMatch(/ArqonBot/);
    expect(calls[0].headers.accept).toBe("application/json");
  });

  it("cursor: onCursor devolve a proxima pagina e termina com done", async () => {
    const { source } = setup(seasonsHandler);
    const cursors: SourceCursor[] = [];
    await collect(source.discover({ onCursor: (c) => cursors.push({ ...c }) }));

    expect(cursors).toEqual([
      { page: 2, skip: 0, perPage: 25, done: false },
      { page: 1, skip: 0, perPage: 25, done: true },
    ]);
  });

  it("cursor: retoma da pagina indicada", async () => {
    const { source, calls } = setup(seasonsHandler);
    const series = await collect(
      source.discover({ cursor: { page: 2, skip: 0, perPage: 25, done: false } })
    );
    expect(calls.map((c) => c.search.get("page"))).toEqual(["2"]);
    expect(series.map((s) => s.externalId)).toEqual(["52991", "63100"]); // sem a pagina 1, nada a deduplicar
  });

  it("cursor invalido ou finalizado e ignorado", async () => {
    for (const cursor of [
      { page: 2, skip: 0, perPage: 25, done: true },
      { page: 0, skip: 0, perPage: 25, done: false },
      { page: 2, skip: -1, perPage: 25, done: false },
      { page: 2, skip: 0, perPage: 99, done: false },
      { page: "2", skip: 0, perPage: 25, done: false },
    ]) {
      const { source, calls } = setup(seasonsHandler);
      await collect(source.discover({ limit: 1, cursor }));
      expect(calls[0].search.get("page")).toBe("1");
    }
  });

  it("limit corta no meio da pagina e retoma exatamente do proximo item", async () => {
    const first = setup(seasonsHandler);
    const cursors: SourceCursor[] = [];
    const part1 = await collect(
      first.source.discover({ limit: 2, onCursor: (c) => cursors.push({ ...c }) })
    );
    expect(part1.map((s) => s.externalId)).toEqual(["52991", "61002"]);
    expect(cursors.at(-1)).toEqual({ page: 1, skip: 2, perPage: 25, done: false });

    const second = setup(seasonsHandler);
    const part2 = await collect(second.source.discover({ cursor: cursors.at(-1) }));
    expect(part2.map((s) => s.externalId)).toEqual(["62345", "52991", "63100"]);
  });

  it("respeita maxPages e perPage", async () => {
    const { source, calls } = setup(seasonsHandler);
    await collect(source.discover({ maxPages: 1, perPage: 10 }));
    expect(calls).toHaveLength(1);
    expect(calls[0].search.get("limit")).toBe("10");
  });

  it("AbortSignal ja abortado interrompe antes de qualquer requisicao", async () => {
    const { source, calls } = setup(seasonsHandler);
    const ac = new AbortController();
    ac.abort();
    await expect(collect(source.discover({ signal: ac.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("segunda passada dentro do TTL usa o cache e nao toca a rede", async () => {
    const { source, calls } = setup(seasonsHandler);
    const a = await collect(source.discover());
    const callsAfterFirst = calls.length;
    const b = await collect(source.discover());

    expect(callsAfterFirst).toBe(2);
    expect(calls).toHaveLength(2);
    expect(b).toEqual(a);
  });
});

/* ------------------------------------------------------------------ */
/* fetchCharacters e refresh                                           */
/* ------------------------------------------------------------------ */

describe("JikanSource.fetchCharacters", () => {
  it("mapeia /anime/{id}/characters ordenado por favoritos, com genero UNKNOWN", async () => {
    const { source, calls } = setup(charactersHandler);
    const chars = await source.fetchCharacters("5114");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${JIKAN_BASE_URL}/anime/5114/characters`);
    expect(chars.map((c) => [c.externalId, c.favourites])).toEqual([
      ["11", 172_000],
      ["68", 120_000],
      ["67", 45_000],
      ["40001", 7],
      ["40002", 1],
    ]);

    expect(chars[0]).toStrictEqual({
      source: "JIKAN",
      externalId: "11",
      name: "Elric, Edward",
      gender: "UNKNOWN",
      favourites: 172_000,
      seriesExternalId: "5114",
      role: "MAIN",
      imageUrl: "https://cdn.myanimelist.net/images/characters/9/72533.jpg?s=1f3e0a",
      url: "https://myanimelist.net/character/11/Edward_Elric",
    });
    expect(chars.every((c) => c.gender === "UNKNOWN")).toBe(true);
    expect(chars.every((c) => c.isAdult === undefined)).toBe(true);
    expect(chars.map((c) => c.role)).toEqual([
      "MAIN",
      "SUPPORTING",
      "MAIN",
      "SUPPORTING",
      undefined,
    ]);
  });

  it("descarta imagem placeholder (questionmark e apple-touch-icon)", async () => {
    const { source } = setup(charactersHandler);
    const chars = await source.fetchCharacters("5114");
    const byId = new Map(chars.map((c) => [c.externalId, c]));

    expect(byId.get("40001")!.imageUrl).toBeUndefined();
    expect("imageUrl" in byId.get("40001")!).toBe(false);
    expect(byId.get("40002")!.imageUrl).toBeUndefined();
    expect(byId.get("11")!.imageUrl).toBeDefined();
  });

  it("aplica limit sem nova requisicao (a resposta completa fica em cache)", async () => {
    const { source, calls } = setup(charactersHandler);
    const top2 = await source.fetchCharacters("5114", { limit: 2 });
    const all = await source.fetchCharacters("5114");

    expect(top2.map((c) => c.externalId)).toEqual(["11", "68"]);
    expect(all).toHaveLength(5);
    expect(calls).toHaveLength(1);
  });

  it("anime inexistente (404) devolve lista vazia sem retentar", async () => {
    const { source, calls } = setup(charactersHandler);
    await expect(source.fetchCharacters("999999999")).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("rejeita id nao numerico", async () => {
    const { source, calls } = setup(charactersHandler);
    await expect(source.fetchCharacters("abc")).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe("JikanSource.refresh", () => {
  it("consulta /characters/{id} por id, deduplica, ignora invalidos e 404", async () => {
    const { source, calls } = setup(charactersHandler);
    const chars = await source.refresh(["11", "40001", "999999999", "abc", "11"]);

    expect(calls.map((c) => c.path)).toEqual([
      "/v4/characters/11",
      "/v4/characters/40001",
      "/v4/characters/999999999",
    ]);
    expect(chars).toHaveLength(2);
    expect(chars[0]).toStrictEqual({
      source: "JIKAN",
      externalId: "11",
      name: "Edward Elric",
      nameNative: "エドワード・エルリック",
      aliases: ["Fullmetal Alchemist", "Ed"], // apelido igual ao nome removido
      gender: "UNKNOWN",
      favourites: 175_000,
      seriesExternalId: "", // /characters/{id} nao informa a obra
      imageUrl: "https://cdn.myanimelist.net/images/characters/9/72533.jpg",
      url: "https://myanimelist.net/character/11/Edward_Elric",
    });
    expect(chars[1]).toMatchObject({ externalId: "40001", favourites: 9 });
    expect(chars[1].imageUrl).toBeUndefined(); // questionmark
  });

  it("lista vazia nao faz requisicao", async () => {
    const { source, calls } = setup(charactersHandler);
    await expect(source.refresh([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

describe("cache por URL", () => {
  it("a 2a chamada identica nao faz requisicao; expira apos 6 h", async () => {
    const clock = fakeClock();
    const { source, calls } = setup(charactersHandler, {}, clock);

    await source.fetchCharacters("5114");
    await source.fetchCharacters("5114");
    expect(calls).toHaveLength(1);

    clock.advance(JIKAN_CACHE_TTL_MS - 1);
    await source.fetchCharacters("5114");
    expect(calls).toHaveLength(1);

    clock.advance(2);
    await source.fetchCharacters("5114");
    expect(calls).toHaveLength(2);
  });

  it("refresh tambem usa o cache por personagem", async () => {
    const { source, calls } = setup(charactersHandler);
    await source.refresh(["11"]);
    await source.refresh(["11"]);
    expect(calls).toHaveLength(1);
  });

  it("urls diferentes nao compartilham cache", async () => {
    const { source, calls } = setup(charactersHandler);
    await source.refresh(["11"]);
    await source.refresh(["40001"]);
    expect(calls).toHaveLength(2);
  });

  it("aceita cache injetado e TTL configuravel", async () => {
    const store = new Map<string, unknown>();
    const cache: JikanCache = {
      get: vi.fn((key: string) => store.get(key)),
      set: vi.fn((key: string, value: unknown) => void store.set(key, value)),
    };
    const { source, calls } = setup(charactersHandler, { cache, cacheTtlMs: 1234 });

    await source.fetchCharacters("5114");
    await source.fetchCharacters("5114");

    expect(calls).toHaveLength(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      `${JIKAN_BASE_URL}/anime/5114/characters`,
      expect.anything(),
      1234
    );
  });

  it("respostas com erro nao entram no cache", async () => {
    const { source, calls } = setup((_call, n) =>
      n === 1 ? fx("error-not-found.json", { status: 404 }) : fx("anime-characters-5114.json")
    );
    await expect(source.fetchCharacters("5114")).resolves.toEqual([]);
    await expect(source.fetchCharacters("5114")).resolves.toHaveLength(5);
    expect(calls).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* Rate limit, retry e erros                                           */
/* ------------------------------------------------------------------ */

describe("rate limit", () => {
  it("intervalo minimo de 1 s entre requisicoes de rede (relogio falso)", async () => {
    const { source, calls, clock } = setup(charactersHandler);
    await source.refresh(["11", "40001", "999999999"]);

    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([1000, 1000]);
    expect(calls[1].at - calls[0].at).toBe(1000);
    expect(calls[2].at - calls[1].at).toBe(1000);
  });

  it("limiter padrao: 50 req/min sem burst (~1,2 s entre requisicoes)", async () => {
    const { source, calls, clock } = setup(charactersHandler, { rateLimiter: undefined });
    await source.refresh(["11", "40001", "999999999"]);

    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([1200, 1200]); // 60000 / 50
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);
    }
  });

  it("acertos de cache nao consomem token nem espera", async () => {
    const acquire = vi.fn(async () => {});
    const { source, clock } = setup(charactersHandler, { rateLimiter: { acquire } });
    await source.fetchCharacters("5114");
    await source.fetchCharacters("5114");
    await source.fetchCharacters("5114", { limit: 1 });

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("chamadas concorrentes sao serializadas: uma requisicao por segundo (timers falsos)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const times: number[] = [];
      const source = new JikanSource({
        fetchImpl: async () => {
          times.push(Date.now());
          return fx("character-11.json");
        },
        lookupImpl: lookupPublic,
        rateLimiter: noLimit,
      });
      const all = Promise.all([
        source.refresh(["11"]),
        source.refresh(["12"]),
        source.refresh(["13"]),
      ]);
      await vi.advanceTimersByTimeAsync(3000);
      await all;
      expect(times).toEqual([0, 1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("retry e erros", () => {
  it("429 com Retry-After e retentado respeitando a espera pedida", async () => {
    const { source, calls, clock } = setup((_call, n) =>
      n === 1
        ? fx("error-rate-limited.json", { status: 429, headers: { "retry-after": "3" } })
        : fx("anime-characters-5114.json")
    );
    const chars = await source.fetchCharacters("5114");

    expect(calls).toHaveLength(2);
    expect(chars).toHaveLength(5);
    expect(clock.sleeps).toEqual([3000]);
  });

  it("429 sem Retry-After usa backoff exponencial e falha ao esgotar as retentativas", async () => {
    const { source, calls, clock } = setup(() => fx("error-rate-limited.json", { status: 429 }), {
      retry: { retries: 2, random: () => 0.5 },
    });
    await expect(source.fetchCharacters("5114")).rejects.toMatchObject({
      name: "SafeFetchError",
      status: 429,
    });
    expect(calls).toHaveLength(3);
    // backoff 2000 * 2^n com jitter 0.75: 1500, 3000
    expect(clock.sleeps).toEqual([1500, 3000]);
  });

  it("5xx e retentado", async () => {
    const { source, calls } = setup((_call, n) =>
      n === 1 ? reply("{}", { status: 503 }) : fx("character-11.json")
    );
    await expect(source.refresh(["11"])).resolves.toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("4xx (exceto 404 tratado) nao e retentado e propaga", async () => {
    const { source, calls } = setup(() => reply('{"status":400}', { status: 400 }));
    await expect(source.refresh(["11"])).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it("todas as requisicoes saem para api.jikan.moe (allowlist do safeFetch)", async () => {
    const { source, calls } = setup((call, n) =>
      call.path.startsWith("/v4/seasons") ? seasonsHandler(call, n) : charactersHandler(call, n)
    );
    await source.fetchCharacters("5114");
    await source.refresh(["11"]);
    await collect(source.discover({ limit: 1 }));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => new URL(c.url).host === "api.jikan.moe")).toBe(true);
  });
});
