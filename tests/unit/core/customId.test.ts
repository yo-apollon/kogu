import { describe, expect, it } from "vitest";
import {
  CUSTOM_ID_MAX_LENGTH,
  CustomIdError,
  decodeCustomId,
  encodeCustomId,
} from "../../../src/core/customId.js";

describe("customId", () => {
  it("codifica e decodifica ida e volta", () => {
    const id = encodeCustomId("sm", "pact", 123, 456n);
    expect(id).toBe("sm:pact:123:456");
    expect(decodeCustomId(id)).toEqual({ ns: "sm", parts: ["pact", "123", "456"] });
  });

  it("namespace sozinho nao tem partes", () => {
    expect(decodeCustomId("pg")).toEqual({ ns: "pg", parts: [] });
  });

  it("preserva partes vazias", () => {
    expect(decodeCustomId("a::b")).toEqual({ ns: "a", parts: ["", "b"] });
  });

  it("aceita exatamente 100 caracteres e rejeita 101", () => {
    const ok = encodeCustomId("ns", "x".repeat(CUSTOM_ID_MAX_LENGTH - 3));
    expect(ok).toHaveLength(CUSTOM_ID_MAX_LENGTH);
    expect(() => encodeCustomId("ns", "x".repeat(CUSTOM_ID_MAX_LENGTH - 2))).toThrow(CustomIdError);
  });

  it("rejeita separador dentro de parte e namespace invalido", () => {
    expect(() => encodeCustomId("ns", "a:b")).toThrow(CustomIdError);
    expect(() => encodeCustomId("n:s")).toThrow(CustomIdError);
    expect(() => encodeCustomId("")).toThrow(CustomIdError);
    expect(() => encodeCustomId("ns com espaco")).toThrow(CustomIdError);
  });

  it("decode devolve null para entradas invalidas", () => {
    expect(decodeCustomId("")).toBeNull();
    expect(decodeCustomId(":abc")).toBeNull();
    expect(decodeCustomId("x".repeat(101))).toBeNull();
    expect(decodeCustomId("bad ns:1")).toBeNull();
  });
});
