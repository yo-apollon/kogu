/**
 * Seed das 44 Lendas do UFC, Futebol, Basquete (NBA) e Música Mundial.
 *
 * Execução:
 *   npx tsx src/scripts/seedPopCultureAndSports.ts
 */
import postgres from "postgres";
import { TIER_WEIGHT, type EntityTier } from "../config/gacha.js";
import { normalizeName, slugify } from "../lib/text/normalize.js";
import fs from "node:fs";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

interface LegendEntry {
  slug: string;
  name: string;
  franchise: string;
  series: string;
  tier: EntityTier;
  gender: "MALE" | "FEMALE" | "OTHER";
  aether: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  desc: string;
  imageUrl: string;
}

export async function seedPopCultureAndSports(dbUrl = DATABASE_URL) {
  const manifestPath = "C:/Users/Apollon/.gemini/antigravity/brain/37bf8420-9cc0-4038-bfbf-d0e4d2aa73d8/scratch/legends_manifest.json";
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifesto não encontrado em ${manifestPath}`);
  }

  const legends: LegendEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });

  console.log(`Conectado ao banco. Inserindo ${legends.length} lendas do esporte e música...`);
  let inserted = 0;

  await sql.begin(async (tx) => {
    const [maxRankRow] = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(popularity_rank), 1400)::int AS max FROM entities
    `;
    let nextRank = maxRankRow?.max ?? 1400;

    for (const item of legends) {
      const slug = item.slug;
      const norm = normalizeName(item.name);
      const franchiseSlug = slugify(item.franchise);

      // 1. Franquia
      const [fr] = await tx<{ id: number }[]>`
        INSERT INTO franchises (slug, name)
        VALUES (${franchiseSlug}, ${item.franchise})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id::int
      `;

      // 2. Série
      const seriesSlug = slugify(item.series);
      const [sr] = await tx<{ id: number }[]>`
        INSERT INTO series (slug, title, franchise_id, universe, media_type)
        VALUES (${seriesSlug}, ${item.series}, ${fr.id}, 'CINEMA', 'OTHER')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
        RETURNING id::int
      `;

      // 3. Checa se já existe
      const existing = await tx<{ id: number }[]>`
        SELECT id::int FROM entities WHERE slug = ${slug} LIMIT 1
      `;
      if (existing.length > 0) continue;

      nextRank++;
      const rollWeight = TIER_WEIGHT[item.tier];
      const hostedImg = `https://yo-apollon.github.io/kogu/assets/cards/${item.slug}.jpg`;

      // 4. Entidade
      const [ent] = await tx<{ id: number }[]>`
        INSERT INTO entities (
          slug, name, name_native, name_normalized, universe, type, gender, status,
          tier, franchise_id, description, base_aether, roll_weight, popularity_rank,
          base_atk, base_def, base_spd, base_hp, stats_seed
        ) VALUES (
          ${slug}, ${item.name}, ${item.name}, ${norm}, 'CINEMA', 'CHARACTER', ${item.gender}, 'ACTIVE',
          ${item.tier}, ${fr.id}, ${item.desc}, ${item.aether}, ${rollWeight}, ${nextRank},
          ${item.atk}, ${item.def}, ${item.spd}, ${item.hp}, ${nextRank}
        )
        RETURNING id::int
      `;

      // 5. Associação Série
      await tx`
        INSERT INTO entity_series (entity_id, series_id, is_primary)
        VALUES (${ent.id}, ${sr.id}, true)
        ON CONFLICT DO NOTHING
      `;

      // 6. Imagem Primária
      await tx`
        INSERT INTO entity_images (entity_id, url, source, is_primary, status)
        VALUES (${ent.id}, ${hostedImg}, 'MANUAL', true, 'ACTIVE')
      `;

      inserted++;
    }
  });

  console.log(`Sucesso: ${inserted} novas cartas de Esportes e Música adicionadas ao catálogo!`);
  await sql.end();
  return inserted;
}

if (import.meta.url.endsWith("seedPopCultureAndSports.ts")) {
  seedPopCultureAndSports().catch((err) => {
    console.error("Erro ao rodar seedPopCultureAndSports:", err);
    process.exit(1);
  });
}
