import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/infra/db/client.js", () => ({ db: {}, sql: {} }));

import { emptyPantheonQuery } from "../../../src/modules/collection/flags.js";
import type { EntityInfo, PantheonRow } from "../../../src/modules/collection/service.js";
import { parseRef, escapeLike } from "../../../src/modules/collection/service.js";
import {
  buildInfoView,
  buildPantheonEmbed,
  cardRenderInput,
  entityChoice,
  infoAetherValue,
  pactChoice,
  pantheonLine,
  parseHexColor,
  safeText,
} from "../../../src/modules/collection/views.js";
import { pactAetherValue } from "../../../src/modules/summon/variants.js";

const row = (extra: Partial<PantheonRow> = {}): PantheonRow => ({
  pactId: 1,
  entityId: 1,
  name: "Zero Two",
  gender: "FEMALE",
  tier: "COMMON",
  variant: "STANDARD",
  awakeningKeys: 0,
  isSoulmate: false,
  alias: null,
  alias2: null,
  baseAether: 100,
  claimRank: null,
  likeRank: null,
  seriesTitle: "Franxx",
  value: 250,
  ...extra,
});

const display = emptyPantheonQuery().display;

describe("pantheonLine", () => {
  it("icone da variante, selos, serie e valor", () => {
    expect(pantheonLine(row({ variant: "ASTRAL", awakeningKeys: 4 }), 3, display, "pt-BR")).toBe(
      "**3.** 🔮 **Zero Two** `★4` — `Franxx` (💠 250)"
    );
    expect(pantheonLine(row({ variant: "FOIL" }), 1, display, "pt-BR")).toContain("✨");
    expect(pantheonLine(row({ variant: "HOLO" }), 1, display, "pt-BR")).toContain("🌟");
    expect(pantheonLine(row({ variant: "STANDARD" }), 1, display, "pt-BR")).toContain("📜");
  });

  it("sem selos nao mostra estrela; sem serie nao mostra o travessao", () => {
    const line = pantheonLine(row({ seriesTitle: null }), 1, display, "pt-BR");
    expect(line).not.toContain("★");
    expect(line).not.toContain("—");
  });

  it("apelido, ranks e Eter base (k-)", () => {
    const line = pantheonLine(
      row({ alias: "002", claimRank: 5, likeRank: 9 }),
      1,
      { ...display, baseAether: true, claimRank: true, likeRank: true },
      "pt-BR"
    );
    expect(line).toContain("*(002)*");
    expect(line).toContain("(💠 100)");
    expect(line).toContain("🏆 #5");
    expect(line).toContain("⭐ #9");
  });

  it("modo compacto omite serie e apelido", () => {
    const line = pantheonLine(row({ alias: "002" }), 1, { ...display, compact: true }, "pt-BR");
    expect(line).toBe("**1.** 📜 **Zero Two** (💠 250)");
  });

  it("escapa markdown no nome e nao deixa crase quebrar a serie", () => {
    const line = pantheonLine(row({ name: "**Boss**", seriesTitle: "a`b" }), 1, display, "pt-BR");
    expect(line).toContain("**\\*\\*Boss\\*\\***");
    expect(line).toContain("`a'b`");
  });

  it("formata o valor com o separador do idioma", () => {
    expect(pantheonLine(row({ value: 12345 }), 1, display, "pt-BR")).toContain("12.345");
    expect(pantheonLine(row({ value: 12345 }), 1, display, "en-US")).toContain("12,345");
  });
});

describe("buildPantheonEmbed", () => {
  const base = {
    userName: "Alice",
    page: 2,
    totalPages: 3,
    pageSize: 10,
    query: emptyPantheonQuery(),
    summary: { total: 25, totalAether: 4321, leaderName: "Zero Two" },
    filtered: false,
    locale: "pt-BR",
  };

  it("titulo, cabecalho, numeracao continua entre paginas e rodape", () => {
    const e = buildPantheonEmbed({
      ...base,
      rows: [row({ name: "A" }), row({ pactId: 2, name: "B" })],
    }).toJSON();
    expect(e.title).toBe("🏛️ Panteão de Alice (25 Entidades)");
    expect(e.description).toContain("Campeão Líder: **Zero Two**");
    expect(e.description).toContain("Valor em Éter: 4.321");
    expect(e.description).toContain("**11.** 📜 **A**");
    expect(e.description).toContain("**12.** 📜 **B**");
    expect(e.footer?.text).toBe("Página 2/3");
  });

  it("sem linhas: vazio ou filtro sem resultado", () => {
    const empty = buildPantheonEmbed({ ...base, rows: [], page: 1, totalPages: 1 }).toJSON();
    expect(empty.description).toContain("Seu Panteão ainda está vazio");
    const filtered = buildPantheonEmbed({
      ...base,
      rows: [],
      page: 1,
      totalPages: 1,
      filtered: true,
    }).toJSON();
    expect(filtered.description).toBe("Nenhuma entidade encontrada com estes filtros.");
  });

  it("10 linhas ficam bem abaixo do limite de 4096 do Discord", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ pactId: i, name: "N".repeat(80), seriesTitle: "S".repeat(80), alias: "A".repeat(80) })
    );
    const e = buildPantheonEmbed({ ...base, rows }).toJSON();
    expect(e.description!.length).toBeLessThan(4096);
  });

  it("en-US usa o idioma do servidor", () => {
    const e = buildPantheonEmbed({ ...base, locale: "en-US", rows: [row()] }).toJSON();
    expect(e.footer?.text).toBe("Page 2/3");
  });
});

describe("info", () => {
  const info = (extra: Partial<EntityInfo> = {}): EntityInfo => ({
    id: 7,
    name: "Zero Two",
    universe: "ANIME",
    gender: "FEMALE",
    tier: "RARE",
    baseAether: 380,
    baseAtk: 90,
    baseDef: 70,
    baseSpd: 85,
    popularityRank: 12,
    claimRank: null,
    likeRank: 4,
    imageUrl: "https://s4.anilist.co/x.png",
    seriesTitle: null,
    pact: null,
    ...extra,
  });
  const pact = {
    id: 1,
    userId: "u",
    ownerName: "Bob",
    variant: "HOLO" as const,
    awakeningKeys: 3,
    aetherAtBind: 100,
    note: null,
    alias: "meu apelido",
    hasCustomImage: true,
    ownerEmbedColor: "#00ff00",
    position: 5,
  };

  it("carta livre: valor base, sem dono, serie padrao e ranks (claim cai para popularidade)", () => {
    const view = buildInfoView(info(), { locale: "pt-BR" });
    expect(view).toMatchObject({
      name: "Zero Two",
      franchise: "Universo Dimensional",
      aetherValue: 380,
      claimRank: 12,
      likeRank: 4,
      variant: "STANDARD",
      ownerName: undefined,
    });
  });

  it("carta com dono: valor do pacto, apelido como nota, imagem propria, cor e posicao", () => {
    const i = info({ pact });
    expect(infoAetherValue(i)).toBe(pactAetherValue(380, "HOLO", 3, 100));
    const view = buildInfoView(i, { locale: "pt-BR", ownerAvatarUrl: "https://cdn/x.png" });
    expect(view).toMatchObject({
      ownerName: "Bob",
      ownerNote: "meu apelido",
      hasCustomPic: true,
      ownerEmbedColor: 0x00ff00,
      ownerPosition: 5,
      ownerKeys: 3,
      ownerAvatarUrl: "https://cdn/x.png",
      variant: "HOLO",
    });
  });

  it("dono sem nome cadastrado cai no rotulo padrao", () => {
    const view = buildInfoView(info({ pact: { ...pact, ownerName: null } }), { locale: "pt-BR" });
    expect(view.ownerName).toBe("Invocador");
  });

  it("entrada do renderer usa a skin mudae e a imagem primaria", () => {
    const input = cardRenderInput(info({ pact }), "pt-BR");
    expect(input).toMatchObject({
      skinId: "mudae",
      entityId: "7",
      imageUrl: "https://s4.anilist.co/x.png",
      ownerName: "Bob",
      variant: "HOLO",
      awakeningKeys: 3,
      tier: "RARE",
      atk: 90,
    });
    expect(cardRenderInput(info({ imageUrl: null }), "pt-BR").imageUrl).toBeUndefined();
  });

  it("parseHexColor", () => {
    expect(parseHexColor("#5865F2")).toBe(0x5865f2);
    expect(parseHexColor("5865f2")).toBe(0x5865f2);
    expect(parseHexColor("blue")).toBeUndefined();
    expect(parseHexColor(null)).toBeUndefined();
  });
});

describe("choices de autocomplete", () => {
  it("entidade: id:<n>, serie no rotulo, corte em 100 caracteres", () => {
    expect(
      entityChoice({ id: 9, name: "Zero Two", series: "Franxx", gender: "FEMALE", tier: "COMMON" })
    ).toEqual({ name: "Zero Two · Franxx", value: "id:9" });
    const long = entityChoice({
      id: 1,
      name: "N".repeat(150),
      series: null,
      gender: "MALE",
      tier: "RARE",
    });
    expect(Array.from(long.name)).toHaveLength(100);
    expect(long.name.endsWith("…")).toBe(true);
  });

  it("pacto: pact:<id>", () => {
    expect(pactChoice({ pactId: 4, name: "Zero Two", series: null })).toEqual({
      name: "Zero Two",
      value: "pact:4",
    });
  });
});

describe("helpers do servico (sem banco)", () => {
  it("parseRef separa referencias do autocomplete de nomes digitados", () => {
    expect(parseRef("id:12")).toEqual({ kind: "id", id: 12 });
    expect(parseRef(" PACT:7 ")).toEqual({ kind: "pact", id: 7 });
    expect(parseRef("Zero Two")).toEqual({ kind: "name", text: "Zero Two" });
    expect(parseRef("id:abc")).toEqual({ kind: "name", text: "id:abc" });
    expect(parseRef("id:1234567890123456")).toEqual({ kind: "name", text: "id:1234567890123456" });
  });

  it("escapeLike escapa curingas", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(safeText("a*b", 5)).toBe("a\\*b");
  });
});
