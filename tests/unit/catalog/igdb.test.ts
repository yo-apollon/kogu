import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IGDB_TOKEN_KV_KEY,
  IgdbAuthError,
  IgdbSource,
  SourceDisabledError,
  igdbImageUrl,
  igdbPopularity,
  igdbTokenTtlMs,
  isAdultGame,
  mapIgdbGender,
  mapIgdbStatus,
  type AdapterLogger,
  type IgdbKv,
  type IgdbOptions,
} from "../../../src/catalog/sources/igdb.js";
import type { FetchLike, RawSeries } from "../../../src/catalog/types.js";
import { SafeFetchError, type LookupFn } from "../../../src/lib/http/safeFetch.js";

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const NOW_SEC = NOW / 1000;
const DAY_SEC = 86_400;
const TOKEN_TTL_MS = 5_184_000 * 1000 - 3_600_000;
const SECRET = "very-secret-client-secret";
const CREDS = { clientId: "client-id-123", clientSecret: SECRET };

const lookupImpl: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function fixture<T = any>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/igdb/${name}`, import.meta.url), "utf8")
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
  method: string;
  headers: Record<string, string>;
  body: string;
}

type Handler = (call: Call, n: number) => Response | Promise<Response>;

function defaultTwitch(_call: Call, n: number): Response {
  return json(
    n === 1
      ? fixture("twitch-token.json")
      : { access_token: `fixture-twitch-access-token-${n}`, expires_in: 5_184_000 }
  );
}

function harness(handlers: { igdb?: Handler; twitch?: Handler } = {}) {
  const calls: Call[] = [];
  const counts = { igdb: 0, twitch: 0 };
  const fetchImpl: FetchLike = async (input, init) => {
    const u = new URL(input);
    const call: Call = {
      url: input,
      host: u.host,
      path: u.pathname,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    if (u.host === "id.twitch.tv") return (handlers.twitch ?? defaultTwitch)(call, ++counts.twitch);
    if (u.host === "api.igdb.com") return (handlers.igdb ?? (() => json([])))(call, ++counts.igdb);
    throw new Error(`host inesperado: ${u.host}`);
  };
  return {
    fetchImpl,
    calls,
    counts,
    igdbCalls: () => calls.filter((c) => c.host === "api.igdb.com"),
    twitchCalls: () => calls.filter((c) => c.host === "id.twitch.tv"),
  };
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
    advance: (ms: number) => {
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

function fakeKv(now: () => number) {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const sets: Array<{ key: string; px?: number }> = [];
  const kv: IgdbKv = {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt !== null && e.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, o) {
      sets.push({ key, px: o?.px });
      store.set(key, { value, expiresAt: o?.px ? now() + o.px : null });
      return true;
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
  };
  return { kv, store, sets };
}

function makeSource(
  h: ReturnType<typeof harness>,
  clock: ReturnType<typeof makeClock>,
  extra: Partial<IgdbOptions> = {}
) {
  return new IgdbSource({
    fetchImpl: h.fetchImpl,
    lookupImpl,
    credentials: CREDS,
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

describe("mapeamento puro", () => {
  it("gender: 0 Male, 1 Female, 2 Other -> NONBINARY, ausente -> UNKNOWN", () => {
    expect(mapIgdbGender(0)).toBe("MALE");
    expect(mapIgdbGender(1)).toBe("FEMALE");
    expect(mapIgdbGender(2)).toBe("NONBINARY");
    expect(mapIgdbGender(undefined)).toBe("UNKNOWN");
    expect(mapIgdbGender(null)).toBe("UNKNOWN");
    expect(mapIgdbGender(9)).toBe("UNKNOWN");
    expect(mapIgdbGender("1")).toBe("UNKNOWN");
  });

  it("status conforme a data de lancamento", () => {
    expect(mapIgdbStatus(undefined, NOW)).toBe("UPCOMING");
    expect(mapIgdbStatus(NOW_SEC + 3 * DAY_SEC, NOW)).toBe("UPCOMING");
    expect(mapIgdbStatus(NOW_SEC - 29 * DAY_SEC, NOW)).toBe("RELEASING");
    expect(mapIgdbStatus(NOW_SEC - 31 * DAY_SEC, NOW)).toBe("FINISHED");
    expect(mapIgdbStatus(NOW_SEC - 2000 * DAY_SEC, NOW)).toBe("FINISHED");
  });

  it("isAdult: tema 42 ou ESRB AO; PEGI 18 nao conta", () => {
    expect(isAdultGame({ themes: [1, 42] })).toBe(true);
    expect(isAdultGame({ themes: [{ id: 42 }] })).toBe(true);
    expect(isAdultGame({ age_ratings: [{ category: 1, rating: 12 }] })).toBe(true);
    expect(
      isAdultGame({
        age_ratings: [{ organization: { name: "ESRB" }, rating_category: { rating: "AO" } }],
      })
    ).toBe(true);
    expect(isAdultGame({ age_ratings: [{ category: 2, rating: 5 }] })).toBe(false);
    expect(isAdultGame({ age_ratings: [{ category: 1, rating: 11 }] })).toBe(false);
    expect(isAdultGame({ themes: [1, 31] })).toBe(false);
    expect(isAdultGame({})).toBe(false);
  });

  it("popularidade e o maior entre follows, hypes e total_rating_count", () => {
    expect(igdbPopularity({ follows: 10, hypes: 30, total_rating_count: 20 })).toBe(30);
    expect(igdbPopularity({})).toBe(0);
    expect(igdbPopularity({ follows: -5, hypes: Number.NaN })).toBe(0);
  });

  it("URLs de imagem validam o image_id", () => {
    expect(igdbImageUrl("co1abc", "t_cover_big")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg"
    );
    expect(igdbImageUrl("mug001", "t_720p")).toBe(
      "https://images.igdb.com/igdb/image/upload/t_720p/mug001.jpg"
    );
    expect(igdbImageUrl("../evil", "t_720p")).toBeUndefined();
    expect(igdbImageUrl("a/b", "t_720p")).toBeUndefined();
    expect(igdbImageUrl(undefined, "t_720p")).toBeUndefined();
    expect(igdbImageUrl(42, "t_720p")).toBeUndefined();
  });

  it("TTL do token: expires_in - 1h; tokens curtos usam metade da vida", () => {
    expect(igdbTokenTtlMs(5_184_000)).toBe(TOKEN_TTL_MS);
    expect(igdbTokenTtlMs(7200)).toBe(3_600_000);
    expect(igdbTokenTtlMs(1800)).toBe(900_000);
    expect(igdbTokenTtlMs(1)).toBe(1000);
  });
});

/* ------------------------------------------------------------------ */

describe("discover releases", () => {
  it("parseia a fixture e monta a consulta Apicalypse da janela -30d/+7d", async () => {
    const h = harness({ igdb: () => json(fixture("games-releases.json")) });
    const source = makeSource(h, makeClock());
    const series = await collect(source.discover({ mode: "releases" }));

    // 1005 (sem nome) e descartado.
    expect(series.map((s) => s.externalId)).toEqual(["1001", "1002", "1003", "1004"]);

    const byId = new Map<string, RawSeries>(series.map((s) => [s.externalId, s]));
    const starfall = byId.get("1001")!;
    expect(starfall).toMatchObject({
      source: "IGDB",
      title: "Starfall Chronicles",
      mediaType: "GAME",
      status: "RELEASING",
      popularity: 900,
      isAdult: false,
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg",
      url: "https://www.igdb.com/games/starfall-chronicles",
    });
    expect(starfall.startDate?.toISOString()).toBe("2026-10-17T12:00:00.000Z");

    expect(byId.get("1002")).toMatchObject({ status: "UPCOMING", isAdult: true, popularity: 300 });
    expect(byId.get("1003")).toMatchObject({ status: "RELEASING", isAdult: true, popularity: 220 });
    // Sem cover: sem coverUrl; sem url: monta a partir do slug.
    expect(byId.get("1004")?.coverUrl).toBeUndefined();
    expect(byId.get("1004")?.url).toBe("https://www.igdb.com/games/quiet-harbor");

    const [req] = h.igdbCalls();
    expect(req.url).toBe("https://api.igdb.com/v4/games");
    expect(req.method).toBe("POST");
    expect(req.headers["client-id"]).toBe(CREDS.clientId);
    expect(req.headers.authorization).toBe("Bearer fixture-twitch-access-token-1");
    expect(req.body).toContain(`first_release_date >= ${NOW_SEC - 30 * DAY_SEC}`);
    expect(req.body).toContain(`first_release_date <= ${NOW_SEC + 7 * DAY_SEC}`);
    expect(req.body).toContain("(hypes >= 10 | follows >= 50)");
    expect(req.body).toContain("limit 500;");
    expect(req.body).toContain("offset 0;");
  });

  it("limiar de hype/follows e configuravel", async () => {
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock(), { minHypes: 25, minFollows: 200 });
    await collect(source.discover({ mode: "releases", limit: 10 }));
    expect(h.igdbCalls()[0].body).toContain("(hypes >= 25 | follows >= 200)");
    expect(h.igdbCalls()[0].body).toContain("limit 10;");
  });
});

describe("discover popular", () => {
  it("parseia a fixture e ordena por total_rating_count", async () => {
    const h = harness({ igdb: () => json(fixture("games-popular.json")) });
    const source = makeSource(h, makeClock());
    const series = await collect(source.discover({ mode: "popular" }));

    expect(series).toHaveLength(3);
    expect(series[0]).toMatchObject({
      externalId: "2001",
      title: "Eternal Odyssey",
      status: "FINISHED",
      popularity: 15400,
      isAdult: false,
    });
    expect(series[1]).toMatchObject({ externalId: "2002", status: "FINISHED", popularity: 4200 });
    // Sem data de lancamento: UPCOMING e sem startDate.
    expect(series[2]).toMatchObject({ externalId: "2003", status: "UPCOMING", popularity: 5000 });
    expect(series[2].startDate).toBeUndefined();

    const body = h.igdbCalls()[0].body;
    expect(body).toContain("sort total_rating_count desc;");
    expect(body).toContain("limit 200;");
    expect(body).toContain("version_parent = null");
  });

  it("e o modo padrao", async () => {
    const h = harness({ igdb: () => json([]) });
    await collect(makeSource(h, makeClock()).discover());
    expect(h.igdbCalls()[0].body).toContain("sort total_rating_count desc;");
  });

  it("pagina em blocos de 500 e respeita o limite total", async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: from + i,
        name: `Game ${from + i}`,
        total_rating_count: 1000 - i,
      }));
    const h = harness({
      igdb: (_c, n) => json(n === 1 ? page(1, 500) : page(501, 100)),
    });
    const series = await collect(
      makeSource(h, makeClock()).discover({ mode: "popular", limit: 600 })
    );

    expect(series).toHaveLength(600);
    const bodies = h.igdbCalls().map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("limit 500;\noffset 0;");
    expect(bodies[1]).toContain("limit 100;\noffset 500;");
  });

  it("para quando a pagina vem menor que o pedido e descarta duplicados", async () => {
    const h = harness({
      igdb: () =>
        json([
          { id: 1, name: "A", total_rating_count: 5 },
          { id: 1, name: "A again", total_rating_count: 5 },
          { id: 2, name: "B", total_rating_count: 4 },
        ]),
    });
    const series = await collect(makeSource(h, makeClock()).discover({ limit: 1000 }));
    expect(series.map((s) => s.externalId)).toEqual(["1", "2"]);
    expect(h.igdbCalls()).toHaveLength(1);
  });

  it("cursor.offset define o inicio e limit 0 nao faz requisicoes", async () => {
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock());
    await collect(source.discover({ limit: 5, cursor: { offset: 40 } }));
    expect(h.igdbCalls()[0].body).toContain("offset 40;");

    const h2 = harness();
    await collect(makeSource(h2, makeClock()).discover({ limit: 0 }));
    expect(h2.calls).toHaveLength(0);
  });

  it("respeita AbortSignal ja cancelado", async () => {
    const h = harness();
    const ac = new AbortController();
    ac.abort();
    await expect(
      collect(makeSource(h, makeClock()).discover({ signal: ac.signal }))
    ).rejects.toThrow();
    expect(h.igdbCalls()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe("fetchCharacters", () => {
  it("parseia a fixture: gender, imagem t_720p, aliases e quarentena sem mug_shot", async () => {
    const h = harness({ igdb: () => json(fixture("characters.json")) });
    const source = makeSource(h, makeClock());
    const chars = await source.fetchCharacters("1001");

    expect(chars.map((c) => [c.externalId, c.gender])).toEqual([
      ["5001", "FEMALE"],
      ["5002", "MALE"],
      ["5003", "NONBINARY"],
      ["5004", "UNKNOWN"],
    ]);
    expect(chars[0]).toMatchObject({
      source: "IGDB",
      name: "Aria Valen",
      seriesExternalId: "1001",
      imageUrl: "https://images.igdb.com/igdb/image/upload/t_720p/mug001.jpg",
      aliases: ["Captain Valen", "The Falcon"],
      description: "A starship pilot with a mysterious past.",
      url: "https://www.igdb.com/characters/aria-valen",
    });
    // Sem mug_shot: imageUrl indefinido; descricao em branco vira indefinida; sem url, usa o slug.
    expect(chars[3].imageUrl).toBeUndefined();
    expect(chars[3].description).toBeUndefined();
    expect(chars[3].url).toBe("https://www.igdb.com/characters/the-wanderer");

    const req = h.igdbCalls()[0];
    expect(req.url).toBe("https://api.igdb.com/v4/characters");
    expect(req.body).toContain("where games = (1001);");
    expect(req.body).toContain("limit 25;");
  });

  it("favourites usa a popularidade da serie vista em discover, ou 0", async () => {
    const h = harness({
      igdb: (call) =>
        call.path.endsWith("/games")
          ? json(fixture("games-releases.json"))
          : json(fixture("characters.json")),
    });
    const source = makeSource(h, makeClock());

    expect((await source.fetchCharacters("1001")).every((c) => c.favourites === 0)).toBe(true);
    await collect(source.discover({ mode: "releases" }));
    expect((await source.fetchCharacters("1001")).every((c) => c.favourites === 900)).toBe(true);
  });

  it("limit e limitado a 500; 0 nao faz requisicao", async () => {
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock());
    await source.fetchCharacters("1001", { limit: 9999 });
    expect(h.igdbCalls()[0].body).toContain("limit 500;");
    expect(await source.fetchCharacters("1001", { limit: 0 })).toEqual([]);
    expect(h.igdbCalls()).toHaveLength(1);
  });

  it("recusa IDs que nao sao inteiros (sem injecao Apicalypse)", async () => {
    const h = harness();
    const source = makeSource(h, makeClock());
    for (const bad of ["abc", "12; fields *", "-5", "0", "1.5", ""]) {
      await expect(source.fetchCharacters(bad)).rejects.toBeInstanceOf(TypeError);
    }
    expect(h.calls).toHaveLength(0);
  });
});

describe("refresh", () => {
  it("consulta /characters por ids e usa games[0] como serie", async () => {
    const h = harness({ igdb: () => json(fixture("characters.json")) });
    const out = await makeSource(h, makeClock()).refresh(["5001", "5002", "5001"]);

    expect(h.igdbCalls()[0].body).toContain("where id = (5001,5002);");
    expect(h.igdbCalls()[0].url).toBe("https://api.igdb.com/v4/characters");
    expect(out).toHaveLength(4);
    expect(out[2]).toMatchObject({ externalId: "5003", seriesExternalId: "1001" });
  });

  it("divide em blocos de 500, ignora ids invalidos e avisa", async () => {
    const h = harness({ igdb: () => json([]) });
    const cap = captureLogger();
    const source = makeSource(h, makeClock(), { logger: cap.logger });
    const ids = Array.from({ length: 1200 }, (_, i) => String(i + 1));
    await source.refresh([...ids, "oops"]);

    expect(h.igdbCalls().map((c) => /limit (\d+);/.exec(c.body)?.[1])).toEqual([
      "500",
      "500",
      "200",
    ]);
    expect(cap.entries.some((e) => e.level === "warn" && e.obj.id === "oops")).toBe(true);
  });

  it("lista vazia nao faz requisicao", async () => {
    const h = harness();
    expect(await makeSource(h, makeClock()).refresh([])).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe("token Twitch", () => {
  it("pede uma vez, envia credenciais no corpo (nao na URL) e reaproveita", async () => {
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock());
    await source.fetchCharacters("1");
    await source.fetchCharacters("2");
    await collect(source.discover({ limit: 1 }));

    expect(h.counts.twitch).toBe(1);
    const [t] = h.twitchCalls();
    expect(t.url).toBe("https://id.twitch.tv/oauth2/token");
    expect(t.method).toBe("POST");
    expect(t.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(t.body);
    expect(form.get("client_id")).toBe(CREDS.clientId);
    expect(form.get("client_secret")).toBe(SECRET);
    expect(form.get("grant_type")).toBe("client_credentials");
  });

  it("guarda no KV com TTL expires_in - 1h e outra instancia reaproveita sem pedir", async () => {
    const clock = makeClock();
    const { kv, store, sets } = fakeKv(clock.now);
    const h = harness({ igdb: () => json([]) });

    await makeSource(h, clock, { kv }).fetchCharacters("1");
    expect(sets).toEqual([{ key: IGDB_TOKEN_KV_KEY, px: TOKEN_TTL_MS }]);
    expect(JSON.parse(store.get(IGDB_TOKEN_KV_KEY)!.value)).toEqual({
      accessToken: "fixture-twitch-access-token-1",
      refreshAt: NOW + TOKEN_TTL_MS,
    });

    const other = makeSource(h, clock, { kv });
    await other.fetchCharacters("2");
    expect(h.counts.twitch).toBe(1);
    expect(h.igdbCalls()[1].headers.authorization).toBe("Bearer fixture-twitch-access-token-1");
  });

  it("nao pede de novo antes de expirar e renova depois (com e sem KV)", async () => {
    for (const withKv of [false, true]) {
      const clock = makeClock();
      const h = harness({ igdb: () => json([]) });
      const source = makeSource(h, clock, withKv ? { kv: fakeKv(clock.now).kv } : {});

      await source.fetchCharacters("1");
      clock.advance(TOKEN_TTL_MS - 1000);
      await source.fetchCharacters("1");
      expect(h.counts.twitch).toBe(1);

      clock.advance(1001);
      await source.fetchCharacters("1");
      expect(h.counts.twitch).toBe(2);
      expect(h.igdbCalls().map((c) => c.headers.authorization)).toEqual([
        "Bearer fixture-twitch-access-token-1",
        "Bearer fixture-twitch-access-token-1",
        "Bearer fixture-twitch-access-token-2",
      ]);
    }
  });

  it("chamadas concorrentes compartilham um unico pedido de token", async () => {
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock());
    await Promise.all(Array.from({ length: 6 }, (_, i) => source.fetchCharacters(String(i + 1))));
    expect(h.counts.twitch).toBe(1);
  });

  it("401 do IGDB invalida o token e repete uma vez com token novo", async () => {
    const clock = makeClock();
    const { kv, store } = fakeKv(clock.now);
    const h = harness({
      igdb: (_c, n) =>
        n === 1
          ? json({ message: "Authorization Failure" }, 401)
          : json(fixture("characters.json")),
    });
    const chars = await makeSource(h, clock, { kv }).fetchCharacters("1001");

    expect(chars).toHaveLength(4);
    expect(h.counts.twitch).toBe(2);
    expect(h.igdbCalls().map((c) => c.headers.authorization)).toEqual([
      "Bearer fixture-twitch-access-token-1",
      "Bearer fixture-twitch-access-token-2",
    ]);
    expect(JSON.parse(store.get(IGDB_TOKEN_KV_KEY)!.value).accessToken).toBe(
      "fixture-twitch-access-token-2"
    );
  });

  it("401 persistente nao entra em loop", async () => {
    const h = harness({ igdb: () => json({}, 401) });
    const err = await makeSource(h, makeClock())
      .fetchCharacters("1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(SafeFetchError);
    expect((err as SafeFetchError).status).toBe(401);
    expect(h.counts.twitch).toBe(2);
    expect(h.counts.igdb).toBe(2);
  });

  it("falha do Twitch vira IgdbAuthError sem expor o segredo", async () => {
    const h = harness({
      twitch: () => json({ status: 403, message: "invalid client secret" }, 403),
    });
    const err = await makeSource(h, makeClock())
      .fetchCharacters("1")
      .catch((e) => e);
    expect(err).toBeInstanceOf(IgdbAuthError);
    expect((err as Error).message).toContain("HTTP 403");
    expect((err as Error).message).not.toContain(SECRET);
    expect(h.igdbCalls()).toHaveLength(0);
  });

  it("resposta de token sem access_token e rejeitada", async () => {
    const h = harness({ twitch: () => json({ expires_in: 100 }) });
    await expect(makeSource(h, makeClock()).fetchCharacters("1")).rejects.toBeInstanceOf(
      IgdbAuthError
    );
  });

  it("repete o pedido de token em 503 com backoff", async () => {
    const clock = makeClock();
    const h = harness({
      igdb: () => json([]),
      twitch: (c, n) => (n === 1 ? json({}, 503) : defaultTwitch(c, 1)),
    });
    await makeSource(h, clock).fetchCharacters("1");
    expect(h.counts.twitch).toBe(2);
    expect(clock.sleeps).toContain(750);
  });

  it("falha do KV nao derruba o adapter", async () => {
    const cap = captureLogger();
    const broken: IgdbKv = {
      get: async () => {
        throw new Error("redis down");
      },
      set: async () => {
        throw new Error("redis down");
      },
      del: async () => 0,
    };
    const h = harness({ igdb: () => json([]) });
    await makeSource(h, makeClock(), { kv: broken, logger: cap.logger }).fetchCharacters("1");
    expect(h.counts.twitch).toBe(1);
    expect(cap.entries.filter((e) => e.level === "warn")).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */

describe("sem credenciais", () => {
  it("fica desabilitado: isConfigured false e SourceDisabledError sem tocar a rede", async () => {
    const cases: IgdbOptions["credentials"][] = [
      null,
      {},
      { clientId: "x" },
      { clientSecret: "y" },
      { clientId: "  ", clientSecret: "y" },
    ];
    for (const credentials of cases) {
      const h = harness();
      const source = makeSource(h, makeClock(), { credentials });
      expect(source.isConfigured()).toBe(false);
      await expect(collect(source.discover())).rejects.toBeInstanceOf(SourceDisabledError);
      await expect(source.fetchCharacters("1")).rejects.toBeInstanceOf(SourceDisabledError);
      await expect(source.refresh(["1"])).rejects.toBeInstanceOf(SourceDisabledError);
      expect(h.calls).toHaveLength(0);
    }
  });

  it("a mensagem do erro e clara", async () => {
    const source = makeSource(harness(), makeClock(), { credentials: null });
    const err = await source.fetchCharacters("1").catch((e) => e);
    expect(err.name).toBe("SourceDisabledError");
    expect(err.source).toBe("IGDB");
    expect(err.message).toContain("TWITCH_CLIENT_ID");
    expect(err.message).toContain("TWITCH_CLIENT_SECRET");
  });

  it("com credenciais completas esta configurado e expoe id e ratePerMin", () => {
    const source = makeSource(harness(), makeClock());
    expect(source.isConfigured()).toBe(true);
    expect(source.id).toBe("IGDB");
    expect(source.ratePerMin).toBe(170);
  });
});

/* ------------------------------------------------------------------ */

describe("rate limit, concorrencia e retry", () => {
  it("429 com Retry-After e retentado respeitando a espera", async () => {
    const clock = makeClock();
    const cap = captureLogger();
    const h = harness({
      igdb: (_c, n) =>
        n === 1 ? json({}, 429, { "retry-after": "2" }) : json(fixture("characters.json")),
    });
    const chars = await makeSource(h, clock, { logger: cap.logger }).fetchCharacters("1001");

    expect(chars).toHaveLength(4);
    expect(h.counts.igdb).toBe(2);
    expect(clock.sleeps).toContain(2000);
    expect(cap.entries.some((e) => e.msg === "igdb retry" && e.obj.status === 429)).toBe(true);
  });

  it("5xx persistente esgota as tentativas", async () => {
    const clock = makeClock();
    const h = harness({ igdb: () => json({}, 503) });
    const err = await makeSource(h, clock, { retry: { retries: 2 } })
      .fetchCharacters("1")
      .catch((e) => e);
    expect((err as SafeFetchError).status).toBe(503);
    expect(h.counts.igdb).toBe(3);
    expect(clock.sleeps.filter((ms) => ms === 750 || ms === 1500)).toEqual([750, 1500]);
  });

  it("4xx comum (400) nao e retentado", async () => {
    const h = harness({ igdb: () => json({ message: "bad query" }, 400) });
    await expect(makeSource(h, makeClock()).fetchCharacters("1")).rejects.toBeInstanceOf(
      SafeFetchError
    );
    expect(h.counts.igdb).toBe(1);
  });

  it("respeita ~170 req/min com relogio e sleep falsos: burst de 4, depois ~353 ms", async () => {
    const clock = makeClock();
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, clock);

    for (let i = 0; i < 4; i++) await source.fetchCharacters("1");
    expect(clock.sleeps).toEqual([]);

    for (let i = 0; i < 6; i++) await source.fetchCharacters("1");
    expect(clock.sleeps).toHaveLength(6);
    for (const ms of clock.sleeps) {
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThanOrEqual(360);
    }
    // 10 requisicoes em 6 esperas de ~353 ms: nunca mais que 170/min.
    expect(clock.now() - NOW).toBeGreaterThanOrEqual(2000);
  });

  it("usa o rateLimiter injetado", async () => {
    const acquired: number[] = [];
    const h = harness({ igdb: () => json([]) });
    const source = makeSource(h, makeClock(), {
      rateLimiter: { acquire: async () => void acquired.push(1) },
    });
    await source.fetchCharacters("1");
    await source.fetchCharacters("2");
    expect(acquired).toHaveLength(2);
  });

  it("no maximo 4 requisicoes em voo", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const h = harness({
      igdb: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return json([]);
      },
    });
    const source = makeSource(h, makeClock());
    await Promise.all(Array.from({ length: 10 }, (_, i) => source.fetchCharacters(String(i + 1))));
    expect(h.counts.igdb).toBe(10);
    expect(maxInFlight).toBe(4);
  });

  it("host fora da allowlist nunca e contatado (so api.igdb.com e id.twitch.tv)", async () => {
    const h = harness({ igdb: () => json([]) });
    await makeSource(h, makeClock()).fetchCharacters("1");
    expect(new Set(h.calls.map((c) => c.host))).toEqual(new Set(["api.igdb.com", "id.twitch.tv"]));
  });
});

describe("segredos", () => {
  it("segredo e token nunca aparecem em logs, erros ou na serializacao da instancia", async () => {
    const cap = captureLogger();
    const h = harness({ igdb: () => json({ message: "boom" }, 500) });
    const source = makeSource(h, makeClock(), { logger: cap.logger, retry: { retries: 1 } });
    const err = await source.fetchCharacters("1").catch((e) => e);

    const dump = JSON.stringify({
      entries: cap.entries,
      message: String(err.message),
      stack: String(err.stack),
      source,
    });
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("fixture-twitch-access-token");
    expect(h.counts.igdb).toBe(2);
  });
});
