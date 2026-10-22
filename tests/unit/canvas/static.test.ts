import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSourceFiles, SRC_CANVAS_DIR } from "./helpers.js";

const rel = (f: string) => path.relative(SRC_CANVAS_DIR, f).replaceAll("\\", "/");
const all = listSourceFiles(SRC_CANVAS_DIR);
const skinFiles = listSourceFiles(path.join(SRC_CANVAS_DIR, "skins"), (f) => !f.endsWith("types.ts") && !f.endsWith("registry.ts"));
const pureDrawFiles = [
  ...skinFiles,
  ...listSourceFiles(path.join(SRC_CANVAS_DIR, "effects")),
  ...listSourceFiles(path.join(SRC_CANVAS_DIR, "engine", "draw")),
];

describe("regras estaticas do canvas", () => {
  it("nenhum arquivo de src/canvas usa Math.random (so PRNG semeado)", () => {
    const offenders = all.filter((f) => /Math\s*\.\s*random/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("skins nao declaram cores literais (apenas tokens)", () => {
    // literais de cor em string: "#abc", "rgba(...)", "hsl(...)"; chamadas rgba(token, a) sao permitidas
    const literal = /["'`]#[0-9a-fA-F]{3,8}["'`]|["'`]\s*(?:rgba?|hsla?)\s*\(/;
    const offenders = skinFiles.filter((f) => literal.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("skins, efeitos e helpers de desenho nao fazem rede nem I/O", () => {
    const forbidden = /\bfetch\s*\(|loadImage\s*\(|node:(?:fs|http|https|net)|\bhttps?:\/\/|imageLoader/;
    const offenders = pureDrawFiles.filter((f) => forbidden.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("skins importam cores so de theme/tokens", () => {
    for (const f of skinFiles) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, rel(f)).toMatch(/theme\/tokens\.js/);
    }
  });
});
