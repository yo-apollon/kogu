import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_VARIANTS } from "../../../src/config/gacha.js";
import { registerFonts } from "../../../src/canvas/engine/fonts.js";
import { renderCard } from "../../../src/canvas/engine/renderer.js";
import { listSkins } from "../../../src/canvas/skins/registry.js";
import { buildSampleInput, createSyntheticLoader } from "../../../src/scripts/testCanvas.js";
import { aHash, GOLDEN_DIR, hamming } from "./helpers.js";

/**
 * Goldens perceptuais: aHash 16x16 (256 bits). Rasterizacao de fonte varia um pouco entre
 * plataformas, entao a tolerancia e de 24 bits (~9%). Mudanca visual intencional =>
 * `npx tsx src/scripts/testCanvas.ts --all --golden` e revisar as imagens antes de commitar.
 */
const TOLERANCE = Number(process.env.CANVAS_GOLDEN_TOLERANCE ?? 24);
const loader = createSyntheticLoader();

beforeAll(() => {
  registerFonts();
});

describe("goldens de carta", () => {
  let i = 0;
  const cases: Array<{ skin: string; variant: (typeof CARD_VARIANTS)[number]; index: number }> = [];
  for (const skin of listSkins()) for (const variant of CARD_VARIANTS) cases.push({ skin: skin.id, variant, index: i++ });

  for (const { skin, variant, index } of cases) {
    it(`${skin} / ${variant} confere com o golden`, async () => {
      const file = path.join(GOLDEN_DIR, `${skin}__${variant}.png`);
      expect(fs.existsSync(file), `golden ausente: ${file} (rode testCanvas --all --golden)`).toBe(true);
      const rendered = await renderCard(buildSampleInput(skin, variant, index), { loader, cache: false });
      const distance = hamming(await aHash(rendered), await aHash(fs.readFileSync(file)));
      expect(distance, `distancia de Hamming ${distance} > ${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  it("o aHash distingue skins diferentes (sanidade do golden)", async () => {
    const a = await aHash(await renderCard(buildSampleInput("classic", "STANDARD", 0), { loader, cache: false }));
    const b = await aHash(await renderCard(buildSampleInput("cinema-noir", "STANDARD", 0), { loader, cache: false }));
    expect(hamming(a, b)).toBeGreaterThan(TOLERANCE);
  });
});
