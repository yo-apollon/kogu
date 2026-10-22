import { beforeAll, describe, expect, it } from "vitest";
import { CARD_VARIANTS } from "../../../src/config/gacha.js";
import { CardCache } from "../../../src/canvas/engine/cache.js";
import { registerFonts } from "../../../src/canvas/engine/fonts.js";
import { drawCard, planCard, renderCard } from "../../../src/canvas/engine/renderer.js";
import { listSkins } from "../../../src/canvas/skins/registry.js";
import { buildSampleInput, createSyntheticLoader } from "../../../src/scripts/testCanvas.js";
import { percentile, sha1 } from "./helpers.js";

const loader = createSyntheticLoader();

beforeAll(async () => {
  registerFonts();
  await renderCard(buildSampleInput("classic", "STANDARD", 0), { loader, cache: false }); // warm-up
});

describe("renderCard", () => {
  it("fontes empacotadas estao presentes", () => {
    const s = registerFonts();
    expect(s.missing).toEqual([]);
    expect(registerFonts()).toBe(s); // idempotente
  });

  it("saida e WebP valido", async () => {
    const buf = await renderCard(buildSampleInput("classic", "FOIL", 1), { loader, cache: false });
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("determinismo: mesmo contexto => mesmo hash de buffer (todas as skins x variantes)", async () => {
    let i = 0;
    for (const skin of listSkins()) {
      for (const variant of CARD_VARIANTS) {
        const input = buildSampleInput(skin.id, variant, i++);
        const a = await renderCard(input, { loader, cache: false });
        const b = await renderCard(input, { loader, cache: false });
        expect(sha1(a), `${skin.id}/${variant}`).toBe(sha1(b));
      }
    }
  });

  it("contextos diferentes => imagens diferentes", async () => {
    const base = buildSampleInput("classic", "HOLO", 0);
    const a = await renderCard(base, { loader, cache: false });
    for (const change of [{ variant: "ASTRAL" as const }, { tier: "MYTHIC" as const }, { ownerName: "Outro" }, { aetherValue: 9999 }, { awakeningKeys: 9 }, { skinId: "game-hud" }]) {
      const b = await renderCard({ ...base, ...change }, { loader, cache: false });
      expect(sha1(b), JSON.stringify(change)).not.toBe(sha1(a));
    }
  });

  it("cache de carta pronta: segunda chamada e hit e devolve o mesmo buffer", async () => {
    const cache = new CardCache();
    const input = buildSampleInput("anime-neon", "ASTRAL", 3);
    const a = await renderCard(input, { loader, cache });
    const b = await renderCard(input, { loader, cache });
    expect(b).toBe(a);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
    await renderCard({ ...input, ownerName: "Novo Dono" }, { loader, cache });
    expect(cache.stats.misses).toBe(2);
  });

  it("chave de cache: muda com skin@versao, variante, tier, chaves, eter, dono e locale", () => {
    const base = buildSampleInput("classic", "FOIL", 0);
    const key = planCard(base).key;
    expect(planCard({ ...base }).key).toBe(key);
    for (const change of [{ skinId: "game-hud" }, { variant: "HOLO" as const }, { tier: "MYTHIC" as const }, { awakeningKeys: 7 }, { aetherValue: 1 }, { ownerName: "x" }, { locale: "en-US" }, { imageKey: "outra" }]) {
      expect(planCard({ ...base, ...change }).key, JSON.stringify(change)).not.toBe(key);
    }
  });

  it("sem retrato desenha o fallback e NAO cacheia quando a imagem pedida falhou", async () => {
    const cache = new CardCache();
    const input = { ...buildSampleInput("classic", "STANDARD", 0), imageUrl: "synthetic://nao-numerico" };
    const drawn = await drawCard(input, { loader });
    expect(drawn.complete).toBe(false);
    await renderCard(input, { loader, cache });
    await renderCard(input, { loader, cache });
    expect(cache.stats.hits).toBe(0);
    const noImage = { ...input, imageUrl: undefined, imageKey: undefined };
    await renderCard(noImage, { loader, cache });
    await renderCard(noImage, { loader, cache });
    expect(cache.stats.hits).toBe(1);
  });

  it("nomes CJK, longos e vazios renderizam sem lancar", async () => {
    for (const name of ["五条悟", "x".repeat(300), "", "🔥 Emoji 🔥", "A\nB"]) {
      const buf = await renderCard({ ...buildSampleInput("cinema-noir", "STANDARD", 0), name, franchise: name }, { loader, cache: false });
      expect(buf.length).toBeGreaterThan(1000);
    }
  });

  it("tamanho de saida < 400 KB em todas as combinacoes", async () => {
    let i = 0;
    for (const skin of listSkins()) {
      for (const variant of CARD_VARIANTS) {
        const buf = await renderCard(buildSampleInput(skin.id, variant, i++), { loader, cache: false });
        expect(buf.length, `${skin.id}/${variant}`).toBeLessThan(400 * 1024);
      }
    }
  });

  it("orcamento de tempo: p95 < 80 ms por carta apos warm-up", async () => {
    // Em CI (runners lentos/compartilhados) a tolerancia dobra; ajuste via CANVAS_P95_BUDGET_MS.
    const budget = Number(process.env.CANVAS_P95_BUDGET_MS ?? (process.env.CI ? 200 : 80));
    const times: number[] = [];
    let i = 0;
    for (let round = 0; round < 2; round++) {
      for (const skin of listSkins()) {
        for (const variant of CARD_VARIANTS) {
          const input = buildSampleInput(skin.id, variant, i++);
          const t0 = performance.now();
          await renderCard(input, { loader, cache: false });
          times.push(performance.now() - t0);
        }
      }
    }
    expect(percentile(times, 95)).toBeLessThan(budget);
  }, 30_000);
});
