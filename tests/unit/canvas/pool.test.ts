import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getCardCache } from "../../../src/canvas/engine/cache.js";
import { canvasPoolMode, canvasPoolStats, renderCardInPool, renderCharacterCard, shutdownCanvasPool } from "../../../src/canvas/engine/pool.js";
import { renderCard } from "../../../src/canvas/engine/renderer.js";
import { buildSampleInput } from "../../../src/scripts/testCanvas.js";
import { sha1 } from "./helpers.js";

// Sem imagem remota: o worker/fetcher padrao so aceita https na allowlist.
const input = { ...buildSampleInput("classic", "HOLO", 0), imageUrl: undefined, imageKey: undefined };

beforeEach(() => {
  getCardCache().clear();
});

afterAll(async () => {
  delete process.env.CANVAS_POOL;
  await shutdownCanvasPool();
});

describe("pool de render", () => {
  it("em dev (TS, modo auto) usa render in-process e devolve o mesmo resultado de renderCard", async () => {
    delete process.env.CANVAS_POOL;
    expect(canvasPoolMode()).toMatchObject({ mode: "auto", enabled: false });
    const viaPool = await renderCardInPool(input);
    const direct = await renderCard(input, { cache: false });
    expect(sha1(viaPool)).toBe(sha1(direct));
    expect(canvasPoolStats().completed).toBe(0);
  });

  it("CANVAS_POOL=off desliga o pool", () => {
    process.env.CANVAS_POOL = "off";
    expect(canvasPoolMode().enabled).toBe(false);
  });

  it("renderCardInPool usa o cache de carta pronta", async () => {
    delete process.env.CANVAS_POOL;
    const a = await renderCardInPool(input);
    const b = await renderCardInPool(input);
    expect(b).toBe(a);
  });

  it("renderCharacterCard mantem a interface legada (universe string, sem tier)", async () => {
    delete process.env.CANVAS_POOL;
    const buf = await renderCharacterCard({
      name: "Zero Two",
      franchise: "DARLING in the FRANXX",
      universe: "anime",
      variant: "ASTRAL",
      awakeningKeys: 3,
      aetherValue: 890,
      ownerName: "Apollon",
      popularityRank: 1,
      atk: 92,
      def: 80,
      spd: 94,
      isWish: true,
    });
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});
