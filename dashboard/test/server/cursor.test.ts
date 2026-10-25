import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, InvalidCursorError, parseCursorParam } from "@/server/cursor";

describe("cursor", () => {
  it("round-trip", () => {
    for (const c of [{ v: "abc", id: "9" }, { v: 12.5, id: 7 }]) {
      expect(decodeCursor(encodeCursor(c))).toEqual(c);
    }
  });
  it("e base64url (sem + / =)", () => {
    expect(encodeCursor({ v: "???>>>", id: "~~" })).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  it.each([
    ["lixo", "%%%"],
    ["nao e json", b64("nope")],
    ["campo extra", b64(JSON.stringify({ v: 1, id: 2, x: 3 }))],
    ["tipo errado", b64(JSON.stringify({ v: { a: 1 }, id: 2 }))],
    ["id ausente", b64(JSON.stringify({ v: 1 }))],
    ["gigante", "A".repeat(600)],
    ["vazio", ""],
  ])("adulterado (%s) => InvalidCursorError", (_n, raw) => {
    expect(() => decodeCursor(raw)).toThrow(InvalidCursorError);
  });
  it("bit flip no meio", () => {
    const enc = encodeCursor({ v: "abc", id: "1" });
    const bad = enc.slice(0, 4) + (enc[4] === "A" ? "B" : "A") + enc.slice(5);
    try {
      decodeCursor(bad);
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidCursorError);
    }
  });
  it("parseCursorParam", () => {
    expect(parseCursorParam(undefined)).toBeNull();
    expect(parseCursorParam("")).toBeNull();
    expect(() => parseCursorParam("!!")).toThrow(InvalidCursorError);
  });
});