import { describe, expect, it } from "vitest";
import { nameTokens, normalizeName, slugify, stripHtml, trigramSimilarity } from "../../../src/lib/text/normalize.js";

describe("normalizeName", () => {
  it("remove acentos e diacriticos", () => {
    expect(normalizeName("Éowyn Ñandú Çelik")).toBe("eowyn nandu celik");
    expect(normalizeName("Hélène Müller")).toBe("helene muller");
  });
  it("remove pontuacao, minusculas e colapsa espacos", () => {
    expect(normalizeName("  Spider-Man:  The   Hero!! ")).toBe("spider man the hero");
    expect(normalizeName("D.Va")).toBe("d va");
    expect(normalizeName("O'Brien")).toBe("obrien");
  });
  it("converte fullwidth/compat (NFKD)", () => {
    expect(normalizeName("ＧＯＪＯ　Ｓａｔｏｒｕ")).toBe("gojo satoru");
  });
  it("preserva letras CJK e Hangul", () => {
    expect(normalizeName("五条 悟")).toBe("五条 悟");
    expect(normalizeName("ゴジョウ・サトル")).toBe("ゴジョウ サトル");
    expect(normalizeName("김철수")).toBe("김철수");
  });
  it("nao funde kana com dakuten (ガ != カ)", () => {
    expect(normalizeName("ガ")).toBe("ガ");
    expect(normalizeName("ガ")).not.toBe(normalizeName("カ"));
    expect(normalizeName("が")).toBe("が");
  });
  it("vazio", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("!!! ---")).toBe("");
  });
});

describe("nameTokens", () => {
  it("ordena tokens: ordem do nome nao importa", () => {
    expect(nameTokens("Gojo Satoru")).toEqual(nameTokens("Satoru Gojo"));
    expect(nameTokens("Satoru Gojo")).toEqual(["gojo", "satoru"]);
  });
  it("normaliza antes de tokenizar", () => {
    expect(nameTokens("Zoë-Ann  O'Neil")).toEqual(["ann", "oneil", "zoe"]);
  });
  it("CJK com espaco", () => {
    expect(nameTokens("悟 五条")).toEqual(nameTokens("五条 悟"));
  });
  it("vazio vira lista vazia", () => {
    expect(nameTokens("  ")).toEqual([]);
  });
});

describe("slugify", () => {
  it("gera a-z0-9 e hifens", () => {
    expect(slugify("Gojo Satoru")).toBe("gojo-satoru");
    expect(slugify("  Éowyn's Quest: Part II!! ")).toBe("eowyns-quest-part-ii");
    expect(slugify("A -- B __ C")).toBe("a-b-c");
  });
  it("e estavel e idempotente", () => {
    const s = slugify("Frieren: Beyond Journey's End");
    expect(slugify("Frieren: Beyond Journey's End")).toBe(s);
    expect(slugify(s)).toBe(s);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("CJK puro usa hash estavel distinto por nome", () => {
    const a = slugify("五条悟");
    expect(a).toMatch(/^n-[0-9a-f]{8}$/);
    expect(slugify("五条悟")).toBe(a);
    expect(slugify("夏油傑")).not.toBe(a);
  });
  it("respeita maxLength sem hifen final", () => {
    const s = slugify("aaaa bbbb cccc", 5);
    expect(s).toBe("aaaa");
    expect(s.length).toBeLessThanOrEqual(5);
  });
  it("vazio", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("trigramSimilarity", () => {
  it("identicos = 1, disjuntos = 0", () => {
    expect(trigramSimilarity("gojo", "gojo")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
  });
  it("vazio = 0", () => {
    expect(trigramSimilarity("", "gojo")).toBe(0);
    expect(trigramSimilarity("", "")).toBe(0);
  });
  it("bate com o valor conhecido do pg_trgm", () => {
    // similarity('word','two words') = 0.363636 no pg_trgm
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.3636, 3);
  });
  it("ignora acento/caixa/pontuacao e ordem entra via trigramas por palavra", () => {
    expect(trigramSimilarity("Éowyn", "eowyn")).toBe(1);
    expect(trigramSimilarity("Gojo Satoru", "Satoru Gojo")).toBe(1);
  });
  it("nomes parecidos > 0.85, diferentes < 0.4", () => {
    expect(trigramSimilarity("Roronoa Zoro", "Roronoa Zorro")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("Monkey D Luffy", "Monkey D. Luffy")).toBeGreaterThan(0.85);
    expect(trigramSimilarity("Naruto Uzumaki", "Sasuke Uchiha")).toBeLessThan(0.4);
  });
  it("funciona com CJK", () => {
    expect(trigramSimilarity("五条悟", "五条悟")).toBe(1);
    expect(trigramSimilarity("五条悟", "夏油傑")).toBe(0);
  });
});

describe("stripHtml", () => {
  it("remove tags e converte br/p em quebras", () => {
    expect(stripHtml("<p>Ola <b>mundo</b></p><br>Linha<br/>dois")).toBe("Ola mundo\n\nLinha\ndois");
    expect(stripHtml("Um<br>dois<br />tres")).toBe("Um\ndois\ntres");
  });
  it("converte entidades basicas sem decodificar duas vezes", () => {
    expect(stripHtml("Tom &amp; Jerry &lt;3 &quot;oi&quot; it&#39;s &#x41; &nbsp;fim")).toBe(
      'Tom & Jerry <3 "oi" it\'s A fim',
    );
    expect(stripHtml("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(stripHtml("&lt;b&gt;texto&lt;/b&gt;")).toBe("<b>texto</b>");
  });
  it("mantem entidade desconhecida ou invalida", () => {
    expect(stripHtml("a &foo; b &#99999999; c")).toBe("a &foo; b &#99999999; c");
  });
  it("remove spoilers do AniList", () => {
    expect(stripHtml("Antes ~!ele morre!~ depois")).toBe("Antes depois");
    expect(stripHtml("A ~!um\ndois!~ B ~!tres!~ C")).toBe("A B C");
  });
  it("spoiler sem fechamento corta ate o fim", () => {
    expect(stripHtml("Publico ~!segredo sem fim")).toBe("Publico");
  });
  it("remove script, style e comentarios", () => {
    expect(stripHtml("a<script>alert(1)</script>b<style>p{}</style>c<!-- x -->d")).toBe("abcd");
  });
  it("colapsa espacos e linhas em branco", () => {
    expect(stripHtml("a   b\n\n\n\n c")).toBe("a b\n\nc");
  });
});
