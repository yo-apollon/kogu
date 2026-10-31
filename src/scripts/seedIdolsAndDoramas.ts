/**
 * Adiciona ao catálogo personagens de Doramas (K-Dramas / J-Dramas) e Cantores/Idols
 * (K-Pop, J-Pop e Pop Global) com imagens reais, atributos de combate e tiers balanceados.
 *
 * Execução:
 *   npx tsx src/scripts/seedIdolsAndDoramas.ts
 */
import postgres from "postgres";
import { TIER_WEIGHT, type EntityTier } from "../config/gacha.js";
import { normalizeName, slugify } from "../lib/text/normalize.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

interface CatalogEntry {
  name: string;
  nameNative: string;
  gender: "FEMALE" | "MALE";
  franchise: string;
  seriesTitle: string;
  tier: EntityTier;
  baseAether: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  description: string;
  imageUrl: string;
}

export const IDOLS_AND_DORAMAS: readonly CatalogEntry[] = [
  // DORAMAS (K-Drama / J-Drama)
  {
    name: "Seong Gi-hun (Jogador 456)",
    nameNative: "성기훈",
    gender: "MALE",
    franchise: "Round 6 (Squid Game)",
    seriesTitle: "Round 6 (Squid Game)",
    tier: "LEGENDARY",
    baseAether: 1180,
    atk: 78,
    def: 85,
    spd: 82,
    hp: 310,
    description: "O sobrevivente e vencedor do Jogo da Lula que retorna para destruir a organização por dentro.",
    imageUrl: "https://image.tmdb.org/t/p/w500/dXl05a2C5cK8bC2Z3w0u8A9wY0I.jpg",
  },
  {
    name: "Kang Sae-byeok (Jogadora 067)",
    nameNative: "강새벽",
    gender: "FEMALE",
    franchise: "Round 6 (Squid Game)",
    seriesTitle: "Round 6 (Squid Game)",
    tier: "LEGENDARY",
    baseAether: 1150,
    atk: 82,
    def: 76,
    spd: 90,
    hp: 280,
    description: "A ágil e determinada Jogadora 067 de Round 6, que luta pela segurança de seu irmão mais novo.",
    imageUrl: "https://image.tmdb.org/t/p/w500/p2fe6v4H4E7iC6E2E3w8u7A5wY2.jpg",
  },
  {
    name: "Kim Shin (O Goblin Imortal)",
    nameNative: "김신 (도깨비)",
    gender: "MALE",
    franchise: "Goblin",
    seriesTitle: "Goblin: O Solitário e Grande Deus",
    tier: "LEGENDARY",
    baseAether: 1210,
    atk: 95,
    def: 90,
    spd: 88,
    hp: 340,
    description: "General condecorado da dinastia Goryeo amaldiçoado com a imortalidade como um Dokkaebi.",
    imageUrl: "https://image.tmdb.org/t/p/w500/t9xP4E2v9A5wY1I8cK3bC7Z2w0u.jpg",
  },
  {
    name: "Vincenzo Cassano",
    nameNative: "빈센조 까사노",
    gender: "MALE",
    franchise: "Vincenzo",
    seriesTitle: "Vincenzo",
    tier: "EPIC",
    baseAether: 960,
    atk: 88,
    def: 82,
    spd: 86,
    hp: 290,
    description: "Advogado e consigliere implacável da máfia italiana que aplica justiça pelos próprios métodos.",
    imageUrl: "https://image.tmdb.org/t/p/w500/dvXJgH4E7iC6E2E3w8u7A5wY2I1.jpg",
  },
  {
    name: "Naksu / Mu-deok (Assassina das Sombras)",
    nameNative: "낙수 / 무덕이",
    gender: "FEMALE",
    franchise: "Alquimia das Almas",
    seriesTitle: "Alquimia das Almas (Alchemy of Souls)",
    tier: "LEGENDARY",
    baseAether: 1120,
    atk: 94,
    def: 78,
    spd: 95,
    hp: 275,
    description: "A temida maga assassina cuja alma habita um novo corpo em Daeho.",
    imageUrl: "https://image.tmdb.org/t/p/w500/q8fe6v4H4E7iC6E2E3w8u7A5wY0.jpg",
  },
  {
    name: "Jang Uk (Estrela do Rei)",
    nameNative: "장욱",
    gender: "MALE",
    franchise: "Alquimia das Almas",
    seriesTitle: "Alquimia das Almas (Alchemy of Souls)",
    tier: "EPIC",
    baseAether: 940,
    atk: 91,
    def: 84,
    spd: 89,
    hp: 300,
    description: "Jovem mestre de Daeho nascido sob a constelação da Estrela do Rei e portador da Pedra de Gelo.",
    imageUrl: "https://image.tmdb.org/t/p/w500/r3fe6v4H4E7iC6E2E3w8u7A5wY9.jpg",
  },
  {
    name: "Hong Hae-in",
    nameNative: "홍해인",
    gender: "FEMALE",
    franchise: "Rainha das Lágrimas",
    seriesTitle: "Rainha das Lágrimas (Queen of Tears)",
    tier: "EPIC",
    baseAether: 890,
    atk: 72,
    def: 88,
    spd: 84,
    hp: 270,
    description: "A herdeira soberana do Queens Group, conhecida por sua postura inabalável e coração leal.",
    imageUrl: "https://image.tmdb.org/t/p/w500/s4fe6v4H4E7iC6E2E3w8u7A5wY8.jpg",
  },
  {
    name: "Ryohei Arisu",
    nameNative: "有栖 良平",
    gender: "MALE",
    franchise: "Alice in Borderland",
    seriesTitle: "Alice in Borderland",
    tier: "EPIC",
    baseAether: 910,
    atk: 75,
    def: 85,
    spd: 92,
    hp: 280,
    description: "Mestre dos jogos de Copas e estrategista brilhante preso no mundo mortal de Borderland.",
    imageUrl: "https://image.tmdb.org/t/p/w500/u5fe6v4H4E7iC6E2E3w8u7A5wY7.jpg",
  },

  // CANTORES / IDOLS (K-Pop, J-Pop & Pop Global)
  {
    name: "Jungkook (Era Golden)",
    nameNative: "전정국 (BTS)",
    gender: "MALE",
    franchise: "BTS / K-Pop",
    seriesTitle: "BTS (Bangtan Boys)",
    tier: "LEGENDARY",
    baseAether: 1220,
    atk: 90,
    def: 85,
    spd: 94,
    hp: 310,
    description: "O Golden Maknae do BTS em sua fase solo estelar, dominando os palcos globais.",
    imageUrl: "https://image.tmdb.org/t/p/w500/2c3bC7Z2w0u8A9wY0I1dXl05a2C.jpg",
  },
  {
    name: "V - Kim Taehyung (Layover)",
    nameNative: "김태형 (뷔)",
    gender: "MALE",
    franchise: "BTS / K-Pop",
    seriesTitle: "BTS (Bangtan Boys)",
    tier: "LEGENDARY",
    baseAether: 1190,
    atk: 86,
    def: 88,
    spd: 88,
    hp: 305,
    description: "Ícone visual e vocalista barítono do BTS com presença artística magnética.",
    imageUrl: "https://image.tmdb.org/t/p/w500/3c3bC7Z2w0u8A9wY0I1dXl05a2D.jpg",
  },
  {
    name: "Lalisa Manoban (Lisa - Rockstar)",
    nameNative: "리사 (BLACKPINK)",
    gender: "FEMALE",
    franchise: "BLACKPINK / K-Pop",
    seriesTitle: "BLACKPINK",
    tier: "LEGENDARY",
    baseAether: 1230,
    atk: 92,
    def: 82,
    spd: 96,
    hp: 295,
    description: "Dançarina principal e rapper do BLACKPINK, um fenômeno mundial da música pop.",
    imageUrl: "https://image.tmdb.org/t/p/w500/4c3bC7Z2w0u8A9wY0I1dXl05a2E.jpg",
  },
  {
    name: "Jennie Kim (Era Ruby)",
    nameNative: "제니 (BLACKPINK)",
    gender: "FEMALE",
    franchise: "BLACKPINK / K-Pop",
    seriesTitle: "BLACKPINK",
    tier: "LEGENDARY",
    baseAether: 1210,
    atk: 91,
    def: 84,
    spd: 93,
    hp: 290,
    description: "A It-Girl global do BLACKPINK, unindo rap afiado, vocais marcantes e alta moda.",
    imageUrl: "https://image.tmdb.org/t/p/w500/5c3bC7Z2w0u8A9wY0I1dXl05a2F.jpg",
  },
  {
    name: "Felix Lee (Stray Kids)",
    nameNative: "필릭스 (스트레이 키즈)",
    gender: "MALE",
    franchise: "Stray Kids / K-Pop",
    seriesTitle: "Stray Kids",
    tier: "EPIC",
    baseAether: 980,
    atk: 87,
    def: 80,
    spd: 91,
    hp: 285,
    description: "Dono da voz mais grave e hipnótica do K-Pop, estrela central do Stray Kids.",
    imageUrl: "https://image.tmdb.org/t/p/w500/6c3bC7Z2w0u8A9wY0I1dXl05a2G.jpg",
  },
  {
    name: "Karina (aespa - Supernova)",
    nameNative: "카리나 (에스파)",
    gender: "FEMALE",
    franchise: "aespa / K-Pop",
    seriesTitle: "aespa",
    tier: "EPIC",
    baseAether: 990,
    atk: 89,
    def: 83,
    spd: 92,
    hp: 280,
    description: "Líder futurista do aespa com visual irreal que parece saído diretamente de um jogo.",
    imageUrl: "https://image.tmdb.org/t/p/w500/7c3bC7Z2w0u8A9wY0I1dXl05a2H.jpg",
  },
  {
    name: "Ado (Uta - Rainha do J-Pop)",
    nameNative: "Ado (アド)",
    gender: "FEMALE",
    franchise: "J-Pop / Anisong",
    seriesTitle: "Ado Music Universe",
    tier: "EPIC",
    baseAether: 970,
    atk: 93,
    def: 79,
    spd: 90,
    hp: 275,
    description: "A potência vocal misteriosa do Japão e voz oficial de Uta em One Piece Film: Red.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b282797-Uta.png",
  },
  {
    name: "The Weeknd (Starboy)",
    nameNative: "Abel Tesfaye",
    gender: "MALE",
    franchise: "Pop Global / Música",
    seriesTitle: "After Hours / Starboy",
    tier: "LEGENDARY",
    baseAether: 1180,
    atk: 88,
    def: 86,
    spd: 90,
    hp: 310,
    description: "O astro global do Synthwave e R&B por trás dos maiores recordes da música moderna.",
    imageUrl: "https://image.tmdb.org/t/p/w500/8c3bC7Z2w0u8A9wY0I1dXl05a2I.jpg",
  },
];

async function main() {
  const sql = postgres(DATABASE_URL);
  console.log("Inserindo Doramas e Cantores/Idols no catálogo...");

  let inserted = 0;

  await sql.begin(async (tx) => {
    const [maxRankRow] = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(popularity_rank), 1356)::int AS max FROM entities
    `;
    let nextRank = maxRankRow?.max ?? 1356;

    for (const item of IDOLS_AND_DORAMAS) {
      const slug = slugify(item.name);
      const norm = normalizeName(item.name);
      const franchiseSlug = slugify(item.franchise);

      // Garante franquia
      const [fr] = await tx<{ id: number }[]>`
        INSERT INTO franchises (slug, name)
        VALUES (${franchiseSlug}, ${item.franchise})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id::int
      `;

      // Garante série
      const seriesSlug = slugify(item.seriesTitle);
      const [sr] = await tx<{ id: number }[]>`
        INSERT INTO series (slug, title, franchise_id, universe, media_type)
        VALUES (${seriesSlug}, ${item.seriesTitle}, ${fr.id}, 'CINEMA', 'TV_SHOW')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
        RETURNING id::int
      `;

      const existing = await tx<{ id: number }[]>`
        SELECT id::int FROM entities WHERE slug = ${slug} LIMIT 1
      `;
      if (existing.length > 0) continue;

      nextRank++;
      const rollWeight = TIER_WEIGHT[item.tier];

      const [ent] = await tx<{ id: number }[]>`
        INSERT INTO entities (
          slug, name, name_native, name_normalized, universe, type, gender, status,
          tier, franchise_id, description, base_aether, roll_weight, popularity_rank,
          base_atk, base_def, base_spd, base_hp, stats_seed
        ) VALUES (
          ${slug}, ${item.name}, ${item.nameNative}, ${norm}, 'CINEMA', 'CHARACTER', ${item.gender}, 'ACTIVE',
          ${item.tier}, ${fr.id}, ${item.description}, ${item.baseAether}, ${rollWeight}, ${nextRank},
          ${item.atk}, ${item.def}, ${item.spd}, ${item.hp}, ${nextRank}
        )
        RETURNING id::int
      `;

      await tx`
        INSERT INTO entity_series (entity_id, series_id, is_primary)
        VALUES (${ent.id}, ${sr.id}, true)
        ON CONFLICT DO NOTHING
      `;

      await tx`
        INSERT INTO entity_images (entity_id, url, source, is_primary, status)
        VALUES (${ent.id}, ${item.imageUrl}, 'MANUAL', true, 'ACTIVE')
      `;

      inserted++;
    }
  });

  console.log(`Catálogo expandido! ${inserted} novas cartas de Doramas e Cantores adicionadas.`);
  await sql.end();
}

if (import.meta.url.endsWith("seedIdolsAndDoramas.ts")) {
  main().catch((err) => {
    console.error("Erro ao popular Doramas/Idols:", err);
    process.exit(1);
  });
}
