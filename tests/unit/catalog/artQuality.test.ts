import { describe, expect, it } from "vitest";
import {
  classifyArt,
  indexOverrides,
  isItemSubject,
  resolveCardArt,
  type ArtOverride,
} from "../../../src/catalog/artQuality.js";

const ANILIST = "https://s4.anilist.co/file/anilistcdn/character/large/b1-abc.png";
const IGDB_COVER = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.png";
const TMDB_POSTER = "https://image.tmdb.org/t/p/w500/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg";
const OWN = "https://yo-apollon.github.io/kogu/assets/cards/rihanna.jpg";

describe("classifyArt: URL", () => {
  it("vazio, nulo ou so espacos = MISSING", () => {
    for (const imageUrl of [undefined, null, "", "   "]) {
      expect(classifyArt({ type: "CHARACTER", imageUrl, name: "X" })).toMatchObject({ kind: "MISSING", trusted: false });
    }
  });

  it("IGDB t_cover = COVER nao confiavel", () => {
    expect(classifyArt({ type: "CHARACTER", imageUrl: IGDB_COVER, name: "Kratos" })).toMatchObject({
      kind: "COVER",
      trusted: false,
    });
    const thumb = "https://images.igdb.com/igdb/image/upload/t_cover_small_2x/co1.jpg";
    expect(classifyArt({ type: "CHARACTER", imageUrl: thumb, name: "K" }).kind).toBe("COVER");
  });

  it("IGDB que nao e capa (captura de tela) tambem nao e confiavel", () => {
    const shot = "https://images.igdb.com/igdb/image/upload/t_screenshot_big/sc1.jpg";
    expect(classifyArt({ type: "CHARACTER", imageUrl: shot, name: "K" })).toMatchObject({ kind: "POSTER", trusted: false });
  });

  it.each(["w342", "w500", "w780", "original"])("TMDB %s = POSTER nao confiavel", (size) => {
    const url = `https://image.tmdb.org/t/p/${size}/abc.jpg`;
    expect(classifyArt({ type: "CHARACTER", imageUrl: url, name: "Thanos" })).toMatchObject({
      kind: "POSTER",
      trusted: false,
    });
  });

  it.each(["h632", "w185", "w45"])("TMDB %s (perfil) = CHARACTER confiavel", (size) => {
    const url = `https://image.tmdb.org/t/p/${size}/abc.jpg`;
    expect(classifyArt({ type: "CHARACTER", imageUrl: url, name: "Ator" })).toMatchObject({
      kind: "CHARACTER",
      trusted: true,
    });
  });

  it("AniList character/large = CHARACTER confiavel", () => {
    expect(classifyArt({ type: "CHARACTER", imageUrl: ANILIST, name: "Levi" })).toMatchObject({
      kind: "CHARACTER",
      trusted: true,
    });
  });

  it("AniList capa de obra = COVER", () => {
    const url = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg";
    expect(classifyArt({ type: "CHARACTER", imageUrl: url, name: "X" })).toMatchObject({ kind: "COVER", trusted: false });
  });

  it("placeholders conhecidos = PLACEHOLDER", () => {
    const urls = [
      "https://s4.anilist.co/file/anilistcdn/character/large/default.jpg",
      "https://cdn.myanimelist.net/images/questionmark_23.gif",
      "https://cdn.discordapp.com/embed/avatars/0.png",
      "https://cdn.myanimelist.net/images/na.gif",
      "https://upload.wikimedia.org/x/placeholder.png",
    ];
    for (const imageUrl of urls) {
      expect(classifyArt({ type: "CHARACTER", imageUrl, name: "X" })).toMatchObject({
        kind: "PLACEHOLDER",
        trusted: false,
      });
    }
  });

  it("foto propria do catalogo (host e caminho relativo) e confiavel", () => {
    expect(classifyArt({ type: "CHARACTER", imageUrl: OWN, name: "Rihanna" })).toMatchObject({
      kind: "CHARACTER",
      trusted: true,
    });
    expect(classifyArt({ imageUrl: "./assets/cards/rihanna.jpg", name: "Rihanna" })).toMatchObject({
      kind: "CHARACTER",
      trusted: true,
    });
  });

  it("host sem heuristica = UNKNOWN; personagem confia, item nao", () => {
    const url = "https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg";
    expect(classifyArt({ type: "CHARACTER", imageUrl: url, name: "Pessoa" })).toMatchObject({
      kind: "UNKNOWN",
      trusted: true,
    });
    expect(classifyArt({ type: "WEAPON", imageUrl: url, name: "Espada" }).trusted).toBe(false);
  });

  it("URL invalida (esquema desconhecido) nao quebra: UNKNOWN", () => {
    expect(classifyArt({ type: "CHARACTER", imageUrl: "synthetic://0", name: "X" }).kind).toBe("UNKNOWN");
  });
});

describe("classifyArt: itens", () => {
  it.each(["WEAPON", "COMPANION", "DOMAIN"])("%s nunca e confiavel com arte de personagem/capa/poster", (type) => {
    for (const imageUrl of [ANILIST, IGDB_COVER, TMDB_POSTER, OWN]) {
      const c = classifyArt({ type, imageUrl, name: "Algo" });
      expect(c.trusted, `${type} ${imageUrl}`).toBe(false);
      expect(c.reason).toMatch(/item/i);
    }
  });

  it("tipo em minusculas tambem vale", () => {
    expect(classifyArt({ type: "weapon", imageUrl: ANILIST, name: "X" }).trusted).toBe(false);
  });

  it("sem tipo, nome de objeto indica item", () => {
    expect(classifyArt({ imageUrl: ANILIST, name: "Buster Sword" }).trusted).toBe(false);
    expect(classifyArt({ imageUrl: ANILIST, name: "Cloud Strife" }).trusted).toBe(true);
  });

  it("tipo CHARACTER explicito vence a heuristica do nome (ex.: o heroi Blade)", () => {
    expect(isItemSubject({ type: "CHARACTER", name: "Blade" })).toBe(false);
    expect(classifyArt({ type: "CHARACTER", imageUrl: ANILIST, name: "Blade" }).trusted).toBe(true);
  });

  it("MISSING de item continua nao confiavel", () => {
    expect(classifyArt({ type: "WEAPON", imageUrl: "", name: "X" })).toMatchObject({ kind: "MISSING", trusted: false });
  });
});

describe("resolveCardArt", () => {
  it("personagem com arte confiavel usa a imagem", () => {
    expect(resolveCardArt({ type: "CHARACTER", imageUrl: ANILIST, name: "Levi", slug: "levi" })).toEqual({
      mode: "IMAGE",
      url: ANILIST,
    });
  });

  it("personagem com poster/capa/placeholder/sem imagem vira emblema de personagem", () => {
    for (const imageUrl of [TMDB_POSTER, IGDB_COVER, "https://cdn.discordapp.com/embed/avatars/1.png", undefined]) {
      expect(resolveCardArt({ type: "CHARACTER", imageUrl, name: "X", slug: "x" })).toEqual({
        mode: "EMBLEM",
        emblem: "character",
      });
    }
  });

  it("item sem override vira emblema pela palavra-chave do nome", () => {
    expect(resolveCardArt({ type: "WEAPON", imageUrl: ANILIST, name: "Machado Leviatã", slug: "m" })).toEqual({
      mode: "EMBLEM",
      emblem: "axe",
    });
    expect(resolveCardArt({ type: "WEAPON", imageUrl: ANILIST, name: "Frostmourne", slug: "f" })).toEqual({
      mode: "EMBLEM",
      emblem: "gem",
    });
  });

  it("a descricao ajuda quando o nome nao diz a classe", () => {
    expect(
      resolveCardArt({ type: "WEAPON", imageUrl: null, name: "Frostmourne", description: "A cursed runeblade sword" })
    ).toEqual({ mode: "EMBLEM", emblem: "sword" });
  });

  it("override por slug vence (item ou personagem)", () => {
    const overrides: ArtOverride[] = [
      { slug: "mjolnir", url: "https://upload.wikimedia.org/a/b/hammer.png", kind: "ITEM", source: "wikimedia" },
    ];
    expect(resolveCardArt({ type: "WEAPON", imageUrl: TMDB_POSTER, name: "Mjolnir", slug: "mjolnir" }, overrides)).toEqual({
      mode: "IMAGE",
      url: "https://upload.wikimedia.org/a/b/hammer.png",
    });
    // aceita tambem o indice pronto
    expect(
      resolveCardArt({ type: "WEAPON", imageUrl: TMDB_POSTER, name: "Mjolnir", slug: "mjolnir" }, indexOverrides(overrides)).mode
    ).toBe("IMAGE");
    // outro slug nao e afetado
    expect(resolveCardArt({ type: "WEAPON", imageUrl: TMDB_POSTER, name: "Mjolnir", slug: "outro" }, overrides).mode).toBe("EMBLEM");
  });

  it("imagem escolhida pelo dono (trustImage) e sempre usada", () => {
    expect(
      resolveCardArt({ type: "WEAPON", imageUrl: "https://i.imgur.com/x.png", name: "Espada", trustImage: true })
    ).toEqual({ mode: "IMAGE", url: "https://i.imgur.com/x.png" });
  });

  it("trustImage sem URL nao inventa imagem", () => {
    expect(resolveCardArt({ type: "CHARACTER", imageUrl: "", name: "X", trustImage: true }).mode).toBe("EMBLEM");
  });
});
