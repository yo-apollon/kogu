import { describe, expect, it } from "vitest";
import {
  evaluateEntity,
  DEFAULT_FAVORITES_FLOOR,
  type QuarantineInput,
  type QuarantineOptions,
} from "../../../src/catalog/quarantine.js";

const ok: QuarantineInput = {
  name: "Rem", nameNormalized: "rem", gender: "FEMALE", hasImage: true, isAdult: false,
  isRealPerson: false, sourceFavorites: 5000, source: "ANILIST",
};
const opts: QuarantineOptions = { allowAdult: false, favoritesFloor: DEFAULT_FAVORITES_FLOOR };
const reasons = (i: Partial<QuarantineInput>, o: Partial<QuarantineOptions> = {}) =>
  evaluateEntity({ ...ok, ...i }, { ...opts, ...o });

describe("evaluateEntity", () => {
  it("passa em todas as regras => ACTIVE", () => {
    expect(reasons({})).toEqual({ status: "ACTIVE", findings: [] });
  });
  it("sem imagem => QUARANTINED NO_IMAGE", () => {
    const v = reasons({ hasImage: false });
    expect(v.status).toBe("QUARANTINED");
    expect(v.findings.map((f) => f.reason)).toEqual(["NO_IMAGE"]);
  });
  it("genero UNKNOWN => UNKNOWN_GENDER", () => {
    expect(reasons({ gender: "UNKNOWN" }).findings[0].reason).toBe("UNKNOWN_GENDER");
  });
  it("adulto so passa com permissao", () => {
    expect(reasons({ isAdult: true }).findings[0].reason).toBe("ADULT_CONTENT");
    expect(reasons({ isAdult: true }, { allowAdult: true }).status).toBe("ACTIVE");
  });
  it("nome fora de 2..64 caracteres ou sem letras", () => {
    expect(reasons({ name: "A", nameNormalized: "a" }).findings[0].reason).toBe("INVALID_NAME");
    expect(reasons({ name: "x".repeat(65) }).findings[0].reason).toBe("INVALID_NAME");
    expect(reasons({ name: "x".repeat(64) }).status).toBe("ACTIVE");
    expect(reasons({ name: "???", nameNormalized: "" }).findings[0].reason).toBe("INVALID_NAME");
  });
  it("piso de favoritos configuravel por fonte", () => {
    expect(reasons({ sourceFavorites: 3 }).findings[0].reason).toBe("LOW_FAVORITES");
    expect(reasons({ sourceFavorites: 3 }, { favoritesFloor: { ANILIST: 1 } }).status).toBe("ACTIVE");
    expect(reasons({ sourceFavorites: 0, source: "IGDB" }).status).toBe("ACTIVE");
  });
  it("pessoa real e duplicata vao para PENDING_REVIEW", () => {
    expect(reasons({ isRealPerson: true }).status).toBe("PENDING_REVIEW");
    const v = reasons({ duplicateOf: [9] });
    expect(v.status).toBe("PENDING_REVIEW");
    expect(v.findings[0]).toMatchObject({ reason: "DUPLICATE_SUSPECT", otherEntityId: 9 });
  });
  it("motivos dispensados por moderador nao contam", () => {
    const v = reasons({ isRealPerson: true }, { waivedReasons: new Set(["REAL_PERSON"]) });
    expect(v.status).toBe("ACTIVE");
  });
  it("acumula varios motivos; revisao humana prevalece", () => {
    const v = reasons({ hasImage: false, isRealPerson: true });
    expect(v.status).toBe("PENDING_REVIEW");
    expect(v.findings.map((f) => f.reason)).toEqual(["NO_IMAGE", "REAL_PERSON"]);
  });
});
