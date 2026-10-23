import { describe, expect, it } from "vitest";
import {
  isNameDuplicateSuspect,
  pickDuplicateSuspects,
  sameNameKey,
  TRIGRAM_DUPLICATE_THRESHOLD,
} from "../../../src/catalog/dedupe.js";

describe("dedupe por nome", () => {
  it("tokens ordenados e sem acento casam", () => {
    expect(sameNameKey("Satoru Gojo", "Gojo, Satoru")).toBe(true);
    expect(sameNameKey("Lelouch Lamperouge", "lelouch lamperouge")).toBe(true);
    expect(sameNameKey("Rem", "Ram")).toBe(false);
    expect(sameNameKey("???", "!!!")).toBe(false);
  });
  it("trigrama acima de 0.85 e suspeito; nomes diferentes nao", () => {
    expect(TRIGRAM_DUPLICATE_THRESHOLD).toBe(0.85);
    expect(isNameDuplicateSuspect("Light Yagami", "Light Yagami L")).toBe(true);
    expect(isNameDuplicateSuspect("Rem", "Ram")).toBe(false);
    expect(isNameDuplicateSuspect("Naruto Uzumaki", "Sasuke Uchiha")).toBe(false);
  });
  it("pickDuplicateSuspects filtra e respeita exclusoes", () => {
    const c = [
      { id: 1, name: "Gojo Satoru", nameNormalized: "gojo satoru" },
      { id: 2, name: "Geto Suguru", nameNormalized: "geto suguru" },
    ];
    expect(pickDuplicateSuspects("Satoru Gojo", c).map((x) => x.id)).toEqual([1]);
    expect(pickDuplicateSuspects("Satoru Gojo", c, [1])).toEqual([]);
  });
});


