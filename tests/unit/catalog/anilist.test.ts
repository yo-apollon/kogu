import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANILIST_URL,
  AniListError,
  AniListSource,
  type AniListSourceOptions,
  mapAniListFormat,
  mapAniListGender,
  mapAniListStatus,
  normalizeAniListImage,
} from "../../../src/catalog/sources/anilist.js";
import type { SourceCursor } from "../../../src/catalog/types.js";
import type { RateLimiter } from "../../../src/lib/http/rateLimiter.js";
import { createRateLimiter } from "../../../src/lib/http/rateLimiter.js";
import type { LookupFn } from "../../../src/lib/http/safeFetch.js";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const FIXTURE_DIR = fileURLToPath(new URL("../../fixtures/anilist/", import.meta.url));
const fixture = (name: string): string => readFileSync(`${FIXTURE_DIR}${name}`, "utf8");

const lookupPublic: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const noLimit: RateLimiter = { acquire: async () => {} };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  query: string;
  variables: Record<string, any>;
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
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

type Clock = ReturnType<typeof fakeClock>;

function setup(
  handler: Handler,
  extra: Partial<AniListSourceOptions> = {},
  clock: Clock = fakeClock()
) {
  const calls: Call[] = [];
  const source = new AniListSource({
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const call: Call = {
        url: input,
        method: String(init?.method),
        headers: init?.headers as Record<string, string>,
        query: body.query,
        variables: body.variables ?? {},
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

/** Roteia as consultas de discover: ANIME RELEASING tem 2 paginas, MANGA RELEASING 1, o resto vazio. */
const discoverHandler: Handler = (call) => {
  const { type, page, statusIn } = call.variables;
  if (statusIn?.[0] === "RELEASING" && type === "ANIME") {
    return fx(page === 1 ? "discover-anime-p1.json" : "discover-anime-p2.json");
  }
  if (statusIn?.[0] === "RELEASING" && type === "MANGA") return fx("discover-manga-p1.json");
  return fx("empty-page.json");
};

/* ------------------------------------------------------------------ */
/* Mapeamentos                                                         */
/* ------------------------------------------------------------------ */

describe("mapeamentos AniList", () => {
  it.each([
    ["TV", "ANIME"],
    ["TV_SHORT", "ANIME"],
    ["MOVIE", "ANIME"],
    ["OVA", "ANIME"],
    ["ONA", "ANIME"],
    ["SPECIAL", "ANIME"],
    ["MUSIC", "ANIME"],
    ["MANGA", "MANGA"],
    ["ONE_SHOT", "MANGA"],
    ["NOVEL", "LIGHT_NOVEL"],
  ] as const)("format %s vira %s", (format, expected) => {
    expect(mapAniListFormat(format)).toBe(expected);
  });

  it("sem format conhecido usa o type da consulta", () => {
    expect(mapAniListFormat(null, "MANGA")).toBe("MANGA");
    expect(mapAniListFormat(undefined, "ANIME")).toBe("ANIME");
    expect(mapAniListFormat("ALGO_NOVO", "MANGA")).toBe("MANGA");
  });

  it.each([
    ["RELEASING", "RELEASING"],
    ["HIATUS", "RELEASING"],
    ["NOT_YET_RELEASED", "UPCOMING"],
    ["FINISHED", "FINISHED"],
    ["CANCELLED", "FINISHED"],
    [null, "FINISHED"],
    ["???", "FINISHED"],
  ] as const)("status %s vira %s", (status, expected) => {
    expect(mapAniListStatus(status)).toBe(expected);
  });

  it.each([
    ["Female", "FEMALE"],
    ["male", "MALE"],
    ["Male", "MALE"],
    ["Non-binary", "NONBINARY"],
    ["Nonbinary", "NONBINARY"],
    ["Genderfluid", "UNKNOWN"],
    ["", "UNKNOWN"],
    [null, "UNKNOWN"],
    [undefined, "UNKNOWN"],
  ] as const)("gender %s vira %s (nunca sorteado)", (gender, expected) => {
    expect(mapAniListGender(gender)).toBe(expected);
  });

  it("descarta placeholder, vazio, http e URL invalida", () => {
    const ok = "https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png";
    expect(normalizeAniListImage(ok)).toBe(ok);
    expect(
      normalizeAniListImage("https://s4.anilist.co/file/anilistcdn/character/large/default.jpg")
    ).toBeUndefined();
    expect(normalizeAniListImage("")).toBeUndefined();
    expect(normalizeAniListImage("   ")).toBeUndefined();
    expect(normalizeAniListImage(null)).toBeUndefined();
    expect(normalizeAniListImage("http://s4.anilist.co/x.png")).toBeUndefined();
    expect(normalizeAniListImage("not a url")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* discover                                                            */
/* ------------------------------------------------------------------ */

describe("AniListSource.discover", () => {
  it("expoe id e ratePerMin do contrato", () => {
    const { source } = setup(discoverHandler);
    expect(source.id).toBe("ANILIST");
    expect(source.ratePerMin).toBe(25);
  });

  it("converte as fixtures de anime em RawSeries", async () => {
    const { source } = setup(discoverHandler);
    const series = await collect(source.discover({ types: ["ANIME"] }));

    expect(series.map((s) => s.externalId)).toEqual(["154587", "178005", "190442", "185660"]);

    expect(series[0]).toStrictEqual({
      source: "ANILIST",
      externalId: "154587",
      title: "Sousou no Frieren",
      titleNative: "葬送のフリーレン",
      titleEnglish: "Frieren: Beyond Journey's End",
      mediaType: "ANIME",
      status: "RELEASING",
      startDate: new Date("2023-09-29T00:00:00.000Z"),
      popularity: 412345,
      coverUrl:
        "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587-gHSraOSa0nBG.jpg",
      isAdult: false,
      crossIds: { JIKAN: "52991" },
      url: "https://anilist.co/anime/154587",
    });

    // filme sem idMal nem titulo em ingles
    expect(series[1]).toMatchObject({
      mediaType: "ANIME",
      status: "FINISHED",
      title: "Eiga Hoshizora no Tabi",
      startDate: new Date("2026-10-03T00:00:00.000Z"),
      endDate: new Date("2026-10-03T00:00:00.000Z"),
    });
    expect(series[1].crossIds).toBeUndefined();
    expect(series[1].titleEnglish).toBeUndefined();

    // ONA adulto, futuro, data parcial (sem dia), sem capa
    expect(series[2]).toMatchObject({
      status: "UPCOMING",
      isAdult: true,
      startDate: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(series[2].titleNative).toBeUndefined();
    expect(series[2].coverUrl).toBeUndefined();

    // format null cai no type; HIATUS segue RELEASING
    expect(series[3]).toMatchObject({ mediaType: "ANIME", status: "RELEASING" });
  });

  it("converte as fixtures de manga (MANGA, ONE_SHOT, NOVEL) sem crossId do Jikan", async () => {
    const { source } = setup(discoverHandler);
    const series = await collect(source.discover({ types: ["MANGA"] }));

    expect(series.map((s) => [s.externalId, s.mediaType, s.status])).toEqual([
      ["105778", "MANGA", "RELEASING"],
      ["120001", "MANGA", "FINISHED"],
      ["132222", "LIGHT_NOVEL", "FINISHED"],
    ]);
    // idMal de manga pertence ao namespace de manga do MAL
    expect(series.every((s) => s.crossIds === undefined)).toBe(true);
    // capa placeholder descartada; data so com ano vira 1o de janeiro
    expect(series[1].coverUrl).toBeUndefined();
    expect(series[2].startDate).toEqual(new Date("2022-01-01T00:00:00.000Z"));
    expect(series[2].endDate).toEqual(new Date("2023-02-14T00:00:00.000Z"));
  });

  it("envia POST GraphQL ao host do AniList com User-Agent identificavel", async () => {
    const { source, calls } = setup(discoverHandler);
    await collect(source.discover({ types: ["ANIME"], limit: 1 }));

    const first = calls[0];
    expect(first.url).toBe(new URL(ANILIST_URL).href); // safeFetch normaliza via URL.href
    expect(first.method).toBe("POST");
    expect(first.headers["content-type"]).toBe("application/json");
    expect(first.headers["user-agent"]).toMatch(/KoguBot/);
    expect(first.query).toContain("Page(page: $page, perPage: $perPage)");
    expect(first.variables).toMatchObject({ page: 1, type: "ANIME", sort: ["TRENDING_DESC"] });
  });

  it("modo trending: ANIME e MANGA intercalados; em exibicao/futuras e lancados nos ultimos 30 dias", async () => {
    const { source, calls } = setup(discoverHandler);
    const series = await collect(source.discover({ mode: "trending" }));

    expect(series).toHaveLength(7);
    expect(series.map((s) => s.externalId)).toEqual([
      "154587",
      "178005",
      "190442",
      "105778",
      "120001",
      "132222",
      "185660",
    ]);

    const [animeAiring, mangaAiring, animeRecent, mangaRecent] = calls;
    expect(animeAiring.variables).toMatchObject({
      type: "ANIME",
      sort: ["TRENDING_DESC"],
      statusIn: ["RELEASING", "NOT_YET_RELEASED"],
    });
    expect(mangaAiring.variables).toMatchObject({ type: "MANGA", page: 1 });
    // relogio falso: 2026-10-22; 30 dias antes = 2026-09-22
    expect(animeRecent.variables).toMatchObject({
      type: "ANIME",
      statusIn: ["FINISHED"],
      startAfter: 20260922,
    });
    expect(mangaRecent.variables).toMatchObject({ type: "MANGA", statusIn: ["FINISHED"] });
    expect(calls).toHaveLength(5); // + pagina 2 de ANIME em exibicao
    expect(calls[4].variables).toMatchObject({ type: "ANIME", page: 2 });
  });

  it("modo popular: POPULARITY_DESC sem filtros", async () => {
    const { source, calls } = setup(discoverHandler);
    await collect(source.discover({ mode: "popular", types: ["ANIME"], limit: 1 }));
    expect(calls[0].variables).toMatchObject({ sort: ["POPULARITY_DESC"], type: "ANIME" });
    expect(calls[0].variables.statusIn).toBeUndefined();
    expect(calls[0].variables.startAfter).toBeUndefined();
    expect(calls[0].variables.startBefore).toBeUndefined();
  });

  it("modo season: estreias do trimestre corrente por popularidade", async () => {
    const { source, calls } = setup(discoverHandler);
    await collect(source.discover({ mode: "season", types: ["ANIME"], limit: 1 }));
    // 2026-10-22 esta no 4o trimestre: (2026-09-30, 2027-01-01) exclusivos
    expect(calls[0].variables).toMatchObject({
      sort: ["POPULARITY_DESC"],
      startAfter: 20260930,
      startBefore: 20270101,
    });
  });

  it("cursor: onCursor devolve a proxima posicao e termina com done", async () => {
    const { source } = setup(discoverHandler);
    const cursors: SourceCursor[] = [];
    await collect(source.discover({ types: ["ANIME"], onCursor: (c) => cursors.push({ ...c }) }));

    expect(cursors[0]).toStrictEqual({
      mode: "trending",
      units: "ANIME",
      page: 1,
      unit: 1,
      skip: 0,
      perPage: 50,
      done: false,
    });
    expect(cursors.at(-1)).toStrictEqual({
      mode: "trending",
      units: "ANIME",
      page: 1,
      unit: 0,
      skip: 0,
      perPage: 50,
      done: true,
    });
  });

  it("cursor: retoma da pagina indicada sem refazer as anteriores", async () => {
    const { source, calls } = setup(discoverHandler);
    const series = await collect(
      source.discover({
        types: ["ANIME"],
        cursor: {
          mode: "trending",
          units: "ANIME",
          page: 2,
          unit: 0,
          skip: 0,
          perPage: 50,
          done: false,
        },
      })
    );
    expect(series.map((s) => s.externalId)).toEqual(["185660"]);
    expect(calls[0].variables).toMatchObject({ page: 2, type: "ANIME" });
    expect(calls.every((c) => c.variables.page === 2)).toBe(true);
  });

  it("cursor invalido, de outro modo ou finalizado e ignorado (recomeca)", async () => {
    for (const cursor of [
      { mode: "popular", units: "ANIME", page: 3, unit: 0, skip: 0, perPage: 50, done: false },
      {
        mode: "trending",
        units: "ANIME,MANGA",
        page: 3,
        unit: 0,
        skip: 0,
        perPage: 50,
        done: false,
      },
      { mode: "trending", units: "ANIME", page: 3, unit: 0, skip: 0, perPage: 50, done: true },
      { mode: "trending", units: "ANIME", page: 0, unit: 0, skip: 0, perPage: 50, done: false },
      { mode: "trending", units: "ANIME", page: 1, unit: 9, skip: 0, perPage: 50, done: false },
      { mode: "trending", units: "ANIME", page: "x", unit: 0, skip: 0, perPage: 50, done: false },
    ]) {
      const { source, calls } = setup(discoverHandler);
      await collect(source.discover({ types: ["ANIME"], limit: 1, cursor }));
      expect(calls[0].variables.page).toBe(1);
    }
  });

  it("limit corta no meio da pagina e o cursor guarda quantos itens ja foram entregues (skip)", async () => {
    const first = setup(discoverHandler);
    const cursors: SourceCursor[] = [];
    const part1 = await collect(
      first.source.discover({
        types: ["ANIME"],
        limit: 2,
        onCursor: (c) => cursors.push({ ...c }),
      })
    );
    expect(part1.map((s) => s.externalId)).toEqual(["154587", "178005"]);
    expect(first.calls).toHaveLength(1);
    expect(cursors.at(-1)).toMatchObject({ page: 1, unit: 0, skip: 2, done: false });

    const second = setup(discoverHandler);
    const part2 = await collect(
      second.source.discover({ types: ["ANIME"], limit: 2, cursor: cursors.at(-1) })
    );
    // retoma no 3o item da pagina 1 e segue para a pagina 2: nenhum item repetido ou perdido
    expect(part2.map((s) => s.externalId)).toEqual(["190442", "185660"]);
    expect([...part1, ...part2].map((s) => s.externalId)).toEqual([
      "154587",
      "178005",
      "190442",
      "185660",
    ]);
  });

  it("limit menor que perPage nao trava a rotacao: cada chamada avanca", async () => {
    let cursor: Record<string, any> | undefined;
    const seen: string[] = [];
    for (let run = 0; run < 3; run++) {
      const { source } = setup(discoverHandler);
      const batch = await collect(
        source.discover({
          types: ["ANIME"],
          limit: 1,
          cursor,
          onCursor: (c) => (cursor = { ...c }),
        })
      );
      seen.push(...batch.map((s) => s.externalId));
    }
    expect(seen).toEqual(["154587", "178005", "190442"]);
  });

  it("respeita maxPages e perPage", async () => {
    const { source, calls } = setup(discoverHandler);
    await collect(source.discover({ types: ["ANIME"], maxPages: 1, perPage: 20 }));
    expect(calls.every((c) => c.variables.page === 1 && c.variables.perPage === 20)).toBe(true);
  });

  it("AbortSignal ja abortado interrompe antes de qualquer requisicao", async () => {
    const { source, calls } = setup(discoverHandler);
    const ac = new AbortController();
    ac.abort();
    await expect(collect(source.discover({ signal: ac.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* fetchCharacters                                                     */
/* ------------------------------------------------------------------ */

describe("AniListSource.fetchCharacters", () => {
  const charactersHandler: Handler = (call) =>
    fx(call.variables.page === 1 ? "characters-154587-p1.json" : "characters-154587-p2.json");

  it("mapeia personagens, ordena por favoritos e pagina via pageInfo", async () => {
    const { source, calls } = setup(charactersHandler);
    const chars = await source.fetchCharacters("154587");

    expect(calls).toHaveLength(2);
    expect(calls[0].query).toContain("FAVOURITES_DESC");
    expect(calls[0].variables).toMatchObject({ id: 154587, page: 1, perPage: 25 });
    expect(calls[1].variables).toMatchObject({ page: 2 });

    expect(chars.map((c) => [c.externalId, c.favourites])).toEqual([
      ["184947", 8421],
      ["184948", 5300],
      ["184950", 2900],
      ["185002", 15],
      ["185003", 3],
      ["185001", 0],
    ]);
    expect(chars.every((c) => c.source === "ANILIST" && c.seriesExternalId === "154587")).toBe(
      true
    );
    expect(chars.every((c) => c.isAdult === false)).toBe(true);
  });

  it("converte campos do personagem principal (aliases, descricao, imagem, role)", async () => {
    const { source } = setup(charactersHandler);
    const [frieren] = await source.fetchCharacters("154587");

    expect(frieren).toMatchObject({
      name: "Frieren",
      nameNative: "フリーレン",
      aliases: ["Frieren the Slayer"],
      gender: "FEMALE",
      role: "MAIN",
      imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b184947-ySl2VqTbHwGp.png",
      url: "https://anilist.co/character/184947",
    });
    const description = frieren.description ?? "";
    expect(description.length).toBeLessThanOrEqual(240);
    expect(description.endsWith("…")).toBe(true);
    expect(
      description.startsWith("Birthday: Unknown An elf mage who outlived her companions.")
    ).toBe(true);
    expect(description).toContain("She collects trivial spells & hoards grimoires.");
    expect(description).not.toContain("Himmel"); // spoiler removido
    expect(description).not.toMatch(/[<>~_]/); // tags, spoiler e markdown removidos
  });

  it("descarta imagem placeholder, vazia, null e http; genero ausente vira UNKNOWN", async () => {
    const { source } = setup(charactersHandler);
    const chars = await source.fetchCharacters("154587");
    const byId = new Map(chars.map((c) => [c.externalId, c]));

    const stark = byId.get("184950")!;
    expect(stark.imageUrl).toBeUndefined();
    expect("imageUrl" in stark).toBe(false);
    expect(stark.gender).toBe("MALE");
    expect(stark.role).toBe("SUPPORTING");

    const wanderer = byId.get("185001")!;
    expect(wanderer.imageUrl).toBeUndefined(); // ""
    expect(wanderer.gender).toBe("NONBINARY");
    expect(wanderer.description).toBeUndefined(); // so espacos
    expect(wanderer.aliases).toBeUndefined();
    expect(wanderer.nameNative).toBeUndefined();

    const elder = byId.get("185002")!;
    expect(elder.imageUrl).toBeUndefined(); // image: null
    expect(elder.gender).toBe("UNKNOWN"); // "Genderfluid"
    expect(elder.role).toBeUndefined(); // BACKGROUND

    const merchant = byId.get("185003")!;
    expect(merchant.imageUrl).toBeUndefined(); // http
    expect(merchant.gender).toBe("UNKNOWN"); // null
  });

  it("respeita limit sem buscar paginas extras", async () => {
    const { source, calls } = setup(charactersHandler);
    const chars = await source.fetchCharacters("154587", { limit: 2 });
    expect(calls).toHaveLength(1);
    expect(chars.map((c) => c.externalId)).toEqual(["184947", "184948"]);
  });

  it("personagens herdam isAdult da serie", async () => {
    const { source } = setup(() => fx("characters-adult-190442.json"));
    const chars = await source.fetchCharacters("190442");
    expect(chars).toHaveLength(1);
    expect(chars[0].isAdult).toBe(true);
  });

  it("serie inexistente (404) devolve lista vazia sem retentar", async () => {
    const { source, calls } = setup(() =>
      reply('{"errors":[{"message":"Not Found.","status":404}],"data":{"Media":null}}', {
        status: 404,
      })
    );
    await expect(source.fetchCharacters("999999999")).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("rejeita id nao numerico", async () => {
    const { source, calls } = setup(charactersHandler);
    await expect(source.fetchCharacters("abc")).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* refresh e topCharacters                                             */
/* ------------------------------------------------------------------ */

describe("AniListSource.refresh", () => {
  it("consulta Page(characters, id_in), deduplica, ignora ids invalidos e personagens sem midia", async () => {
    const { source, calls } = setup(() => fx("refresh-characters.json"));
    const chars = await source.refresh(["184947", "184950", "77777", "abc", "184947", "-3"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("id_in");
    expect(calls[0].variables.ids).toEqual([184947, 184950, 77777]);

    expect(chars.map((c) => c.externalId)).toEqual(["184947", "184950"]);
    expect(chars[0]).toMatchObject({
      favourites: 9100,
      seriesExternalId: "154587",
      role: "MAIN",
      gender: "FEMALE",
      isAdult: false,
    });
    expect(chars[1].imageUrl).toBeUndefined(); // placeholder
  });

  it("divide em lotes de 50", async () => {
    const { source, calls } = setup(() => fx("refresh-characters.json"));
    const ids = Array.from({ length: 120 }, (_, i) => String(1000 + i));
    await source.refresh(ids);

    expect(calls.map((c) => c.variables.ids.length)).toEqual([50, 50, 20]);
    expect(calls.map((c) => c.variables.perPage)).toEqual([50, 50, 20]);
    expect(calls[2].variables.ids[0]).toBe(1100);
  });

  it("lista vazia nao faz requisicao", async () => {
    const { source, calls } = setup(() => fx("refresh-characters.json"));
    await expect(source.refresh([])).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("AniListSource.topCharacters", () => {
  it("ordena por FAVOURITES_DESC e usa a primeira midia como serie", async () => {
    const { source, calls } = setup(() => fx("top-characters-p1.json"));
    const chars = await source.topCharacters({ page: 3, perPage: 50 });

    expect(calls[0].query).toContain("characters(sort: FAVOURITES_DESC)");
    expect(calls[0].query).toContain("media(sort: POPULARITY_DESC, perPage: 1)");
    expect(calls[0].variables).toEqual({ page: 3, perPage: 50 });

    // "Orphan Character" nao tem midia e e ignorado
    expect(chars.map((c) => c.externalId)).toEqual(["417", "45627", "88888"]);
    expect(chars[0]).toMatchObject({
      name: "Lelouch Lamperouge",
      aliases: ["Lelouch vi Britannia", "Zero"],
      gender: "MALE",
      favourites: 125000,
      seriesExternalId: "1575",
      role: "MAIN",
      isAdult: false,
    });
    expect(chars[1]).toMatchObject({ seriesExternalId: "16498", role: "SUPPORTING" });
    expect(chars[2]).toMatchObject({ seriesExternalId: "190442", isAdult: true });
    expect(chars[2].role).toBeUndefined();
  });

  it("aplica limites de pagina/perPage", async () => {
    const { source, calls } = setup(() => fx("top-characters-p1.json"));
    await source.topCharacters({ page: 0, perPage: 500 });
    expect(calls[0].variables).toEqual({ page: 1, perPage: 50 });
  });
});

/* ------------------------------------------------------------------ */
/* Rate limit, retry e erros                                           */
/* ------------------------------------------------------------------ */

describe("rate limiter", () => {
  it("espera o token do limiter entre requisicoes (relogio falso)", async () => {
    const clock = fakeClock();
    const { source, calls } = setup(
      () => fx("top-characters-p1.json"),
      {
        rateLimiter: createRateLimiter({
          bucket: "anilist-test",
          ratePerMin: 25,
          burst: 1,
          now: clock.now,
          sleep: clock.sleep,
        }),
      },
      clock
    );
    await source.topCharacters();
    await source.topCharacters();
    await source.topCharacters();

    expect(calls).toHaveLength(3);
    expect(clock.sleeps).toEqual([2400, 2400]); // 60000 / 25
  });

  it("limiter padrao: 25 req/min com burst 5, depois espera o refill", async () => {
    const clock = fakeClock();
    const { source, calls } = setup(
      () => fx("top-characters-p1.json"),
      { rateLimiter: undefined },
      clock
    );
    for (let i = 0; i < 7; i++) await source.topCharacters();

    expect(calls).toHaveLength(7);
    expect(clock.sleeps).toEqual([2400, 2400]);
  });

  it("X-RateLimit-Remaining = 0 pausa ate X-RateLimit-Reset", async () => {
    const clock = fakeClock();
    const reset = String(clock.now() / 1000 + 20);
    const { source, calls } = setup(
      (_call, n) =>
        fx("top-characters-p1.json", {
          headers: n === 1 ? { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset } : {},
        }),
      {},
      clock
    );
    await source.topCharacters();
    expect(clock.sleeps).toEqual([]);
    await source.topCharacters();
    expect(calls).toHaveLength(2);
    expect(clock.sleeps).toEqual([20_000]);
  });

  it("Remaining 0 sem Reset pausa 60 s", async () => {
    const clock = fakeClock();
    const { source } = setup(
      (_call, n) =>
        fx("top-characters-p1.json", { headers: n === 1 ? { "x-ratelimit-remaining": "0" } : {} }),
      {},
      clock
    );
    await source.topCharacters();
    await source.topCharacters();
    expect(clock.sleeps).toEqual([60_000]);
  });

  it("Remaining baixo desacelera as proximas chamadas", async () => {
    const clock = fakeClock();
    const { source } = setup(
      (_call, n) =>
        fx("top-characters-p1.json", { headers: n === 1 ? { "x-ratelimit-remaining": "2" } : {} }),
      {},
      clock
    );
    await source.topCharacters();
    await source.topCharacters();
    expect(clock.sleeps).toEqual([4800]);
  });

  it("Remaining folgado nao pausa", async () => {
    const clock = fakeClock();
    const { source } = setup(
      () => fx("top-characters-p1.json", { headers: { "x-ratelimit-remaining": "28" } }),
      {},
      clock
    );
    await source.topCharacters();
    await source.topCharacters();
    expect(clock.sleeps).toEqual([]);
  });
});

describe("retry e erros", () => {
  it("429 com Retry-After e retentado respeitando a espera pedida", async () => {
    const clock = fakeClock();
    const { source, calls } = setup(
      (_call, n) =>
        n === 1
          ? fx("error-rate-limited.json", { status: 429, headers: { "retry-after": "7" } })
          : fx("top-characters-p1.json"),
      {},
      clock
    );
    const chars = await source.topCharacters();

    expect(calls).toHaveLength(2);
    expect(chars).toHaveLength(3);
    expect(clock.sleeps).toEqual([7000]); // sem espera dupla: a pausa reativa ja foi cumprida
  });

  it("429 persistente falha apos esgotar as retentativas", async () => {
    const { source, calls } = setup(
      () => fx("error-rate-limited.json", { status: 429, headers: { "retry-after": "1" } }),
      { retry: { retries: 2, random: () => 0.5 } }
    );
    await expect(source.topCharacters()).rejects.toMatchObject({
      name: "SafeFetchError",
      status: 429,
    });
    expect(calls).toHaveLength(3);
  });

  it("5xx e retentado; 4xx nao", async () => {
    const flaky = setup((_call, n) =>
      n === 1 ? reply("{}", { status: 503 }) : fx("top-characters-p1.json")
    );
    await expect(flaky.source.topCharacters()).resolves.toHaveLength(3);
    expect(flaky.calls).toHaveLength(2);

    const bad = setup(() => reply("{}", { status: 400 }));
    await expect(bad.source.topCharacters()).rejects.toMatchObject({ status: 400 });
    expect(bad.calls).toHaveLength(1);
  });

  it("resposta GraphQL com errors lanca AniListError e nao e retentada", async () => {
    const { source, calls } = setup(() => fx("error-validation.json"));
    const err = await source.topCharacters().then(
      () => null,
      (e) => e
    );
    expect(err).toBeInstanceOf(AniListError);
    expect((err as AniListError).graphqlStatus).toBe(400);
    expect((err as AniListError).messages[0]).toContain("MediaType");
    expect(calls).toHaveLength(1);
  });

  it("errors com status 5xx no corpo sao retentados", async () => {
    const { source, calls } = setup((_call, n) =>
      n === 1
        ? reply('{"errors":[{"message":"Internal Server Error.","status":500}],"data":null}')
        : fx("top-characters-p1.json")
    );
    await expect(source.topCharacters()).resolves.toHaveLength(3);
    expect(calls).toHaveLength(2);
  });

  it("corpo sem data nem errors lanca AniListError", async () => {
    const { source, calls } = setup(() => reply('{"data":null}'));
    await expect(source.topCharacters()).rejects.toBeInstanceOf(AniListError);
    expect(calls).toHaveLength(1);
  });

  it("JSON invalido no corpo falha", async () => {
    const { source } = setup(() => reply("<html>bad gateway</html>"), {
      retry: { retries: 0 },
    });
    await expect(source.topCharacters()).rejects.toMatchObject({ name: "SafeFetchError" });
  });
});
