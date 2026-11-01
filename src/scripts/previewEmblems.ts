/**
 * Gera previas dos emblemas originais em `.cache/test-cards/emblems/`:
 * um PNG por emblema x tier e uma folha de contato por emblema (5 tiers lado a lado).
 *
 *   npx tsx src/scripts/previewEmblems.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { ENTITY_TIERS } from "../config/gacha.js";
import { EMBLEM_KEYS, type EmblemKey } from "../canvas/emblems/index.js";
import { drawCard, type RenderCardInput } from "../canvas/engine/renderer.js";

const SAMPLE_NAME: Record<EmblemKey, string> = {
  sword: "Steel Sword",
  axe: "War Axe",
  hammer: "Great Hammer",
  staff: "Arcane Staff",
  shield: "Guardian Shield",
  bow: "Hunter Bow",
  gun: "Revolver",
  scythe: "Reaper Scythe",
  spear: "Long Spear",
  dagger: "Night Dagger",
  energy_blade: "Energy Blade",
  armor: "Knight Armor",
  ring: "Ancient Ring",
  book: "Old Grimoire",
  orb: "Crystal Orb",
  potion: "Healing Potion",
  crown: "Royal Crown",
  gem: "Rare Jewel",
  character: "Aiko Tanaka",
};

async function main(): Promise<void> {
  const out = path.resolve(".cache/test-cards/emblems");
  await fs.mkdir(out, { recursive: true });
  const thumbW = 192;
  const thumbH = 300;
  const cols = 5;
  const rows = Math.ceil(EMBLEM_KEYS.length / cols);
  const sheets = new Map<string, Canvas>();
  for (const tier of ENTITY_TIERS) {
    const sheet = createCanvas(cols * (thumbW + 10) + 10, rows * (thumbH + 10) + 10);
    const sg = sheet.getContext("2d");
    sg.fillStyle = "#2b2d31";
    sg.fillRect(0, 0, sheet.width, sheet.height);
    sheets.set(tier, sheet);
  }

  for (const [row, key] of EMBLEM_KEYS.entries()) {
    for (const tier of ENTITY_TIERS) {
      const input: RenderCardInput = {
        entityId: `emb-${key}`,
        name: SAMPLE_NAME[key],
        franchise: "Preview",
        universe: "ANIME",
        tier,
        variant: "STANDARD",
        aetherValue: 100,
        skinId: "mudae",
        entityType: key === "character" ? "CHARACTER" : "WEAPON",
        now: new Date("2026-01-01T00:00:00Z"),
      };
      const { canvas, plan } = await drawCard(input, { cache: false });
      if (plan.art.mode !== "EMBLEM" || plan.art.emblem !== key) {
        throw new Error(`${key}: arte resolvida inesperada ${JSON.stringify(plan.art)}`);
      }
      const png = await canvas.encode("png");
      await fs.writeFile(path.join(out, `${key}__${tier}.png`), png);
      const img = await loadImage(png);
      sheets.get(tier)!.getContext("2d").drawImage(img, 10 + (row % cols) * (thumbW + 10), 10 + Math.floor(row / cols) * (thumbH + 10), thumbW, thumbH);
    }
  }
  for (const [tier, sheet] of sheets) await fs.writeFile(path.join(out, `_overview_${tier}.png`), await sheet.encode("png"));
  console.log(`previas em ${out} (${EMBLEM_KEYS.length * ENTITY_TIERS.length} cartas + _overview_<TIER>.png)`);
}

void main();
