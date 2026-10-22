import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawAstral } from "../../../src/canvas/effects/astral.js";
import { drawFoil } from "../../../src/canvas/effects/foil.js";
import { drawHolo } from "../../../src/canvas/effects/holo.js";
import { drawGrain, hashSeed, mulberry32 } from "../../../src/canvas/effects/noise.js";
import { drawParticles } from "../../../src/canvas/effects/particles.js";
import { resolveTheme } from "../../../src/canvas/theme/tokens.js";
import { sha1 } from "./helpers.js";

const RECT = { x: 10, y: 10, w: 220, h: 300 };
const theme = resolveTheme("EPIC", "ASTRAL");

function render(draw: (g: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void): string {
  const c = createCanvas(240, 320);
  const g = c.getContext("2d");
  g.fillStyle = "#223344";
  g.fillRect(0, 0, 240, 320);
  draw(g);
  return sha1(c.toBuffer("image/png"));
}

describe("PRNG", () => {
  it("mulberry32 e deterministico e fica em [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, a);
    expect(seqA).toEqual(Array.from({ length: 50 }, b));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(Array.from({ length: 5 }, mulberry32(43))).not.toEqual(seqA.slice(0, 5));
  });

  it("hashSeed e estavel", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
  });
});

describe("efeitos", () => {
  const cases: Array<[string, (g: any, seed: number) => void]> = [
    ["grain", (g, seed) => drawGrain(g, RECT, seed)],
    ["particles", (g, seed) => drawParticles(g, RECT, { seed, count: 40 })],
    ["foil", (g, seed) => drawFoil(g, RECT, { seed, tint: theme.primary })],
    ["holo", (g, seed) => drawHolo(g, RECT, { seed })],
    ["astral", (g, seed) => drawAstral(g, RECT, { seed, theme })],
  ];

  for (const [name, fn] of cases) {
    it(`${name}: mesmo seed => mesmos pixels; seed diferente => pixels diferentes`, () => {
      const a = render((g) => fn(g, 1234));
      const b = render((g) => fn(g, 1234));
      const c = render((g) => fn(g, 9999));
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).not.toBe(render(() => {}));
    });
  }

  it("nao altera pixels fora do retangulo (clip/mascara)", () => {
    const c = createCanvas(240, 320);
    const g = c.getContext("2d");
    g.fillStyle = "#223344";
    g.fillRect(0, 0, 240, 320);
    drawHolo(g, RECT, { seed: 5 });
    const px = g.getImageData(0, 0, 1, 1).data;
    expect([px[0], px[1], px[2]]).toEqual([0x22, 0x33, 0x44]);
  });
});
