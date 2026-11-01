/**
 * Script de expansão do catálogo de entidades do Arqon para ~1000+ cartas.
 * 
 * Regras do projeto (AGENTS.md):
 * - Entidades só entram no sorteio com status = 'ACTIVE' e gênero diferente de UNKNOWN.
 * - Suporte total a todos os universos (ANIME, GAME, CINEMA) e tipos (CHARACTER, WEAPON).
 * - Sem SELECT * no caminho crítico.
 * - Idempotente: não duplica slugs nem sobrescreve dados de jogo existentes.
 * 
 * Execução:
 *   npx tsx src/scripts/expandCatalog1000.ts [--migrate]
 */
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

const SQLITE_PATH = path.resolve("arqon_local.db");

interface AniListChar {
  id: number;
  name: { full: string; native?: string | null };
  image: { large?: string | null };
  gender?: string | null;
  favourites?: number | null;
  description?: string | null;
  media?: {
    nodes?: Array<{
      title?: { english?: string | null; romaji?: string | null };
      type?: string | null;
    }>;
  };
}

interface CuratedEntity {
  name: string;
  originalName?: string;
  slug: string;
  universe: "ANIME" | "GAME" | "CINEMA";
  type: "CHARACTER" | "WEAPON";
  gender: "FEMALE" | "MALE" | "ITEM";
  franchise: string;
  description: string;
  imageUrl: string;
  baseAether: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
}

// ---------------------------------------------------------------------------
// Curadoria Especial de Armas Lendárias para o comando $ar
// ---------------------------------------------------------------------------
const CURATED_WEAPONS: CuratedEntity[] = [
  {
    name: "Zangetsu (Lâmina Cortadora da Lua)",
    originalName: "斬月",
    slug: "zangetsu-bleach",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Bleach",
    description: "A icônica Zanpakuto de Ichigo Kurosaki, manifestação de seu imenso poder espiritual e da técnica Getsuga Tenshou.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b911-KgzOcvf4jhOh.png",
    baseAether: 950,
    atk: 96,
    def: 78,
    spd: 88,
    hp: 95,
  },
  {
    name: "Senbonzakura (Mil Pétalas de Cerejeira)",
    originalName: "千本桜",
    slug: "senbonzakura-bleach",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Bleach",
    description: "A lendária Zanpakuto de Byakuya Kuchiki. Sua lâmina se dispersa em milhares de pequenas lâminas brilhantes como pétalas.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/27387.jpg",
    baseAether: 900,
    atk: 92,
    def: 82,
    spd: 94,
    hp: 95,
  },
  {
    name: "Ea (Espada da Ruptura - Enuma Elish)",
    originalName: "乖離剣・エア",
    slug: "ea-enuma-elish",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Fate/stay night",
    description: "O Fantasma Nobre primordial de Gilgamesh. Capaz de girar seus três cilindros e romper o próprio tecido da realidade.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b2514-hnE6LEdqm7Su.png",
    baseAether: 1250,
    atk: 99,
    def: 90,
    spd: 85,
    hp: 100,
  },
  {
    name: "Caderno da Morte (Death Note)",
    originalName: "デスノート",
    slug: "death-note-item",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Death Note",
    description: "Caderno sobrenatural do Reino dos Shinigamis. O humano cujo nome for escrito neste caderno morrerá.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b75-IkEpzO21LgFy.jpg",
    baseAether: 1100,
    atk: 99,
    def: 60,
    spd: 90,
    hp: 90,
  },
  {
    name: "Dragon Slayer (Matadora de Dragões)",
    originalName: "ドラゴンころし",
    slug: "dragon-slayer-berserk",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Berserk",
    description: "Um bloco colossal de ferro empunhado por Guts, temperado pelo sangue de milhares de apóstolos e demônios.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b422-CqQ8vM3k4QPu.png",
    baseAether: 1150,
    atk: 98,
    def: 88,
    spd: 75,
    hp: 95,
  },
  {
    name: "Lança de Longinus",
    originalName: "ロンギヌスの槍",
    slug: "spear-of-longinus",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Neon Genesis Evangelion",
    description: "Artefato alienígena divino capaz de perfurar qualquer Campo A.T. absoluto e iniciar o Terceiro Impacto.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b85-iI1vE9vUeG9R.png",
    baseAether: 1200,
    atk: 97,
    def: 85,
    spd: 92,
    hp: 95,
  },
  {
    name: "Dominator (Sistema Sibyl)",
    originalName: "ドミネーター",
    slug: "dominator-psycho-pass",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Psycho-Pass",
    description: "Arma oficial do Departamento de Segurança Pública, calibrada para julgar o Coeficiente Criminal instantaneamente.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b68147-3vK3b3v8eL6f.png",
    baseAether: 850,
    atk: 90,
    def: 70,
    spd: 95,
    hp: 90,
  },
  {
    name: "Lâmina Tesoura (Scissor Blade)",
    originalName: "断ち切りバサミ",
    slug: "scissor-blade-kill-la-kill",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Kill la Kill",
    description: "Espada forjada em fibra de vida endurecida empunhada por Ryuko Matoi, capaz de cortar através de Uniformes Goku.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b83797-h7b3v8eL6f4m.png",
    baseAether: 890,
    atk: 91,
    def: 75,
    spd: 93,
    hp: 90,
  },
  {
    name: "Buster Sword",
    originalName: "バスターソード",
    slug: "buster-sword-ff7",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Final Fantasy VII",
    description: "A gigantesca espada larga passada de Angeal para Zack e de Zack para Cloud Strife. Símbolo de honra e sonhos.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b456-aqvvhzG5aUXV.png",
    baseAether: 1100,
    atk: 95,
    def: 86,
    spd: 80,
    hp: 95,
  },
  {
    name: "Yamato (Lâmina Dimensional)",
    originalName: "閻魔刀",
    slug: "yamato-dmc",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Devil May Cry",
    description: "A katana demoníaca forjada por Sparda e empunhada por Vergil, capaz de rasgar o espaço-tempo e abrir portais dimensionais.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b12359-utQI3ScA2WE5.png",
    baseAether: 1200,
    atk: 99,
    def: 80,
    spd: 99,
    hp: 95,
  },
  {
    name: "Rebellion (Espada do Despertar)",
    originalName: "リベリオン",
    slug: "rebellion-dmc",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Devil May Cry",
    description: "A lendária espada claymore dada a Dante por seu pai Sparda, catalisadora de sua forma Devil Trigger.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/n2880-gaED0etMoJSk.png",
    baseAether: 1150,
    atk: 96,
    def: 85,
    spd: 90,
    hp: 95,
  },
  {
    name: "Master Sword (A Lâmina que Bane o Mal)",
    originalName: "マスターソード",
    slug: "master-sword-zelda",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "The Legend of Zelda",
    description: "Espada sagrada criada pela deusa Hylia e imbuída com o poder de selar a escuridão absoluta através das eras.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b4201-VySa1vLuUcwb.jpg",
    baseAether: 1250,
    atk: 98,
    def: 92,
    spd: 91,
    hp: 100,
  },
  {
    name: "Lâminas do Caos (Blades of Chaos)",
    originalName: "Blades of Chaos",
    slug: "blades-of-chaos-gow",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "God of War",
    description: "Par de lâminas com correntes fundidas à carne de Kratos pelo Deus da Guerra Ares. Queimam com o fogo eterno do Tártaro.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.png",
    baseAether: 1200,
    atk: 99,
    def: 75,
    spd: 96,
    hp: 95,
  },
  {
    name: "Machado Leviatã (Leviathan Axe)",
    originalName: "Leviathan Axe",
    slug: "leviathan-axe-gow",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "God of War",
    description: "Machado forjado pelos irmãos Huldra com o poder gélido de vinte espíritos do gelo para combater o martelo Mjölnir.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.png",
    baseAether: 1180,
    atk: 97,
    def: 89,
    spd: 82,
    hp: 95,
  },
  {
    name: "Moonlight Greatsword (Espada da Luz da Lua)",
    originalName: "月光の大剣",
    slug: "moonlight-greatsword-souls",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Dark Souls",
    description: "Espada arcana lendária que brilha com a luz límpida da lua cheia, disparando ondas cortantes de magia pura.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b89362-ibkc0eoECaW1.png",
    baseAether: 1100,
    atk: 95,
    def: 84,
    spd: 86,
    hp: 95,
  },
  {
    name: "Kingdom Key (Keyblade)",
    originalName: "キングダムチェーン",
    slug: "kingdom-key-kh",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Kingdom Hearts",
    description: "A misteriosa chave blade empunhada por Sora, capaz de trancar a escuridão do coração dos mundos.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/n8084-NBuMgyoPFSCJ.jpg",
    baseAether: 1050,
    atk: 90,
    def: 90,
    spd: 90,
    hp: 95,
  },
  {
    name: "Virtuous Contract (Contrato Virtuoso)",
    originalName: "白の契約",
    slug: "virtuous-contract-nier",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "NieR:Automata",
    description: "A elegante espada branca de samurai empunhada pela androide 2B em sua eterna missão pela humanidade.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b132494-R05zeZPjDG3l.jpg",
    baseAether: 980,
    atk: 93,
    def: 78,
    spd: 95,
    hp: 90,
  },
  {
    name: "Mjolnir (Martelo do Trovão)",
    originalName: "Mjölnir",
    slug: "mjolnir-hammer",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Marvel",
    description: "Forjado no coração de uma estrela cadente com metal Uru. Apenas aqueles que forem dignos podem empunhar seu poder.",
    imageUrl: "https://image.tmdb.org/t/p/w500/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg",
    baseAether: 1200,
    atk: 98,
    def: 92,
    spd: 85,
    hp: 100,
  },
  {
    name: "Sabre de Luz de Anakin Skywalker",
    originalName: "Anakin's Lightsaber",
    slug: "anakin-lightsaber",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Star Wars",
    description: "O lendário sabre de luz de lâmina azul construído pelo Escolhido, empunhado através de gerações de Cavaleiros Jedi.",
    imageUrl: "https://image.tmdb.org/t/p/w500/xfSAoBEm9MNBjmlNcDYLvLSMlnq.jpg",
    baseAether: 1100,
    atk: 96,
    def: 88,
    spd: 95,
    hp: 95,
  },
  {
    name: "Andúril (Chama do Ocidente)",
    originalName: "Flame of the West",
    slug: "anduril-flame-west",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "The Lord of the Rings",
    description: "Forjada novamente a partir dos fragmentos de Narsil, a espada que cortou o Um Anel da mão de Sauron.",
    imageUrl: "https://image.tmdb.org/t/p/w500/6oom5QYQ2yQTMJIbnvbkBL9cDK6.jpg",
    baseAether: 1080,
    atk: 94,
    def: 86,
    spd: 88,
    hp: 95,
  },
];

// ---------------------------------------------------------------------------
// Curadoria Especial de Personagens de CINEMA para $mc, $wc, $hc
// ---------------------------------------------------------------------------
const CURATED_CINEMA: CuratedEntity[] = [
  {
    name: "Batman (O Cavaleiro das Trevas)",
    originalName: "Bruce Wayne",
    slug: "batman-dc",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "DC Comics",
    description: "O vigilante de Gotham City. Com inteligência genial, artes marciais e vontade inabalável, é o maior detetive do mundo.",
    imageUrl: "https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
    baseAether: 1200,
    atk: 94,
    def: 95,
    spd: 91,
    hp: 99,
  },
  {
    name: "O Coringa (Joker)",
    originalName: "The Joker",
    slug: "joker-dc",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "DC Comics",
    description: "O Palhaço do Crime. Um gênio caótico que personifica a anarquia e o lado sombrio da mente humana em Gotham.",
    imageUrl: "https://image.tmdb.org/t/p/w500/udDclJoHjfjb8Ekgsd4FDteOkCU.jpg",
    baseAether: 1100,
    atk: 88,
    def: 80,
    spd: 93,
    hp: 95,
  },
  {
    name: "Homem de Ferro (Iron Man)",
    originalName: "Tony Stark",
    slug: "iron-man-marvel",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Marvel",
    description: "Gênio, bilionário, playboy e filantropo. Criador da lendária armadura Mark com reator arc acoplado ao peito.",
    imageUrl: "https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg",
    baseAether: 1250,
    atk: 97,
    def: 96,
    spd: 94,
    hp: 98,
  },
  {
    name: "Thor Odinson (Deus do Trovão)",
    originalName: "Thor Odinson",
    slug: "thor-marvel",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Marvel",
    description: "Príncipe de Asgard e mestre das tempestades, trovões e relâmpagos através dos Nove Reinos cósmicos.",
    imageUrl: "https://image.tmdb.org/t/p/w500/prSfAi1xGrhLQNxVSUFh61xQ4Qy.jpg",
    baseAether: 1220,
    atk: 98,
    def: 94,
    spd: 90,
    hp: 100,
  },
  {
    name: "Thanos (O Titã Louco)",
    originalName: "Thanos",
    slug: "thanos-marvel",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Marvel",
    description: "Senhor da guerra cósmico determinado a equilibrar o universo recolhendo as seis Joias do Infinito na Manopla.",
    imageUrl: "https://image.tmdb.org/t/p/w500/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg",
    baseAether: 1300,
    atk: 99,
    def: 99,
    spd: 88,
    hp: 100,
  },
  {
    name: "Feiticeira Escarlate (Scarlet Witch)",
    originalName: "Wanda Maximoff",
    slug: "scarlet-witch-marvel",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Marvel",
    description: "Conjuradora da lendária Magia do Caos capaz de alterar as probabilidades e reescrever a própria realidade.",
    imageUrl: "https://image.tmdb.org/t/p/w500/ijWWwINc8h71NQ8j1LTJMFSj5wr.jpg",
    baseAether: 1280,
    atk: 99,
    def: 86,
    spd: 92,
    hp: 95,
  },
  {
    name: "Viúva Negra (Black Widow)",
    originalName: "Natasha Romanoff",
    slug: "black-widow-marvel",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Marvel",
    description: "A mais letal espiã e assassina graduada na Sala Vermelha, mestre absoluta em combate corpo a corpo e infiltração.",
    imageUrl: "https://image.tmdb.org/t/p/w500/kwB7d51AIcyzPOBOHLCEZJkmPhQ.jpg",
    baseAether: 980,
    atk: 90,
    def: 82,
    spd: 97,
    hp: 92,
  },
  {
    name: "Darth Vader (Lorde Sith)",
    originalName: "Anakin Skywalker",
    slug: "darth-vader-star-wars",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Star Wars",
    description: "Comandante supremo da Frota Imperial e Lorde Negro dos Sith, empunhando o Lado Sombrio da Força galáctica.",
    imageUrl: "https://image.tmdb.org/t/p/w500/nNAeTmF4CtdSgMDplXTDPOpYzsX.jpg",
    baseAether: 1280,
    atk: 98,
    def: 95,
    spd: 85,
    hp: 99,
  },
  {
    name: "Princesa Leia Organa",
    originalName: "Leia Organa",
    slug: "princess-leia-star-wars",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "FEMALE",
    franchise: "Star Wars",
    description: "Líder destemida da Aliança Rebelde e General da Resistência, armada de coragem inabalável e sensibilidade à Força.",
    imageUrl: "https://image.tmdb.org/t/p/w500/6FfCtAuVAW8XJjZ7eWeLibRLWTw.jpg",
    baseAether: 1050,
    atk: 88,
    def: 88,
    spd: 90,
    hp: 95,
  },
  {
    name: "Luke Skywalker (Mestre Jedi)",
    originalName: "Luke Skywalker",
    slug: "luke-skywalker-star-wars",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "Star Wars",
    description: "O último dos grandes Mestres Jedi, herói que redimiu seu pai Darth Vader e destruiu a temível Estrela da Morte.",
    imageUrl: "https://image.tmdb.org/t/p/w500/tEQlCGiiWvMvfD7Sz8d99Pouy39.jpg",
    baseAether: 1220,
    atk: 96,
    def: 92,
    spd: 94,
    hp: 98,
  },
  {
    name: "John Wick (O Bicho-Papão)",
    originalName: "Jardani Jovonovich",
    slug: "john-wick-cinema",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "John Wick",
    description: "Assassino lendário conhecido como Baba Yaga. Homem de foco implacável, compromisso e pura força de vontade.",
    imageUrl: "https://image.tmdb.org/t/p/w500/vZloFAK7NmvMGKE7VkF5UHaz0I.jpg",
    baseAether: 1150,
    atk: 97,
    def: 89,
    spd: 96,
    hp: 96,
  },
  {
    name: "Neo (O Escolhido)",
    originalName: "Thomas Anderson",
    slug: "neo-matrix",
    universe: "CINEMA",
    type: "CHARACTER",
    gender: "MALE",
    franchise: "The Matrix",
    description: "O Escolhido profetizado para libertar a humanidade da simulação da Matrix, capaz de dobrar as regras físicas do sistema.",
    imageUrl: "https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    baseAether: 1240,
    atk: 98,
    def: 93,
    spd: 99,
    hp: 98,
  },
];

async function fetchAniListAnime(db: Database.Database, existingSlugs: Set<string>): Promise<number> {
  console.log("\n📡 [1/3] Importando Top Personagens de ANIME (Páginas 7 a 17 da AniList)...");
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 50) {
        characters(sort: FAVOURITES_DESC) {
          id
          name { full native }
          image { large }
          gender
          favourites
          description
          media(sort: POPULARITY_DESC, perPage: 1) {
            nodes {
              title { english romaji }
              type
            }
          }
        }
      }
    }
  `;

  const insertStmt = db.prepare(`
    INSERT INTO entities (
      id, slug, name, original_name, universe, type, gender, franchise,
      description, images_json, base_aether, popularity_rank,
      base_atk, base_def, base_spd, base_hp, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
  `);

  let inserted = 0;

  for (let page = 7; page <= 17; page++) {
    let success = false;
    let attempts = 0;

    while (!success && attempts < 5) {
      attempts++;
      try {
        const res = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables: { page } }),
        });

        if (res.status === 429) {
          const retry = parseInt(res.headers.get("retry-after") || "60", 10);
          console.log(`⏳ AniList Rate Limit na página ${page}, aguardando ${retry}s...`);
          await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
          continue;
        }

        if (!res.ok) {
          console.warn(`⚠️ Página ${page} falhou com status ${res.status}`);
          break;
        }

        const json: any = await res.json();
        const characters: AniListChar[] = json.data?.Page?.characters || [];

        for (const char of characters) {
          const fullName = char.name?.full;
          if (!fullName || !char.image?.large) continue;

          // Regra estrita: nunca sortear gênero desconhecido
          if (char.gender !== "Male" && char.gender !== "Female") continue;
          const gender = char.gender === "Male" ? "MALE" : "FEMALE";

          const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          if (existingSlugs.has(slug)) continue;

          const mediaNode = char.media?.nodes?.[0];
          const franchise = mediaNode?.title?.english || mediaNode?.title?.romaji || "Universo Anime";
          const favs = Number(char.favourites || 100);
          const calculatedAether = Math.min(1300, Math.max(150, Math.round(180 + Math.sqrt(favs) * 4.2)));

          const cleanDesc = (char.description || "").replace(/<[^>]*>?/gm, "").slice(0, 240);
          const imagesJson = JSON.stringify([char.image.large]);

          insertStmt.run(
            crypto.randomUUID(),
            slug,
            fullName,
            char.name?.native || null,
            "ANIME",
            "CHARACTER",
            gender,
            franchise,
            cleanDesc,
            imagesJson,
            calculatedAether,
            99999,
            Math.min(99, 70 + Math.round(calculatedAether / 40)),
            Math.min(99, 68 + Math.round(calculatedAether / 42)),
            Math.min(99, 72 + Math.round(calculatedAether / 38)),
            95
          );

          existingSlugs.add(slug);
          inserted++;
        }

        console.log(`  ✓ Página ${page}/17 concluída (+${characters.length} buscados, ${inserted} novos inseridos)`);
        success = true;
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        console.error(`Erro ao buscar página ${page}:`, err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  return inserted;
}

async function fetchAniListGames(db: Database.Database, existingSlugs: Set<string>): Promise<number> {
  console.log("\n🎮 [2/3] Importando Personagens de GAMES Adaptados (AniList source: VIDEO_GAME)...");
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 25) {
        media(source: VIDEO_GAME, sort: POPULARITY_DESC) {
          id
          title { english romaji }
          characters(sort: FAVOURITES_DESC, perPage: 10) {
            nodes {
              id
              name { full native }
              image { large }
              gender
              favourites
              description
            }
          }
        }
      }
    }
  `;

  const insertStmt = db.prepare(`
    INSERT INTO entities (
      id, slug, name, original_name, universe, type, gender, franchise,
      description, images_json, base_aether, popularity_rank,
      base_atk, base_def, base_spd, base_hp, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
  `);

  let inserted = 0;

  for (let page = 1; page <= 4; page++) {
    let success = false;
    let attempts = 0;

    while (!success && attempts < 5) {
      attempts++;
      try {
        const res = await fetch("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables: { page } }),
        });

        if (res.status === 429) {
          const retry = parseInt(res.headers.get("retry-after") || "60", 10);
          console.log(`⏳ AniList Rate Limit em Games pág ${page}, aguardando ${retry}s...`);
          await new Promise((r) => setTimeout(r, (retry + 1) * 1000));
          continue;
        }

        if (!res.ok) {
          console.warn(`⚠️ Página de Games ${page} falhou com status ${res.status}`);
          break;
        }

        const json: any = await res.json();
        const mediaList = json.data?.Page?.media || [];

        for (const m of mediaList) {
          const franchise = m.title?.english || m.title?.romaji || "Universo Games";
          const characters: AniListChar[] = m.characters?.nodes || [];

          for (const char of characters) {
            const fullName = char.name?.full;
            if (!fullName || !char.image?.large) continue;

            if (char.gender !== "Male" && char.gender !== "Female") continue;
            const gender = char.gender === "Male" ? "MALE" : "FEMALE";

            const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            if (existingSlugs.has(slug)) continue;

            const favs = Number(char.favourites || 100);
            const calculatedAether = Math.min(1300, Math.max(150, Math.round(180 + Math.sqrt(favs) * 4.2)));
            const cleanDesc = (char.description || "").replace(/<[^>]*>?/gm, "").slice(0, 240);
            const imagesJson = JSON.stringify([char.image.large]);

            insertStmt.run(
              crypto.randomUUID(),
              slug,
              fullName,
              char.name?.native || null,
              "GAME",
              "CHARACTER",
              gender,
              franchise,
              cleanDesc,
              imagesJson,
              calculatedAether,
              99999,
              Math.min(99, 70 + Math.round(calculatedAether / 40)),
              Math.min(99, 68 + Math.round(calculatedAether / 42)),
              Math.min(99, 72 + Math.round(calculatedAether / 38)),
              95
            );

            existingSlugs.add(slug);
            inserted++;
          }
        }

        console.log(`  ✓ Página Games ${page}/4 concluída (${inserted} novos personagens de jogos inseridos)`);
        success = true;
        await new Promise((r) => setTimeout(r, 1200));
      } catch (err) {
        console.error(`Erro ao buscar games pág ${page}:`, err);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  return inserted;
}

function insertCurated(db: Database.Database, existingSlugs: Set<string>): { weapons: number; cinema: number } {
  console.log("\n⚔️ [3/3] Inserindo Coleções Curadas de Armas Lendárias e Cinema...");
  const insertStmt = db.prepare(`
    INSERT INTO entities (
      id, slug, name, original_name, universe, type, gender, franchise,
      description, images_json, base_aether, popularity_rank,
      base_atk, base_def, base_spd, base_hp, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, CURRENT_TIMESTAMP
    )
  `);

  let weaponsInserted = 0;
  for (const w of CURATED_WEAPONS) {
    if (existingSlugs.has(w.slug)) continue;
    insertStmt.run(
      crypto.randomUUID(),
      w.slug,
      w.name,
      w.originalName || null,
      w.universe,
      w.type,
      w.gender,
      w.franchise,
      w.description,
      JSON.stringify([w.imageUrl]),
      w.baseAether,
      99999,
      w.atk,
      w.def,
      w.spd,
      w.hp
    );
    existingSlugs.add(w.slug);
    weaponsInserted++;
  }

  let cinemaInserted = 0;
  for (const c of CURATED_CINEMA) {
    if (existingSlugs.has(c.slug)) continue;
    insertStmt.run(
      crypto.randomUUID(),
      c.slug,
      c.name,
      c.originalName || null,
      c.universe,
      c.type,
      c.gender,
      c.franchise,
      c.description,
      JSON.stringify([c.imageUrl]),
      c.baseAether,
      99999,
      c.atk,
      c.def,
      c.spd,
      c.hp
    );
    existingSlugs.add(c.slug);
    cinemaInserted++;
  }

  return { weapons: weaponsInserted, cinema: cinemaInserted };
}

async function main() {
  console.log("🌌 ========================================================");
  console.log("🌌 KOGU: EXPANSÃO DO CATÁLOGO DE ENTIDADES (META: ~1000+)");
  console.log("🌌 ========================================================");

  const db = new Database(SQLITE_PATH);
  const rows = db.prepare("SELECT slug FROM entities").all() as Array<{ slug: string }>;
  const existingSlugs = new Set<string>(rows.map((r) => r.slug));
  console.log(`📊 Catálogo atual no SQLite: ${existingSlugs.size} entidades registradas.`);

  const animeInserted = await fetchAniListAnime(db, existingSlugs);
  const gamesInserted = await fetchAniListGames(db, existingSlugs);
  const { weapons, cinema } = insertCurated(db, existingSlugs);

  const totalNow = (db.prepare("SELECT count(*) as n FROM entities").get() as any).n;
  const byUniverse = db.prepare("SELECT universe, count(*) as n FROM entities GROUP BY universe").all();
  const byType = db.prepare("SELECT type, count(*) as n FROM entities GROUP BY type").all();
  const byGender = db.prepare("SELECT gender, count(*) as n FROM entities GROUP BY gender").all();

  console.log("\n========================================================");
  console.log(`🎉 EXPANSÃO CONCLUÍDA COM SUCESSO!`);
  console.log(`📈 Novos adicionados nesta sessão: ${animeInserted + gamesInserted + weapons + cinema}`);
  console.log(`   - Anime: +${animeInserted}`);
  console.log(`   - Games: +${gamesInserted}`);
  console.log(`   - Armas ($ar): +${weapons}`);
  console.log(`   - Cinema ($mc/$wc/$hc): +${cinema}`);
  console.log(`🏆 TOTAL FINAL DE ENTIDADES: ${totalNow}`);
  console.log("\n📊 Distribuição por Universo:", byUniverse);
  console.log("📊 Distribuição por Tipo:", byType);
  console.log("📊 Distribuição por Gênero:", byGender);
  console.log("========================================================\n");

  db.close();
}

main().catch((err) => {
  console.error("❌ Falha na expansão do catálogo:", err);
  process.exit(1);
});
