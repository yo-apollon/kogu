import { renderCharacterCard } from "../canvas/cardRenderer.js";
import fs from "fs";
import path from "path";

async function testCanvas() {
  console.log("🎨 Testando renderização de cartas dinâmicas...");
  const buffer = await renderCharacterCard({
    name: "Zero Two",
    franchise: "DARLING in the FRANXX",
    universe: "ANIME",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b124381-2gAVq76HPfL2.png",
    variant: "ASTRAL",
    awakeningKeys: 3,
    aetherValue: 890,
    ownerName: "Apollon",
    popularityRank: 1,
    atk: 92,
    def: 80,
    spd: 94,
  });

  const outputPath = path.resolve("./test-card.png");
  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ Carta gerada com sucesso (${buffer.length} bytes): ${outputPath}`);
}

testCanvas().catch(console.error);


