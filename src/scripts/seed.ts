import { db } from "../database/index.js";
import { entities } from "../database/schema.js";
import { eq } from "drizzle-orm";
import crypto from "crypto";

interface SeedItem {
  slug: string;
  name: string;
  anilistSearch?: string;
  staticImageUrl?: string;
  universe: string;
  type: "CHARACTER" | "WEAPON" | "COMPANION" | "DOMAIN";
  gender: "FEMALE" | "MALE" | "BOTH" | "ITEM";
  franchise: string;
  description: string;
  baseAether: number;
  popularityRank: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  baseHp: number;
}

const catalog: SeedItem[] = [
  // ================= ANIME & MANHWA (FEMININO) =================
  {
    slug: "zero-two",
    name: "Zero Two",
    anilistSearch: "Zero Two",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "DARLING in the FRANXX",
    description: "Híbrida Klaxosaur e piloto de elite conhecida como Partner Killer (Código: 002).",
    baseAether: 890,
    popularityRank: 1,
    baseAtk: 92,
    baseDef: 80,
    baseSpd: 94,
    baseHp: 95,
  },
  {
    slug: "rem",
    name: "Rem",
    anilistSearch: "Rem",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Re:Zero kara Hajimeru Isekai Seikatsu",
    description: "Empregada demônio da Mansão Roswaal, mestre da maça de correntes e magia de água.",
    baseAether: 860,
    popularityRank: 2,
    baseAtk: 88,
    baseDef: 82,
    baseSpd: 86,
    baseHp: 92,
  },
  {
    slug: "makima",
    name: "Makima",
    anilistSearch: "Makima",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Chainsaw Man",
    description: "Líder da Divisão Especial 4 de Caçadores de Demônios da Segurança Pública.",
    baseAether: 910,
    popularityRank: 3,
    baseAtk: 97,
    baseDef: 90,
    baseSpd: 92,
    baseHp: 98,
  },
  {
    slug: "frieren",
    name: "Frieren",
    anilistSearch: "Frieren",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Sousou no Frieren",
    description: "Maga elfa milenar do lendário Grupo dos Heróis que derrotou o Rei Demônio.",
    baseAether: 930,
    popularityRank: 4,
    baseAtk: 99,
    baseDef: 85,
    baseSpd: 88,
    baseHp: 96,
  },
  {
    slug: "mikasa-ackerman",
    name: "Mikasa Ackerman",
    anilistSearch: "Mikasa Ackerman",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Attack on Titan",
    description: "Soldado de elite da Divisão de Reconhecimento com linhagem despertada Ackerman.",
    baseAether: 840,
    popularityRank: 5,
    baseAtk: 95,
    baseDef: 84,
    baseSpd: 97,
    baseHp: 90,
  },
  {
    slug: "nezuko-kamado",
    name: "Nezuko Kamado",
    anilistSearch: "Nezuko Kamado",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Demon Slayer (Kimetsu no Yaiba)",
    description: "Portadora do Kekkijutsu das Chamas Explosivas Carmesins.",
    baseAether: 850,
    popularityRank: 6,
    baseAtk: 91,
    baseDef: 88,
    baseSpd: 92,
    baseHp: 94,
  },
  {
    slug: "power-csm",
    name: "Power",
    anilistSearch: "Power",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Chainsaw Man",
    description: "Infernal do Sangue da Divisão Especial 4 de Caçadores de Demônios.",
    baseAether: 830,
    popularityRank: 7,
    baseAtk: 89,
    baseDef: 78,
    baseSpd: 90,
    baseHp: 88,
  },
  {
    slug: "yor-forger",
    name: "Yor Forger",
    anilistSearch: "Yor Forger",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "SPY x FAMILY",
    description: "Assassina letal conhecida pelo codinome Thorn Princess.",
    baseAether: 845,
    popularityRank: 8,
    baseAtk: 96,
    baseDef: 82,
    baseSpd: 98,
    baseHp: 90,
  },

  // ================= ANIME & MANHWA (MASCULINO) =================
  {
    slug: "satoru-gojo",
    name: "Satoru Gojo",
    anilistSearch: "Satoru Gojo",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Jujutsu Kaisen",
    description: "O Feiticeiro Jujutsu mais forte da era moderna, portador dos Seis Olhos e do Ilimitado.",
    baseAether: 980,
    popularityRank: 9,
    baseAtk: 99,
    baseDef: 99,
    baseSpd: 98,
    baseHp: 100,
  },
  {
    slug: "sung-jinwoo",
    name: "Sung Jin-Woo",
    anilistSearch: "Jin-Woo Sung",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Solo Leveling",
    description: "O Monarca das Sombras, capaz de erguer um exército imortal com o comando 'Arise'.",
    baseAether: 960,
    popularityRank: 10,
    baseAtk: 99,
    baseDef: 94,
    baseSpd: 99,
    baseHp: 98,
  },
  {
    slug: "levi-ackerman",
    name: "Levi Ackerman",
    anilistSearch: "Levi",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Attack on Titan",
    description: "Capitão do Esquadrão de Operações Especiais, o soldado mais forte da humanidade.",
    baseAether: 900,
    popularityRank: 11,
    baseAtk: 97,
    baseDef: 88,
    baseSpd: 99,
    baseHp: 92,
  },
  {
    slug: "roronoa-zoro",
    name: "Roronoa Zoro",
    anilistSearch: "Roronoa Zoro",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "One Piece",
    description: "Espadachim dos Piratas do Chapéu de Palha e mestre do estilo Santoryu.",
    baseAether: 915,
    popularityRank: 12,
    baseAtk: 98,
    baseDef: 95,
    baseSpd: 91,
    baseHp: 99,
  },
  {
    slug: "monkey-d-luffy",
    name: "Monkey D. Luffy",
    anilistSearch: "Monkey D. Luffy",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "One Piece",
    description: "Capitão dos Chapéus de Palha e portador do despertar Gear 5 (Deus do Sol Nika).",
    baseAether: 950,
    popularityRank: 13,
    baseAtk: 99,
    baseDef: 96,
    baseSpd: 96,
    baseHp: 100,
  },
  {
    slug: "ryomen-sukuna",
    name: "Ryomen Sukuna",
    anilistSearch: "Sukuna",
    universe: "ANIME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Jujutsu Kaisen",
    description: "O Rei das Maldições da Era Heian, senhor do Santuário Malevolente.",
    baseAether: 975,
    popularityRank: 14,
    baseAtk: 99,
    baseDef: 98,
    baseSpd: 97,
    baseHp: 100,
  },

  // ================= GAMES =================
  {
    slug: "2b-nier",
    name: "YoRHa No.2 Type B (2B)",
    anilistSearch: "YoRHa No. 2 Type B",
    universe: "GAME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "NieR:Automata",
    description: "Androide de combate de elite criada pela força humana YoRHa.",
    baseAether: 880,
    popularityRank: 15,
    baseAtk: 94,
    baseDef: 86,
    baseSpd: 95,
    baseHp: 91,
  },
  {
    slug: "dante-sparda",
    name: "Dante",
    anilistSearch: "Dante",
    universe: "GAME",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Devil May Cry",
    description: "Lendário caçador de demônios e filho do Cavaleiro Negro Sparda.",
    baseAether: 885,
    popularityRank: 16,
    baseAtk: 97,
    baseDef: 92,
    baseSpd: 95,
    baseHp: 96,
  },
  {
    slug: "artoria-pendragon",
    name: "Saber (Artoria Pendragon)",
    anilistSearch: "Artoria Pendragon",
    universe: "GAME",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Fate/stay night & Fate/Grand Order",
    description: "Espírito Heroico do Rei dos Cavaleiros, portadora da espada sagrada Excalibur.",
    baseAether: 920,
    popularityRank: 17,
    baseAtk: 96,
    baseDef: 94,
    baseSpd: 92,
    baseHp: 97,
  },

  // ================= ARMAS LENDÁRIAS EQUIPÁVEIS ($ar) =================
  {
    slug: "excalibur",
    name: "Excalibur (Espada da Luz Prometida)",
    anilistSearch: "Artoria Pendragon",
    universe: "WEAPON",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Lendas Arturianas / Fate",
    description: "Artefato Divino Rank A++. Concede +120 ATK e +20% geração de Éter ao personagem equipado.",
    baseAether: 1100,
    popularityRank: 18,
    baseAtk: 120,
    baseDef: 45,
    baseSpd: 30,
    baseHp: 50,
  },
];

export async function fetchAniListImage(searchName: string): Promise<string | null> {
  try {
    const query = `
      query ($search: String) {
        Character(search: $search) {
          image { large }
        }
      }
    `;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { search: searchName } }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.data?.Character?.image?.large || null;
  } catch {
    return null;
  }
}

async function seed() {
  console.log("🌱 Buscando imagens reais em alta definição (CDN Oficial AniList)...");
  for (const item of catalog) {
    let imgUrl = item.staticImageUrl || null;
    if (item.anilistSearch) {
      imgUrl = await fetchAniListImage(item.anilistSearch);
    }

    const imagesArray = imgUrl ? [imgUrl] : [];
    const existing = await db.query.entities.findFirst({
      where: eq(entities.slug, item.slug),
    });

    if (existing) {
      db.update(entities)
        .set({
          name: item.name,
          universe: item.universe,
          type: item.type,
          gender: item.gender,
          franchise: item.franchise,
          description: item.description,
          imagesJson: JSON.stringify(imagesArray),
          baseAether: item.baseAether,
          popularityRank: item.popularityRank,
          baseAtk: item.baseAtk,
          baseDef: item.baseDef,
          baseSpd: item.baseSpd,
          baseHp: item.baseHp,
        })
        .where(eq(entities.slug, item.slug))
        .run();
      console.log(`🔄 Atualizado: ${item.name} -> ${imgUrl}`);
    } else {
      db.insert(entities)
        .values({
          id: crypto.randomUUID(),
          slug: item.slug,
          name: item.name,
          universe: item.universe,
          type: item.type,
          gender: item.gender,
          franchise: item.franchise,
          description: item.description,
          imagesJson: JSON.stringify(imagesArray),
          baseAether: item.baseAether,
          popularityRank: item.popularityRank,
          baseAtk: item.baseAtk,
          baseDef: item.baseDef,
          baseSpd: item.baseSpd,
          baseHp: item.baseHp,
        } as any)
        .run();
      console.log(`✨ Criado: ${item.name} -> ${imgUrl}`);
    }
  }

  console.log("✅ Catálogo 100% sincronizado com imagens reais do AniList!");
}

// Executa apenas quando chamado diretamente via CLI
if (process.argv[1]?.includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Erro no seed:", err);
      process.exit(1);
    });
}
