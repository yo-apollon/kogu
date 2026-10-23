import { describe, expect, it } from "vitest";
import {
  deriveFranchiseName,
  mapMediaType,
  normalizeImageUrl,
  primarySourceOf,
  slugCandidates,
  toEntityFields,
  toSeriesFields,
  universeOf,
} from "../../../src/catalog/normalize.js";
import type { MediaType, RawCharacter, RawSeries } from "../../../src/catalog/types.js";

describe("mapa de media_type", () => {
  it("mapeia todos os MediaType do contrato", () => {
    const expected: Record<MediaType, string> = {
      ANIME: "ANIME_TV",
      MANGA: "MANGA",
      LIGHT_NOVEL: "MANGA",
      GAME: "GAME",
      MOVIE: "MOVIE",
      TV: "TV_SHOW",
    };
    for (const [k, v] of Object.entries(expected)) expect(mapMediaType(k as MediaType)).toBe(v);
  });
  it("universo derivado do tipo da fonte", () => {
    expect(universeOf("ANIME")).toBe("ANIME");
    expect(universeOf("LIGHT_NOVEL")).toBe("ANIME");
    expect(universeOf("GAME")).toBe("GAME");
    expect(universeOf("MOVIE")).toBe("CINEMA");
    expect(universeOf("TV")).toBe("CINEMA");
  });
});

describe("franquia e slug", () => {
  it("remove sufixos de temporada", () => {
    expect(deriveFranchiseName("Attack on Titan Season 2", "ANIME")).toBe("Attack on Titan");
    expect(deriveFranchiseName("Attack on Titan: The Final Season", "ANIME")).toBe("Attack on Titan");
    expect(deriveFranchiseName("Sword Art Online II", "ANIME")).toBe("Sword Art Online");
    expect(deriveFranchiseName("Re:Zero", "ANIME")).toBe("Re:Zero");
  });
  it("jogos perdem o subtitulo", () => {
    expect(deriveFranchiseName("The Legend of Zelda: Breath of the Wild", "GAME")).toBe("The Legend of Zelda");
  });
  it("candidatos de slug ganham sufixo de fonte", () => {
    expect(slugCandidates("Rem", "ANILIST", "123")).toEqual(["rem", "rem-anilist", "rem-anilist-123"]);
    expect(slugCandidates("???", "IGDB", "9")[0]).toBe("igdb-9");
  });
});

describe("campos", () => {
  const series: RawSeries = {
    source: "ANILIST", externalId: "1", title: " Naruto ", mediaType: "ANIME", status: "FINISHED",
    startDate: new Date("2002-10-03T15:00:00Z"), popularity: 1, isAdult: false,
  };
  it("serie", () => {
    const f = toSeriesFields(series);
    expect(f.title).toBe("Naruto");
    expect(f.mediaType).toBe("ANIME_TV");
    expect(f.releasedAt?.toISOString()).toBe("2002-10-03T00:00:00.000Z");
  });
  const ch: RawCharacter = {
    source: "ANILIST", externalId: "7", name: "Gojo  Satoru", gender: "UNKNOWN", favourites: 12.6,
    seriesExternalId: "1", description: "<p>Hi~!spoiler!~</p>", imageUrl: "https://s4.anilist.co/x.png",
  };
  it("genero UNKNOWN permanece UNKNOWN e nome vira chave ordenada", () => {
    const f = toEntityFields(ch, { universe: "ANIME", seriesIsAdult: false });
    expect(f.gender).toBe("UNKNOWN");
    expect(f.name).toBe("Gojo Satoru");
    expect(f.nameNormalized).toBe("gojo satoru");
    expect(toEntityFields({ ...ch, name: "Satoru Gojo" }, { universe: "ANIME", seriesIsAdult: false }).nameNormalized).toBe("gojo satoru");
    expect(f.sourceFavorites).toBe(13);
    expect(f.description).toBe("Hi");
    expect(f.isAdult).toBe(false);
    expect(toEntityFields(ch, { universe: "ANIME", seriesIsAdult: true }).isAdult).toBe(true);
  });
  it("imagem: placeholder e http sao descartados", () => {
    expect(normalizeImageUrl("https://s4.anilist.co/file/anilistcdn/character/large/default.jpg")).toBeNull();
    expect(normalizeImageUrl("http://x/a.png")).toBeNull();
    expect(normalizeImageUrl(undefined)).toBeNull();
    expect(normalizeImageUrl("https://s4.anilist.co/a.png")).toBe("https://s4.anilist.co/a.png");
  });
  it("fonte primaria por prioridade", () => {
    expect(primarySourceOf(["JIKAN", "ANILIST"])).toBe("ANILIST");
    expect(primarySourceOf([])).toBe("LEGACY");
  });
});
