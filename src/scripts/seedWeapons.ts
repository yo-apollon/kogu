/**
 * Script de expansão do catálogo de Armas e Relíquias ($ar).
 * Adiciona 47 armas icônicas de Anime, Games e Cinema com atributos de combate e lore.
 *
 * Suporta inserção direta no Postgres (DATABASE_URL) e no SQLite (arqon_local.db).
 * Uso: tsx src/scripts/seedWeapons.ts
 */
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { nameTokens, normalizeName, slugify } from "../lib/text/normalize.js";

export interface WeaponSeed {
  name: string;
  originalName?: string;
  slug: string;
  universe: "ANIME" | "GAME" | "CINEMA";
  type: "WEAPON";
  gender: "ITEM";
  franchise: string;
  description: string;
  imageUrl: string;
  baseAether: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
}

export const NEW_WEAPONS: WeaponSeed[] = [
  // --- ANIME ---
  {
    name: "Murasame (A Assassina de Um Golpe)",
    originalName: "一撃必殺 村雨",
    slug: "murasame-akame",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Akame ga Kill!",
    description: "Teigu em forma de katana de Akame. Transmite uma maldição venenosa mortal que para o coração do alvo com um único corte.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b63351-0WmsDENpiscp.png",
    baseAether: 1100,
    atk: 98,
    def: 75,
    spd: 96,
    hp: 90,
  },
  {
    name: "Enma (A Lâmina Cortadora do Inferno)",
    originalName: "閻魔",
    slug: "enma-one-piece",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "One Piece",
    description: "Obra-prima de Shimotsuki Kozaburo, empunhada por Kozuki Oden e Zoro. Força a liberação violenta do Haki do usuário, cortando até o fundo do inferno.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png",
    baseAether: 1180,
    atk: 99,
    def: 82,
    spd: 90,
    hp: 95,
  },
  {
    name: "Wado Ichimonji (Caminho da Harmonia)",
    originalName: "和道一文字",
    slug: "wado-ichimonji",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "One Piece",
    description: "Uma das 21 O Wazamono, relíquia de infância herdada de Kuina que Zoro carrega entre os dentes ao usar o estilo Santoryu.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png",
    baseAether: 1050,
    atk: 94,
    def: 88,
    spd: 89,
    hp: 92,
  },
  {
    name: "Shusui (Água Límpida de Outono)",
    originalName: "秋水",
    slug: "shusui-one-piece",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "One Piece",
    description: "Lâmina Negra lendária outrora empunhada pelo Deus da Espada Ryuma de Wano. Uma katana pesada com poder destrutivo incomparável.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b62-S7oAeA9WInjV.png",
    baseAether: 1120,
    atk: 96,
    def: 89,
    spd: 86,
    hp: 94,
  },
  {
    name: "Yoru (A Espada Noturna Suprema)",
    originalName: "夜",
    slug: "yoru-one-piece",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "One Piece",
    description: "Uma das 12 Saijo O Wazamono, a espada negra de lâmina única em formato de cruz empunhada pelo Maior Espadachim do Mundo, Dracule Mihawk.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/n2064-OpnF4nLi6bvL.png",
    baseAether: 1250,
    atk: 100,
    def: 90,
    spd: 91,
    hp: 96,
  },
  {
    name: "Samehada (Pele de Tubarão)",
    originalName: "鮫肌",
    slug: "samehada-naruto",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Naruto",
    description: "A mais aterrorizante das Sete Espadas da Névoa. Uma lâmina viva coberta de escamas que se alimenta do chakra de seus oponentes.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/2672-oxbHx8n3N7WY.jpg",
    baseAether: 1080,
    atk: 93,
    def: 88,
    spd: 84,
    hp: 100,
  },
  {
    name: "Kusanagi (Espada Cortadora de Grama)",
    originalName: "草薙の剣",
    slug: "kusanagi-naruto",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Naruto",
    description: "Chokuto de Sasuke Uchiha canalizada com a Liberação de Relâmpago Chidori, capaz de cortar rocha pura e paralisar instantaneamente.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b13-SISLEw1oAD7a.png",
    baseAether: 1060,
    atk: 95,
    def: 78,
    spd: 97,
    hp: 88,
  },
  {
    name: "Kubikiribocho (Lâmina Decapitadora)",
    originalName: "首斬り包丁",
    slug: "kubikiribocho-naruto",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Naruto",
    description: "Lâmina gigante empunhada pelo Demônio do Gás Oculto Zabuza Momochi. Absorve o ferro do sangue de suas vítimas para se regenerar infinitamente.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b728-zHw77BzLzQKT.jpg",
    baseAether: 980,
    atk: 92,
    def: 85,
    spd: 82,
    hp: 92,
  },
  {
    name: "Tessaiga (A Presa de Ferro Destruidora de Demônios)",
    originalName: "鉄砕牙",
    slug: "tessaiga-inuyasha",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "InuYasha",
    description: "Espada lendária forjada a partir da presa do Grande Cão Demoníaco Touga. Capaz de destruir 100 demônios com um único golpe da Ferida do Vento.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b1353-xsZhvfi7IFzT.png",
    baseAether: 1150,
    atk: 97,
    def: 86,
    spd: 88,
    hp: 95,
  },
  {
    name: "Tenseiga (A Presa Celestial da Ressurreição)",
    originalName: "天生牙",
    slug: "tenseiga-inuyasha",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "InuYasha",
    description: "Espada sagrada de Sesshoumaru que não fere os vivos, mas é capaz de cortar seres do submundo e trazer os mortos de volta à vida com o Meidou Zangetsuha.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b1358-oR7bIGfc5pnX.png",
    baseAether: 1140,
    atk: 70,
    def: 100,
    spd: 92,
    hp: 100,
  },
  {
    name: "Elucidator & Dark Repulser (Lâminas Gêmeas)",
    originalName: "エリュシデータ & ダークリパルサー",
    slug: "elucidator-dark-repulser",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Sword Art Online",
    description: "O par de espadas lendárias de Kirito usadas com a habilidade secreta Dual Blades para aniquilar os chefes de Aincrad.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b36765-BnLbXg0Tzzh9.png",
    baseAether: 1100,
    atk: 96,
    def: 80,
    spd: 98,
    hp: 90,
  },
  {
    name: "Lambent Light (Luz Cintilante)",
    originalName: "ランベントライト",
    slug: "lambent-light-sao",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Sword Art Online",
    description: "Florete de grau mestre forjado por Lisbeth para Asuna, o Relâmpago. Desfere estocadas em velocidade supersônica quase invisíveis a olho nu.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b36828-j5ib0adAzGMx.png",
    baseAether: 1020,
    atk: 91,
    def: 76,
    spd: 99,
    hp: 88,
  },
  {
    name: "Kurikara (Espada Matadora de Demônios)",
    originalName: "降魔剣・倶利伽羅",
    slug: "kurikara-blue-exorcist",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Ao no Exorcist",
    description: "Lâmina que sela o coração e as Chamas Azuis demoníacas de Rin Okumura, o filho de Satã. Ao ser desembainhada, desperta o poder infernal.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b24482-E6087V4uAVqL.jpg",
    baseAether: 1060,
    atk: 94,
    def: 82,
    spd: 90,
    hp: 92,
  },
  {
    name: "Nichirin Escarlate de Yoriichi (Respiração do Sol)",
    originalName: "継国縁壱の日輪刀",
    slug: "nichirin-yoriichi",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Demon Slayer: Kimetsu no Yaiba",
    description: "A espada do primeiro e mais poderoso espadachim da Respiração do Sol. Sua lâmina vermelha brilhante impede a regeneração de demônios eternamente.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b149220-OuBk7B3O6WD6.jpg",
    baseAether: 1240,
    atk: 100,
    def: 88,
    spd: 98,
    hp: 92,
  },
  {
    name: "Espada Espiritual Reiken de Kuwabara",
    originalName: "霊剣",
    slug: "reiken-kuwabara",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Yu Yu Hakusho",
    description: "Manifestação da energia espiritual pura de Kazuma Kuwabara forjada em uma lâmina de luz, capaz de cortar dimensões e barreiras psíquicas.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/n730-H6SRWfoiFjBR.jpg",
    baseAether: 950,
    atk: 90,
    def: 85,
    spd: 84,
    hp: 96,
  },
  {
    name: "Lostvayne (A Espada Demônio de Meliodas)",
    originalName: "魔剣ロストヴェイン",
    slug: "lostvayne-meliodas",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Nanatsu no Taizai",
    description: "O Tesouro Sagrado do Pecado da Ira do Dragão. Permite ao usuário criar clones físicos com fração de seu poder para refletir magias simultâneas com Full Counter.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b72921-XDHNd1wflN6P.png",
    baseAether: 1120,
    atk: 96,
    def: 84,
    spd: 95,
    hp: 92,
  },
  {
    name: "Gae Bolg (Lança da Morte Certa)",
    originalName: "ゲイ・ボルグ",
    slug: "gae-bolg-fate",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Fate/stay night",
    description: "Fantasma Nobre amaldiçoado empunhado por Cu Chulainn. Inverte a causalidade: o coração é perfurado antes mesmo da lança ser arremessada.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b499-gS5RAdupSKWQ.png",
    baseAether: 1130,
    atk: 97,
    def: 78,
    spd: 99,
    hp: 90,
  },
  {
    name: "Portão da Babilônia (Gate of Babylon)",
    originalName: "王の財宝",
    slug: "gate-of-babylon",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Fate/stay night",
    description: "O cofre dourado dimensional contendo os protótipos de todas as armas e tesouros da humanidade, disparados como projéteis infinitos pelo Rei dos Heróis.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b2514-hnE6LEdqm7Su.png",
    baseAether: 1280,
    atk: 100,
    def: 88,
    spd: 96,
    hp: 95,
  },
  {
    name: "Bakuzan (Lâmina Devoradora de Fibras)",
    originalName: "縛斬",
    slug: "bakuzan-kill-la-kill",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Kill la Kill",
    description: "A katana feita de metal especial empunhada por Satsuki Kiryuin, capaz de cortar Uniformes Goku e fibras vivas sem sofrer nenhum arranhão.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b83799-oPxSwMA9XAvu.png",
    baseAether: 980,
    atk: 92,
    def: 82,
    spd: 91,
    hp: 89,
  },
  {
    name: "Cross Punisher (A Cruz do Justiceiro)",
    originalName: "パニッシャー",
    slug: "cross-punisher-trigun",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "TRIGUN",
    description: "Arma colossal em forma de cruz usada por Nicholas D. Wolfwood. Contém uma metralhadora pesada na frente, um lança-foguetes atrás e compartimento de pistolas.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b722-Ernx5wHAXugB.jpg",
    baseAether: 1020,
    atk: 95,
    def: 80,
    spd: 85,
    hp: 94,
  },
  {
    name: "Nyoibo (O Bastão Mágico)",
    originalName: "如意棒",
    slug: "nyoibo-dragon-ball",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Dragon Ball",
    description: "Artefato divino indestrutível dado pelo Mestre Karin a Goku. Estica-se a comprimentos infinitos sob o comando de seu portador até alcançar a Lua.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/246-wsRRr6z1kii8.png",
    baseAether: 1040,
    atk: 93,
    def: 90,
    spd: 90,
    hp: 95,
  },
  {
    name: "Mugen (As Seis Ilusões)",
    originalName: "六幻",
    slug: "mugen-dgrayman",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "D.Gray-man",
    description: "Inocência em forma de espada japonesa empunhada por Yu Kanda. Ativa poderes demoníacos através de seis ilusões sacrificando a própria força vital.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b140-vbv18x2l0tDw.png",
    baseAether: 1000,
    atk: 93,
    def: 81,
    spd: 92,
    hp: 90,
  },
  {
    name: "Correntes do Julgamento de Kurapika",
    originalName: "律する小指の鎖",
    slug: "judgment-chain-kurapika",
    universe: "ANIME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Hunter x Hunter",
    description: "Correntes de Nen que envolvem o coração do alvo. Se violar a condição imposta por Kurapika, a lâmina perfura o coração instantaneamente.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b28-ivA7UGnfE40a.png",
    baseAether: 1100,
    atk: 96,
    def: 85,
    spd: 93,
    hp: 91,
  },

  // --- GAMES ---
  {
    name: "Frostmourne (Gélido Lamento)",
    originalName: "Frostmourne",
    slug: "frostmourne-warcraft",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Warcraft",
    description: "A espada amaldiçoada do Lich King empunhada por Arthas Menethil. Drena a alma de cada ser abatido, aprisionando-as para a eternidade.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1x7d.png",
    baseAether: 1250,
    atk: 100,
    def: 88,
    spd: 87,
    hp: 98,
  },
  {
    name: "Masamune (Lâmina do Meteoro Negro)",
    originalName: "正宗",
    slug: "masamune-sephiroth",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Final Fantasy VII",
    description: "Odachi de lâmina longa incomparável de Sephiroth. Desfere cortes cósmicos tão rápidos que partem edifícios e fendas no espaço-tempo.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b1816-dUWCJJq7bKL7.png",
    baseAether: 1220,
    atk: 99,
    def: 83,
    spd: 95,
    hp: 93,
  },
  {
    name: "Gunblade Revolver",
    originalName: "ガンブレード・リボルバー",
    slug: "gunblade-revolver",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Final Fantasy VIII",
    description: "Arma híbrida icônica de Squall Leonhart. Puxar o gatilho no impacto dispara vibrações explosivas que rasgam armaduras.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b11632-4u071zk8PWrD.png",
    baseAether: 1040,
    atk: 93,
    def: 83,
    spd: 89,
    hp: 90,
  },
  {
    name: "Brotherhood (Espada da Fraternidade)",
    originalName: "フラタニティ",
    slug: "brotherhood-ffx",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Final Fantasy X",
    description: "Espada aquática reluzente presenteada a Tidus por Wakka em Spira, originalmente pertencente a seu irmão Chappu.",
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b185283-E2ufuAmBHQjA.jpg",
    baseAether: 980,
    atk: 91,
    def: 82,
    spd: 91,
    hp: 92,
  },
  {
    name: "Red Queen (A Rainha Escarlate)",
    originalName: "Red Queen",
    slug: "red-queen-dmc",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Devil May Cry",
    description: "Espada customizada de Nero com acelerador de combustão Exceed, liberando labaredas infernais a cada golpe acelerado.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1x7c.png",
    baseAether: 1060,
    atk: 94,
    def: 82,
    spd: 92,
    hp: 93,
  },
  {
    name: "Lâmina Crisol (Crucible Blade)",
    originalName: "The Crucible",
    slug: "crucible-blade-doom",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "DOOM",
    description: "Espada de pura energia Wraith empunhada pelo Doom Slayer, capaz de decepar lordes titãs demoníacos com facilidade titânica.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1nc0.png",
    baseAether: 1200,
    atk: 100,
    def: 85,
    spd: 88,
    hp: 96,
  },
  {
    name: "BFG 9000 (Big Fucking Gun)",
    originalName: "BFG 9000",
    slug: "bfg-9000",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "DOOM",
    description: "A mais devastadora arma de plasma da UAC. Dispara uma esfera de energia que vaporiza hordas inteiras em um clarão esmeralda.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1nc0.png",
    baseAether: 1240,
    atk: 100,
    def: 70,
    spd: 86,
    hp: 95,
  },
  {
    name: "Portal Gun (Dispositivo ASHPD)",
    originalName: "Aperture Science Handheld Portal Device",
    slug: "portal-gun",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Portal",
    description: "Dispositivo experimental da Aperture capaz de rasgar túneis instantâneos no contínuo espaço-tempo conectando dois pontos planos.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wz4.png",
    baseAether: 1120,
    atk: 75,
    def: 90,
    spd: 100,
    hp: 88,
  },
  {
    name: "Pé de Cabra de Gordon Freeman",
    originalName: "Crowbar",
    slug: "crowbar-half-life",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Half-Life",
    description: "A humilde ferramenta de ferro vermelha que sobreviveu à cascata de ressonância em Black Mesa e liderou a resistência contra os Combine.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r4r.png",
    baseAether: 950,
    atk: 88,
    def: 88,
    spd: 88,
    hp: 98,
  },
  {
    name: "Lâmina de Olympus (Blade of Olympus)",
    originalName: "Blade of Olympus",
    slug: "blade-of-olympus",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "God of War",
    description: "Forjada por Zeus com o poder dos céus para vencer a Grande Guerra contra os Titãs, mais tarde tomada por Kratos para destruir o Olimpo.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.png",
    baseAether: 1260,
    atk: 100,
    def: 88,
    spd: 89,
    hp: 96,
  },
  {
    name: "Escudo Hyliano (Hylian Shield)",
    originalName: "ハイリアの盾",
    slug: "hylian-shield",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "The Legend of Zelda",
    description: "O lendário e quase inquebrável escudo tradicional de Hyrule, forjado pelos deuses e ornado com o símbolo da Triforça e o Pássaro Carmesim.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.png",
    baseAether: 1080,
    atk: 60,
    def: 100,
    spd: 84,
    hp: 100,
  },
  {
    name: "Rios de Sangue (Rivers of Blood)",
    originalName: "屍山血海",
    slug: "rivers-of-blood",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Elden Ring",
    description: "Katana de Okina das Terras Intermédias banhada em sangue amaldiçoado. Libera a temida técnica Empilhador de Cadáveres.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co49x5.png",
    baseAether: 1140,
    atk: 98,
    def: 78,
    spd: 97,
    hp: 89,
  },
  {
    name: "Espada Grande da Lua Negra (Dark Moon Greatsword)",
    originalName: "暗月の大剣",
    slug: "dark-moon-greatsword",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Elden Ring",
    description: "Relíquia conferida pela Princesa Lunar Ranni a seu consorte prometido. Irradia a luz gélida da Lua Cheia de Caria com poder místico estelar.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co49x5.png",
    baseAether: 1190,
    atk: 97,
    def: 87,
    spd: 85,
    hp: 95,
  },
  {
    name: "Monado (A Espada da Luz do Futuro)",
    originalName: "モナド",
    slug: "monado-xenoblade",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Xenoblade Chronicles",
    description: "Espada etérea de Shulk capaz de manipular o próprio éter de criação do mundo e conceder ao portador visões proféticas do futuro imediato.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co20ee.png",
    baseAether: 1200,
    atk: 97,
    def: 88,
    spd: 94,
    hp: 92,
  },
  {
    name: "Lâmina Oculta de Ezio (Hidden Blade)",
    originalName: "Hidden Blade",
    slug: "hidden-blade-ezio",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Assassin's Creed",
    description: "A arma assinatura da Irmandade dos Assassinos aperfeiçoada por Leonardo da Vinci. Silenciosa, rápida e letal nas sombras.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1w9k.png",
    baseAether: 1020,
    atk: 96,
    def: 72,
    spd: 99,
    hp: 88,
  },
  {
    name: "Espada de Diamante Encantada",
    originalName: "Diamond Sword",
    slug: "diamond-sword-minecraft",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Minecraft",
    description: "Forjada com diamantes puros e imbuída com Afiação V e Aspecto Flamejante na mesa de encantamentos. O símbolo definitivo de sobrevivência.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2kvi.png",
    baseAether: 960,
    atk: 91,
    def: 85,
    spd: 90,
    hp: 92,
  },
  {
    name: "Espada de Energia Tipo-1 (Energy Sword)",
    originalName: "Type-1 Energy Sword",
    slug: "energy-sword-halo",
    universe: "GAME",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Halo",
    description: "Arma nobre sagrada empunhada pelos Sangheili e Spartans, consistindo em duas lâminas de plasma puro que vaporizam blindagens com um toque.",
    imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co1w69.png",
    baseAether: 1080,
    atk: 98,
    def: 76,
    spd: 96,
    hp: 88,
  },

  // --- CINEMA ---
  {
    name: "Rompe-Tormentas (Stormbreaker)",
    originalName: "Stormbreaker",
    slug: "stormbreaker-thor",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Marvel Cinematic Universe",
    description: "Machado régio forjado em Nidavellir pelo Rei Anão Eitri a partir de metal Uru. Canaliza a Bifrost e é capaz de ferir seres cósmicos como Thanos.",
    imageUrl: "https://image.tmdb.org/t/p/w500/prSfAi1xGrhLQNxVSUFh61xQ4Qx.jpg",
    baseAether: 1220,
    atk: 99,
    def: 89,
    spd: 91,
    hp: 96,
  },
  {
    name: "Escudo de Vibranium do Capitão América",
    originalName: "Captain America's Shield",
    slug: "vibranium-shield",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Marvel Cinematic Universe",
    description: "Disco de liga de Vibranium forjado por Howard Stark. Absorve completamente qualquer energia cinética de impacto e ricocheteia com precisão milimétrica.",
    imageUrl: "https://image.tmdb.org/t/p/w500/4ssDuvEDkS9urPExL0mt1Fw8Ng3.jpg",
    baseAether: 1100,
    atk: 80,
    def: 100,
    spd: 90,
    hp: 100,
  },
  {
    name: "Manopla do Infinito com as Joias",
    originalName: "Infinity Gauntlet",
    slug: "infinity-gauntlet",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Marvel Cinematic Universe",
    description: "Artefato supremo forjado para conter as seis Joias do Infinito: Espaço, Mente, Realidade, Poder, Tempo e Alma. Um estalar de dedos reescreve a existência.",
    imageUrl: "https://image.tmdb.org/t/p/w500/yNO9tN7i79Z8Z3vjX7XgDqKqWkM.jpg",
    baseAether: 1300,
    atk: 100,
    def: 95,
    spd: 95,
    hp: 100,
  },
  {
    name: "Varinha das Varinhas (The Elder Wand)",
    originalName: "The Elder Wand",
    slug: "elder-wand",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Harry Potter",
    description: "A mais poderosa das três Relíquias da Morte, forjada em madeira de sabugueiro com núcleo de pelo de cauda de Thestral. Invicta em duelos mágicos.",
    imageUrl: "https://image.tmdb.org/t/p/w500/3TjGmsW232c8WcW9t6w8D8U8y0a.jpg",
    baseAether: 1150,
    atk: 98,
    def: 86,
    spd: 96,
    hp: 90,
  },
  {
    name: "Ferrão (Sting - A Lâmina Élfica)",
    originalName: "Sting",
    slug: "sting-lotr",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "The Lord of the Rings",
    description: "Adaga élfica de Gondolin empunhada por Bilbo e herdada por Frodo Bolseiro na Terra Média. Brilha com uma luz azul fria quando orcs estão por perto.",
    imageUrl: "https://image.tmdb.org/t/p/w500/6oom5QYQ2yQTMJIbnvbkBL9cDK6.jpg",
    baseAether: 960,
    atk: 89,
    def: 84,
    spd: 94,
    hp: 90,
  },
  {
    name: "Glamdring (O Martelo dos Inimigos)",
    originalName: "Glamdring",
    slug: "glamdring-lotr",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "The Lord of the Rings",
    description: "A espada ancestral do Rei Turgon de Gondolin empunhada pelo mago Gandalf o Cinzento, canalizadora de fogo sagrado contra o Balrog de Moria.",
    imageUrl: "https://image.tmdb.org/t/p/w500/w9k3oc8ZLLfD88g30H6lQ8Eev9e.jpg",
    baseAether: 1100,
    atk: 95,
    def: 90,
    spd: 90,
    hp: 96,
  },
  {
    name: "Sabre de Luz Vermelho de Darth Vader",
    originalName: "Darth Vader's Lightsaber",
    slug: "vader-lightsaber",
    universe: "CINEMA",
    type: "WEAPON",
    gender: "ITEM",
    franchise: "Star Wars",
    description: "Alimentado por um Cristal Kyber corrompido que 'sangrou' pela dor e ódio do Lado Sombrio da Força empunhado pelo temido Lorde Sith.",
    imageUrl: "https://image.tmdb.org/t/p/w500/mgq5e3n91rM1yXoFvGjE5K1kFw8.jpg",
    baseAether: 1180,
    atk: 99,
    def: 88,
    spd: 92,
    hp: 94,
  },
];

/** Insere no SQLite arqon_local.db */
export function seedSqlite(sqlitePath: string): number {
  if (!fs.existsSync(sqlitePath)) return 0;
  const db = new Database(sqlitePath);
  const existingSlugs = new Set(
    (db.prepare("SELECT slug FROM entities").all() as Array<{ slug: string }>).map((r) => r.slug)
  );

  const insertStmt = db.prepare(`
    INSERT INTO entities (
      id, slug, name, original_name, universe, type, gender, franchise,
      description, images_json, base_aether, popularity_rank,
      likes_count, claims_count, base_atk, base_def, base_spd, base_hp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, datetime('now'))
  `);

  let inserted = 0;
  for (const w of NEW_WEAPONS) {
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
    inserted++;
  }
  db.close();
  return inserted;
}

/** Insere no Postgres */
export async function seedPostgres(databaseUrl: string): Promise<number> {
  const sql = postgres(databaseUrl);
  let inserted = 0;

  try {
    for (const w of NEW_WEAPONS) {
      // 1. Verifica se já existe
      const [existing] = await sql`SELECT id FROM entities WHERE slug = ${w.slug}`;
      if (existing) continue;

      // 2. Franquia
      const franchiseSlug = slugify(w.franchise);
      const [franchise] = await sql`
        INSERT INTO franchises (slug, name)
        VALUES (${franchiseSlug}, ${w.franchise})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;

      // 3. Série LEGACY
      const seriesSlug = `legacy-${franchiseSlug}`;
      const [seriesRow] = await sql`
        INSERT INTO series (franchise_id, slug, title, universe, media_type)
        VALUES (${franchise.id}, ${seriesSlug}, ${w.franchise}, ${w.universe}, 'OTHER')
        ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
        RETURNING id
      `;

      // 4. Proximo rank único
      const [maxRankRow] = await sql`SELECT COALESCE(MAX(popularity_rank), 0) + 1 AS next_rank FROM entities`;
      const nextRank = Number(maxRankRow.next_rank);

      const tokens = nameTokens(w.name).join(" ") || w.name.toLowerCase();

      // 5. Entidade
      const legacyId = crypto.randomUUID();
      const [entity] = await sql`
        INSERT INTO entities (
          legacy_id, slug, name, name_native, name_normalized, universe, type, gender,
          franchise_id, description, status, base_aether, roll_weight, popularity_rank,
          base_atk, base_def, base_spd, base_hp
        ) VALUES (
          ${legacyId}, ${w.slug}, ${w.name}, ${w.originalName || null}, ${tokens},
          ${w.universe}, ${w.type}, ${w.gender}, ${franchise.id}, ${w.description},
          'ACTIVE', ${w.baseAether}, 1, ${nextRank},
          ${w.atk}, ${w.def}, ${w.spd}, ${w.hp}
        )
        RETURNING id
      `;

      // 6. entity_series
      await sql`
        INSERT INTO entity_series (entity_id, series_id, is_primary)
        VALUES (${entity.id}, ${seriesRow.id}, true)
        ON CONFLICT (entity_id, series_id) DO NOTHING
      `;

      // 7. entity_images
      await sql`
        INSERT INTO entity_images (entity_id, url, source, status, is_primary)
        VALUES (${entity.id}, ${w.imageUrl}, 'MANUAL', 'ACTIVE', true)
        ON CONFLICT (entity_id, url) DO NOTHING
      `;

      inserted++;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  return inserted;
}

async function main() {
  console.log("⚔️ Expansão do Catálogo de Armas e Relíquias ($ar)...");

  // 1. SQLite Local
  const sqlitePath = path.resolve("arqon_local.db");
  const sqliteInserted = seedSqlite(sqlitePath);
  console.log(`📦 SQLite local: ${sqliteInserted} novas armas adicionadas.`);

  // 2. Postgres
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log("🐘 Conectando ao Postgres...");
    const pgInserted = await seedPostgres(dbUrl);
    console.log(`✨ Postgres: ${pgInserted} novas armas registradas e ativas!`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("src/scripts/seedWeapons.ts")) {
  main().catch((err) => {
    console.error("❌ Erro ao adicionar armas:", err);
    process.exit(1);
  });
}
