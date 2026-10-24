import { afterEach, describe, expect, it, vi } from "vitest";

// O logger le o ambiente ao ser importado; silencia o aviso esperado do teste de KV fora do ar.
vi.hoisted(() => {
  process.env.LOG_LEVEL = "silent";
});

import { MemoryStore } from "../../../src/infra/redis/memoryStore.js";
import {
  autocompleteEntities,
  AUTOCOMPLETE_LIMIT,
  entityRefValue,
  findWishEntry,
  matchByName,
  parseEntityRef,
  searchTerms,
  STARWISH_LIMIT,
  WISH_LIMIT,
  type EntityHit,
  type WishEntry,
} from "../../../src/modules/wishlist/service.js";

const stores: MemoryStore[] = [];
const newKv = () => {
  const kv = new MemoryStore();
  stores.push(kv);
  return kv;
};
afterEach(async () => {
  await Promise.all(stores.splice(0).map((kv) => kv.quit()));
});

const hit = (id: number, name: string, seriesTitle: string | null = null): EntityHit => ({
  id,
  name,
  seriesTitle,
  baseAether: 100,
});

function entry(entityId: number, name: string, isStarwish = false): WishEntry {
  return {
    entityId,
    name,
    seriesTitle: null,
    franchiseName: null,
    baseAether: 100,
    isStarwish,
    createdAt: new Date(0),
  };
}

describe("limites", () => {
  it("a lista cabe no limite e os estelares sao um subconjunto", () => {
    expect(WISH_LIMIT).toBeGreaterThan(0);
    expect(STARWISH_LIMIT).toBeGreaterThan(0);
    expect(STARWISH_LIMIT).toBeLessThanOrEqual(WISH_LIMIT);
    expect(AUTOCOMPLETE_LIMIT).toBe(25);
  });
});

describe("parseEntityRef / entityRefValue", () => {
  it("id:N vira referencia exata; o resto e texto", () => {
    expect(parseEntityRef("id:123")).toEqual({ kind: "id", id: 123 });
    expect(parseEntityRef("  id:7 ")).toEqual({ kind: "id", id: 7 });
    expect(parseEntityRef("Zero Two")).toEqual({ kind: "text", text: "Zero Two" });
    expect(parseEntityRef("id:abc")).toEqual({ kind: "text", text: "id:abc" });
    expect(parseEntityRef("id:")).toEqual({ kind: "text", text: "id:" });
    expect(parseEntityRef("id:1234567890123456")).toEqual({
      kind: "text",
      text: "id:1234567890123456",
    });
  });

  it("ida e volta", () => {
    expect(parseEntityRef(entityRefValue(42))).toEqual({ kind: "id", id: 42 });
  });
});

describe("searchTerms", () => {
  it("normaliza como name_normalized: sem acento, minusculas, tokens ordenados", () => {
    expect(searchTerms("Zero  Two")).toEqual({ key: "two zero", tokens: ["two", "zero"] });
    expect(searchTerms("Émilia")).toEqual({ key: "emilia", tokens: ["emilia"] });
    expect(searchTerms("O'Brien")).toEqual({ key: "obrien", tokens: ["obrien"] });
  });

  it("curingas e pontuacao nao sobram (nao viram LIKE)", () => {
    expect(searchTerms("100%_\\")).toEqual({ key: "100", tokens: ["100"] });
    expect(searchTerms("%%%")).toEqual({ key: "", tokens: [] });
    expect(searchTerms("   ")).toEqual({ key: "", tokens: [] });
  });

  it("limita a quantidade de tokens", () => {
    expect(searchTerms("a b c d e f g h i j").tokens).toHaveLength(6);
  });
});

describe("matchByName / findWishEntry", () => {
  const list = [entry(1, "Zero Two"), entry(2, "Rem"), entry(3, "Remilia Scarlet", true)];

  it("igualdade de tokens vence a substring", () => {
    expect(findWishEntry(list, "rem")?.entityId).toBe(2);
    expect(findWishEntry(list, "two zero")?.entityId).toBe(1);
  });

  it("substring com todos os tokens; escolhe a mais parecida", () => {
    expect(findWishEntry(list, "remil")?.entityId).toBe(3);
    expect(findWishEntry(list, "scarlet remilia")?.entityId).toBe(3);
    expect(findWishEntry(list, "zero")?.entityId).toBe(1);
  });

  it("id:N procura pelo entityId; sem correspondencia devolve undefined", () => {
    expect(findWishEntry(list, "id:3")?.name).toBe("Remilia Scarlet");
    expect(findWishEntry(list, "id:99")).toBeUndefined();
    expect(findWishEntry(list, "xyz")).toBeUndefined();
    expect(findWishEntry(list, "   ")).toBeUndefined();
  });

  it("matchByName e generico", () => {
    expect(matchByName(["Alfa Beta", "Gama"], "beta alfa", (s) => s)).toBe("Alfa Beta");
    expect(matchByName([], "x", (s: string) => s)).toBeUndefined();
  });
});

describe("autocompleteEntities", () => {
  it("cacheia por 60 s: a mesma consulta normalizada nao busca de novo", async () => {
    const kv = newKv();
    const search = vi.fn(async () => [hit(1, "Zero Two", "Darling in the FranXX")]);

    const a = await autocompleteEntities(kv, "zero two", false, { search });
    const b = await autocompleteEntities(kv, "  TWO   zero ", false, { search });
    expect(a).toEqual(b);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("zero two", {
      allowAdult: false,
      limit: AUTOCOMPLETE_LIMIT,
      popularWhenShort: true,
    });
    const ttl = await kv.pttl("cache:ac:entity:n:two zero");
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it("chaves separadas para adulto e nao adulto e por consulta", async () => {
    const kv = newKv();
    const search = vi.fn(async () => [hit(1, "X")]);
    await autocompleteEntities(kv, "rem", false, { search });
    await autocompleteEntities(kv, "rem", true, { search });
    await autocompleteEntities(kv, "ram", false, { search });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("cache de lista vazia tambem vale (nao refaz a consulta)", async () => {
    const kv = newKv();
    const search = vi.fn(async () => [] as EntityHit[]);
    await autocompleteEntities(kv, "nada", false, { search });
    await autocompleteEntities(kv, "nada", false, { search });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("KV fora do ar nao derruba o autocomplete: consulta o banco direto", async () => {
    const kv = newKv();
    vi.spyOn(kv, "get").mockRejectedValue(new Error("redis fora"));
    const search = vi.fn(async () => [hit(1, "Zero Two")]);
    const result = await autocompleteEntities(kv, "zero", false, { search });
    expect(result.map((h) => h.name)).toEqual(["Zero Two"]);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
