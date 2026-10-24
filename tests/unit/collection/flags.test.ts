import { describe, expect, it } from "vitest";
import {
  PANTHEON_SHORTCUT,
  emptyPantheonQuery,
  flagSuffix,
  hasActiveFilters,
  parseFlags,
  parsePantheonTokens,
  queryFromSlash,
  toPantheonQuery,
  userIdFromToken,
} from "../../../src/modules/collection/flags.js";

describe("parseFlags", () => {
  it("entrada vazia: nada ligado", () => {
    expect(parseFlags("")).toEqual({ excludedTerms: [], rawFlags: "", arguments: [] });
  });

  it("genero: w, h, wh/hw e as versoes estritas w= / h=", () => {
    expect(parseFlags("w")).toMatchObject({ gender: "FEMALE" });
    expect(parseFlags("h")).toMatchObject({ gender: "MALE" });
    expect(parseFlags("wh")).toMatchObject({ gender: "BOTH" });
    expect(parseFlags("hw")).toMatchObject({ gender: "BOTH" });
    expect(parseFlags("w=")).toMatchObject({ gender: "FEMALE", strictGender: true });
    expect(parseFlags("h=")).toMatchObject({ gender: "MALE", strictGender: true });
    expect(parseFlags("").gender).toBeUndefined();
  });

  it("Eter: k mostra, k= ordena, k- base", () => {
    expect(parseFlags("k")).toMatchObject({ showAether: true });
    expect(parseFlags("k=")).toMatchObject({ sortByAether: true });
    expect(parseFlags("k-")).toMatchObject({ baseAetherOnly: true });
    expect(parseFlags("k=").showAether).toBeUndefined();
  });

  it("selos: y, y=, y+, y-, y!, y!=", () => {
    expect(parseFlags("y")).toMatchObject({ keysOnly: true });
    expect(parseFlags("y=")).toMatchObject({ sortByKeys: true });
    expect(parseFlags("y+")).toMatchObject({ withAndWithoutKeys: true });
    expect(parseFlags("y-")).toMatchObject({ withoutKeys: true });
    expect(parseFlags("y!")).toMatchObject({ soulmatesOnly: true });
    expect(parseFlags("y!=")).toMatchObject({ sortBySoulmates: true });
    expect(parseFlags("y!").keysOnly).toBeUndefined();
  });

  it("ranks: r ordena, r- mostra, l ordena, l- mostra, rl media (sem ligar o l)", () => {
    expect(parseFlags("r")).toMatchObject({ sortByClaimRank: true });
    expect(parseFlags("r-")).toMatchObject({ showClaimRank: true });
    expect(parseFlags("l")).toMatchObject({ sortByLikeRank: true });
    expect(parseFlags("l-")).toMatchObject({ showLikeRank: true });
    const avg = parseFlags("rl");
    expect(avg.averageRank).toBe(true);
    expect(avg.sortByLikeRank).toBeUndefined();
  });

  it("universo: g=GAME, g-=ANIME, gg-=ambos (g- nao e mais engolido por g)", () => {
    expect(parseFlags("g")).toMatchObject({ universe: "GAME" });
    expect(parseFlags("g=")).toMatchObject({ universe: "GAME" });
    expect(parseFlags("g-")).toMatchObject({ universe: "ANIME" });
    expect(parseFlags("g-=")).toMatchObject({ universe: "ANIME" });
    const both = parseFlags("gg-");
    expect(both.bothMedia).toBe(true);
    expect(both.universe).toBeUndefined();
  });

  it("posse, visual e ordem alfabetica", () => {
    expect(parseFlags("o=")).toMatchObject({ ownedOnly: true });
    expect(parseFlags("o-")).toMatchObject({ notOwnedByMe: true });
    expect(parseFlags("o+")).toMatchObject({ ownedByMeOnly: true });
    expect(parseFlags("o")).toMatchObject({ showOwner: true });
    expect(parseFlags("u")).toMatchObject({ unclaimedOnly: true });
    expect(parseFlags("i+")).toMatchObject({ showImageTags: true });
    expect(parseFlags("i")).toMatchObject({ showImages: true });
    expect(parseFlags("v")).toMatchObject({ compact: true });
    expect(parseFlags("a+")).toMatchObject({ showSeriesName: true });
    expect(parseFlags("a")).toMatchObject({ groupBySeries: true });
    expect(parseFlags("==")).toMatchObject({ alphabeticalSort: true });
  });

  it("combina flags e separa argumentos/exclusoes por $", () => {
    const f = parseFlags("wy!k=$naruto$--bleach$ one piece ");
    expect(f).toMatchObject({
      gender: "FEMALE",
      soulmatesOnly: true,
      sortByAether: true,
      rawFlags: "wy!k=",
      arguments: ["naruto", "one piece"],
      excludedTerms: ["bleach"],
    });
  });
});

describe("atalhos do comando", () => {
  it("flagSuffix tira pt/mm e deixa so as flags; nomes exatos nao tem flags", () => {
    expect(flagSuffix("pt")).toBe("");
    expect(flagSuffix("ptk=")).toBe("k=");
    expect(flagSuffix("PTWy")).toBe("wy");
    expect(flagSuffix("mmw")).toBe("w");
    for (const exact of ["pantheon", "mymarry", "p"]) expect(flagSuffix(exact)).toBe("");
  });

  it("matcher aceita pt/mm + letras de flag e rejeita o resto", () => {
    for (const ok of ["pt", "ptk=", "ptw", "pth", "pty", "pty!=", "mm", "mmw", "ptg-", "ptwh"]) {
      expect(PANTHEON_SHORTCUT.test(ok), ok).toBe(true);
    }
    for (const bad of ["ptz", "ptsomething", "p", "pantheon", "xpt", "mymarry", "pt k"]) {
      expect(PANTHEON_SHORTCUT.test(bad), bad).toBe(false);
    }
    // sem a flag g/y global: test() nao guarda estado
    expect(PANTHEON_SHORTCUT.test("ptk=")).toBe(PANTHEON_SHORTCUT.test("ptk="));
  });

  it("userIdFromToken: mencao, mencao com apelido e id puro", () => {
    expect(userIdFromToken("<@123456789012345678>")).toBe("123456789012345678");
    expect(userIdFromToken("<@!123456789012345678>")).toBe("123456789012345678");
    expect(userIdFromToken("123456789012345678")).toBe("123456789012345678");
    expect(userIdFromToken("123")).toBeNull();
    expect(userIdFromToken("zero")).toBeNull();
    expect(userIdFromToken("<#123456789012345678>")).toBeNull();
  });
});

describe("parsePantheonTokens / toPantheonQuery", () => {
  it("$pt sem nada: ordem padrao, sem filtros", () => {
    const { userId, query } = parsePantheonTokens("pt", []);
    expect(userId).toBeNull();
    expect(query).toEqual(emptyPantheonQuery());
    expect(hasActiveFilters(query)).toBe(false);
  });

  it("$ptw: genero feminino", () => {
    expect(parsePantheonTokens("ptw", []).query.gender).toBe("FEMALE");
    expect(parsePantheonTokens("pth", []).query.gender).toBe("MALE");
    expect(parsePantheonTokens("ptwh", []).query.gender).toBeUndefined();
  });

  it("$ptk=: ordena por Eter; $pty: so com selos; $pty!: almas gemeas; $pty-: sem selos", () => {
    expect(parsePantheonTokens("ptk=", []).query.sort).toBe("aether");
    expect(parsePantheonTokens("pty", []).query.keys).toBe("any");
    expect(parsePantheonTokens("pty!", []).query.keys).toBe("soulmates");
    expect(parsePantheonTokens("pty-", []).query.keys).toBe("none");
    expect(parsePantheonTokens("pty+", []).query.keys).toBeUndefined();
    expect(parsePantheonTokens("pty=", []).query.sort).toBe("keys");
    expect(parsePantheonTokens("pty!=", []).query.sort).toBe("soulmates");
  });

  it("outras ordenacoes e prioridade (Eter > selos > nome > ranks > serie)", () => {
    expect(parsePantheonTokens("pt==", []).query.sort).toBe("name");
    expect(parsePantheonTokens("ptr", []).query.sort).toBe("claimRank");
    expect(parsePantheonTokens("ptl", []).query.sort).toBe("likeRank");
    expect(parsePantheonTokens("ptrl", []).query.sort).toBe("avgRank");
    expect(parsePantheonTokens("pta", []).query.sort).toBe("series");
    expect(parsePantheonTokens("ptk=y=", []).query.sort).toBe("aether");
    expect(parsePantheonTokens("pt==a", []).query.sort).toBe("name");
  });

  it("universo e exibicao", () => {
    expect(parsePantheonTokens("ptg", []).query.universe).toBe("GAME");
    expect(parsePantheonTokens("ptg-", []).query.universe).toBe("ANIME");
    expect(parsePantheonTokens("ptgg-", []).query.universe).toBeUndefined();
    expect(parsePantheonTokens("ptk-r-l-v", []).query.display).toEqual({
      baseAether: true,
      claimRank: true,
      likeRank: true,
      compact: true,
    });
  });

  it("mencao escolhe o jogador e nao vira termo; $termo inclui, $--termo exclui", () => {
    const { userId, query } = parsePantheonTokens("ptw", [
      "<@123456789012345678>",
      "naruto",
      "$",
      "bleach",
      "$--one",
      "piece",
    ]);
    expect(userId).toBe("123456789012345678");
    expect(query.gender).toBe("FEMALE");
    expect(query.terms).toEqual(["naruto", "bleach"]);
    expect(query.excluded).toEqual(["one piece"]);
    expect(hasActiveFilters(query)).toBe(true);
  });

  it("o texto dos argumentos nao liga flags (no legado `zero two` ligava t, w, o...)", () => {
    const { query } = parsePantheonTokens("pantheon", ["zero", "two"]);
    expect(query.gender).toBeUndefined();
    expect(query.sort).toBe("default");
    expect(query.terms).toEqual(["zero two"]);
  });

  it("limita quantidade e tamanho dos termos", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`).join(" $ ");
    const { query } = parsePantheonTokens("pt", many.split(" "));
    expect(query.terms).toHaveLength(10);
    const long = parsePantheonTokens("pt", ["x".repeat(500)]).query.terms[0];
    expect(long).toHaveLength(80);
  });

  it("toPantheonQuery aceita termos extras", () => {
    const q = toPantheonQuery(parseFlags("w"), { terms: ["a"], excluded: ["b"] });
    expect(q).toMatchObject({ gender: "FEMALE", terms: ["a"], excluded: ["b"] });
  });
});

describe("queryFromSlash", () => {
  it("mapeia ordenar e genero; valores desconhecidos sao ignorados", () => {
    expect(queryFromSlash({ sort: "aether", gender: "MALE" })).toMatchObject({
      sort: "aether",
      gender: "MALE",
    });
    expect(queryFromSlash({ sort: "claim_rank" }).sort).toBe("claimRank");
    expect(queryFromSlash({ sort: "like_rank" }).sort).toBe("likeRank");
    expect(queryFromSlash({ sort: "drop table", gender: "ALIEN" })).toEqual(emptyPantheonQuery());
    expect(queryFromSlash({ sort: "__proto__" }).sort).toBe("default");
    expect(queryFromSlash({})).toEqual(emptyPantheonQuery());
  });
});
