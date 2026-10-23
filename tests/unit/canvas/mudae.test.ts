import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { CARD_VARIANTS } from "../../../src/config/gacha.js";
import { hashSeed } from "../../../src/canvas/effects/noise.js";
import { registerFonts } from "../../../src/canvas/engine/fonts.js";
import { renderCard } from "../../../src/canvas/engine/renderer.js";
import { mudaeSkin } from "../../../src/canvas/skins/mudae.js";
import type { AssetBag, CardRenderContext } from "../../../src/canvas/skins/types.js";
import { resolveTheme } from "../../../src/canvas/theme/tokens.js";
import { buildSampleInput, createSyntheticLoader, makeSyntheticPortrait } from "../../../src/scripts/testCanvas.js";
import { percentile } from "./helpers.js";

const loader = createSyntheticLoader();
const assets: AssetBag = { fontsReady: true, get: () => undefined };
let portrait: Image;

function ctxFor(variant: (typeof CARD_VARIANTS)[number], withPortrait: boolean): CardRenderContext {
  return {
    name: "Ryuji Sakamoto",
    franchise: "Persona 5",
    universe: "GAME",
    tier: "RARE",
    variant,
    awakeningKeys: 8,
    aetherValue: 380,
    atk: 1,
    def: 1,
    spd: 1,
    locale: "en-US",
    portrait: withPortrait ? portrait : null,
    theme: resolveTheme("RARE", variant),
    seed: hashSeed(`x|${variant}`),
  };
}

beforeAll(async () => {
  registerFonts();
  portrait = await loadImage(await makeSyntheticPortrait(0));
  await renderCard(buildSampleInput("mudae", "STANDARD", 0), { loader, cache: false }); // warm-up
});

describe("skin mudae", () => {
  it("proporcao retrato ~0,64 (480x750)", () => {
    expect(mudaeSkin.size.w / mudaeSkin.size.h).toBeCloseTo(0.64, 2);
  });

  it("a arte nao desenha nenhum texto (com retrato)", () => {
    for (const variant of CARD_VARIANTS) {
      const canvas = createCanvas(mudaeSkin.size.w, mudaeSkin.size.h);
      const g = canvas.getContext("2d");
      const fill = vi.spyOn(g, "fillText");
      const stroke = vi.spyOn(g, "strokeText");
      for (const layer of mudaeSkin.layers) {
        g.save();
        void layer.draw(g, ctxFor(variant, true), assets);
        g.restore();
      }
      expect(fill, variant).not.toHaveBeenCalled();
      expect(stroke, variant).not.toHaveBeenCalled();
    }
  });

  it("cantos transparentes (recorte arredondado) e centro opaco", async () => {
    const webp = await renderCard(buildSampleInput("mudae", "STANDARD", 0), { loader, cache: false });
    const img = await loadImage(webp);
    const g = createCanvas(img.width, img.height).getContext("2d");
    g.drawImage(img, 0, 0);
    expect(g.getImageData(0, 0, 1, 1).data[3]).toBeLessThan(40);
    expect(g.getImageData(240, 375, 1, 1).data[3]).toBeGreaterThan(240);
  });

  it("sem retrato desenha o fallback (iniciais) sem lancar", async () => {
    const input = { ...buildSampleInput("mudae", "HOLO", 0), imageUrl: undefined, imageKey: undefined };
    const buf = await renderCard(input, { loader, cache: false });
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("variantes produzem imagens distintas", async () => {
    const hashes = new Set<string>();
    for (const variant of CARD_VARIANTS) {
      const buf = await renderCard({ ...buildSampleInput("mudae", variant, 0), tier: "COMMON" }, { loader, cache: false });
      hashes.add(buf.toString("base64"));
    }
    expect(hashes.size).toBe(CARD_VARIANTS.length);
  });

  it("orcamento de tempo: p95 < 80 ms apos warm-up", async () => {
    const budget = Number(process.env.CANVAS_P95_BUDGET_MS ?? (process.env.CI ? 200 : 80));
    const times: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const variant of CARD_VARIANTS) {
        const t0 = performance.now();
        await renderCard(buildSampleInput("mudae", variant, round), { loader, cache: false });
        times.push(performance.now() - t0);
      }
    }
    expect(percentile(times, 95)).toBeLessThan(budget);
  }, 30_000);
});
