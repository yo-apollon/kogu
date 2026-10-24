import { describe, expect, it, vi } from "vitest";
import {
  AniListCharacterFinder,
  CatalogApiError,
  matchesQuery,
  pickMatch,
} from "../../../src/modules/catalog/anilist.js";

const killua = {
  id: 27,
  name: { full: "Killua Zoldyck", native: "キルア=ゾルディック", alternative: ["Kirua", null] },
  gender: "Male",
  description: "<b>Killua</b> is the heir.~!spoiler!~",
  image: { large: "https://s4.anilist.co/file/anilistcdn/character/large/b27-x.png" },
  favourites: 80_000,
  siteUrl: "https://anilist.co/character/27",
  media: {
    edges: [
      {
        characterRole: "MAIN",
        node: {
          id: 11061,
          idMal: 11061,
          type: "ANIME",
          format: "TV",
          status: "FINISHED",
          title: { romaji: "Hunter x Hunter (2011)", english: "Hunter x Hunter (2011)", native: "HUNTER×HUNTER" },
          startDate: { year: 2011, month: 10, day: 2 },
          popularity: 500_000,
          coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg" },
          isAdult: false,
          siteUrl: "https://anilist.co/anime/11061",
        },
      },
    ],
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function finderWith(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return new AniListCharacterFinder({
    fetchImpl,
    lookupImpl: async () => [{ address: "104.16.0.1" }],
    rateLimiter: { acquire: async () => undefined },
    retry: { retries: 1, baseMs: 1, maxMs: 2, jitter: false, sleep: async () => undefined },
  });
}

describe("matchesQuery", () => {
  it("aceita tokens contidos nos nomes, em qualquer ordem, e nome nativo", () => {
    expect(matchesQuery("killua", ["Killua Zoldyck"])).toBe(true);
    expect(matchesQuery("zoldyck killua", ["Killua Zoldyck"])).toBe(true);
    expect(matchesQuery("キルア=ゾルディック", ["Killua Zoldyck", "キルア=ゾルディック"])).toBe(true);
  });
  it("tolera erro de digitacao pequeno e recusa nome sem relacao", () => {
    expect(matchesQuery("Kilua Zoldyk", ["Killua Zoldyck"])).toBe(true);
    expect(matchesQuery("Naruto Uzumaki", ["Killua Zoldyck"])).toBe(false);
    expect(matchesQuery("   ", ["Killua Zoldyck"])).toBe(false);
  });
});

describe("pickMatch", () => {
  it("mapeia personagem e serie (genero, imagem, role, aliases, idMal)", () => {
    const match = pickMatch("Killua", [killua]);
    expect(match).not.toBeNull();
    expect(match!.series).toMatchObject({
      source: "ANILIST",
      externalId: "11061",
      mediaType: "ANIME",
      status: "FINISHED",
      crossIds: { JIKAN: "11061" },
    });
    expect(match!.character).toMatchObject({
      source: "ANILIST",
      externalId: "27",
      name: "Killua Zoldyck",
      nameNative: "キルア=ゾルディック",
      gender: "MALE",
      favourites: 80_000,
      seriesExternalId: "11061",
      role: "MAIN",
      isAdult: false,
      aliases: ["Kirua"],
    });
    expect(match!.character.imageUrl).toContain("s4.anilist.co");
  });

  it("pula personagem sem obra vinculada e o que nao parece com a busca", () => {
    const noMedia = { ...killua, id: 1, media: { edges: [] } };
    const other = { ...killua, id: 2, name: { full: "Naruto Uzumaki", native: null, alternative: [] } };
    expect(pickMatch("Killua", [noMedia, other])).toBeNull();
    expect(pickMatch("Killua", [noMedia, killua])!.character.externalId).toBe("27");
    expect(pickMatch("Killua", [null, undefined as never])).toBeNull();
  });

  it("genero ausente vira UNKNOWN (nunca sorteado)", () => {
    const m = pickMatch("Killua", [{ ...killua, gender: null }]);
    expect(m!.character.gender).toBe("UNKNOWN");
  });
});

describe("AniListCharacterFinder", () => {
  it("faz POST GraphQL no host do AniList com a busca e devolve o melhor resultado", async () => {
    const seen: Array<{ url: string; body: any }> = [];
    const finder = finderWith(async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return json({ data: { Page: { characters: [killua] } } });
    });
    const match = await finder.find("  Killua  ");
    expect(match?.character.externalId).toBe("27");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://graphql.anilist.co/");
    expect(seen[0].body.variables.search).toBe("Killua");
    expect(seen[0].body.query).toContain("SEARCH_MATCH");
  });

  it("sem resultado: null; busca vazia nem chama a API", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { Page: { characters: [] } } }));
    const finder = finderWith(fetchImpl);
    expect(await finder.find("zzzz")).toBeNull();
    expect(await finder.find("   ")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("404 e erro GraphQL 404 viram null", async () => {
    expect(await finderWith(async () => json({ errors: [{ message: "Not Found." }] }, 404)).find("x")).toBeNull();
    expect(
      await finderWith(async () => json({ errors: [{ message: "Not Found.", status: 404 }], data: null })).find("x")
    ).toBeNull();
  });

  it("5xx e retentado e, esgotado, vira CatalogApiError", async () => {
    const fetchImpl = vi.fn(async () => json({}, 503));
    await expect(finderWith(fetchImpl).find("Killua")).rejects.toBeInstanceOf(CatalogApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 tentativa + 1 retry
  });

  it("recupera quando a segunda tentativa funciona", async () => {
    let n = 0;
    const finder = finderWith(async () =>
      ++n === 1 ? json({}, 502) : json({ data: { Page: { characters: [killua] } } })
    );
    expect((await finder.find("Killua"))?.character.name).toBe("Killua Zoldyck");
  });

  it("erro GraphQL diferente de 404 vira CatalogApiError", async () => {
    const finder = finderWith(async () => json({ errors: [{ message: "boom", status: 400 }] }));
    await expect(finder.find("Killua")).rejects.toBeInstanceOf(CatalogApiError);
  });

  it("host bloqueado/IP privado nao chega ao fetch (anti-SSRF do safeFetch)", async () => {
    const fetchImpl = vi.fn(async () => json({}));
    const finder = new AniListCharacterFinder({
      fetchImpl,
      lookupImpl: async () => [{ address: "127.0.0.1" }],
      rateLimiter: { acquire: async () => undefined },
      retry: { retries: 0 },
    });
    await expect(finder.find("Killua")).rejects.toBeInstanceOf(CatalogApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
