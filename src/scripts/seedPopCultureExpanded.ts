/**
 * Expansão Massiva de Esportes e Música Mundial para o Kogu:
 * - UFC / MMA (sport_mma)
 * - Futebol Mundial (sport_football)
 * - NBA / Basquete (sport_basketball)
 * - Música & Trap Internacional e Brasileiro (music_hiphop, music_rock, music_pop)
 *
 * Busca fotos oficiais em alta resolução na Wikipedia/Wikimedia, baixa para docs/assets/cards/
 * e insere todas as entidades com nichos, tiers e atributos de combate (ATK, DEF, SPD, HP, Éter).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { TIER_WEIGHT, type EntityTier } from "../config/gacha.js";
import { normalizeName, slugify } from "../lib/text/normalize.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

export interface ExpandedLegend {
  slug: string;
  name: string;
  franchise: string;
  series: string;
  nicheKey: string;
  tier: EntityTier;
  gender: "MALE" | "FEMALE" | "NONBINARY";
  aether: number;
  atk: number;
  def: number;
  spd: number;
  hp: number;
  desc: string;
  wiki: string;
  wikiLang?: "en" | "pt";
  fallbackImg?: string;
}

export const EXPANDED_LEGENDS: readonly ExpandedLegend[] = [
  // ==========================================
  // 1. UFC / MMA (sport_mma)
  // ==========================================
  {
    slug: "alex-volkanovski",
    name: "Alexander Volkanovski (The Great)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 95, def: 91, spd: 96, hp: 930,
    desc: "Ex-campeão dominante peso-pena do UFC, wrestling inquebrável e velocidade relâmpago.",
    wiki: "Alexander_Volkanovski",
  },
  {
    slug: "dustin-poirier",
    name: "Dustin Poirier (The Diamond)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1290,
    atk: 96, def: 88, spd: 91, hp: 940,
    desc: "Boxe de elite na curta distância, guilhotinas lendárias e coração gigante no octógono.",
    wiki: "Dustin_Poirier",
  },
  {
    slug: "justin-gaethje",
    name: "Justin Gaethje (The Highlight)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 97, def: 85, spd: 89, hp: 950,
    desc: "Campeão BMF, chutes baixos demolidores e violência visceral nos combates.",
    wiki: "Justin_Gaethje",
  },
  {
    slug: "max-holloway",
    name: "Max Holloway (Blessed / BMF)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1380,
    atk: 98, def: 90, spd: 97, hp: 960,
    desc: "O campeão BMF do UFC 300 com nocaute no último segundo. Volume infinito de golpes.",
    wiki: "Max_Holloway",
  },
  {
    slug: "tom-aspinall",
    name: "Tom Aspinall",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1290,
    atk: 97, def: 92, spd: 95, hp: 980,
    desc: "Campeão interino dos pesos pesados do UFC. Velocidade absurda de mãos e chão letal.",
    wiki: "Tom_Aspinall",
  },
  {
    slug: "sean-omalley",
    name: "Sean O'Malley (Suga)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "EPIC",
    gender: "MALE",
    aether: 1180,
    atk: 94, def: 82, spd: 95, hp: 870,
    desc: "Precisão de sniper, movimentação imprevisível e um dos maiores astros jovens do UFC.",
    wiki: "Sean_O'Malley_(fighter)",
  },
  {
    slug: "paddy-pimblett",
    name: "Paddy Pimblett (The Baddy)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "RARE",
    gender: "MALE",
    aether: 980,
    atk: 88, def: 82, spd: 86, hp: 880,
    desc: "Sensação inglesa de Liverpool, carisma elétrico e finalizações surpreendentes.",
    wiki: "Paddy_Pimblett",
  },
  {
    slug: "georges-st-pierre",
    name: "Georges St-Pierre (GSP)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1420,
    atk: 98, def: 98, spd: 96, hp: 1010,
    desc: "O mestre canadense da estratégia. Bicampeão dos meio-médios e médios, lenda máxima do MMA.",
    wiki: "Georges_St-Pierre",
  },
  {
    slug: "demetrious-johnson",
    name: "Demetrious Johnson (Mighty Mouse)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1400,
    atk: 97, def: 95, spd: 100, hp: 920,
    desc: "11 defesas de cinturão consecutivas no UFC. O lutador tecnicamente mais perfeito da história.",
    wiki: "Demetrious_Johnson",
  },
  {
    slug: "fedor-emelianenko",
    name: "Fedor Emelianenko (The Last Emperor)",
    franchise: "UFC / MMA",
    series: "MMA Legends",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1410,
    atk: 99, def: 94, spd: 92, hp: 1020,
    desc: "O Último Imperador russo. Quase uma década invicto como o peso-pesado mais temido do PRIDE.",
    wiki: "Fedor_Emelianenko",
  },
  {
    slug: "francis-ngannou",
    name: "Francis Ngannou (The Predator)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1430,
    atk: 100, def: 90, spd: 88, hp: 1030,
    desc: "O poder de soco mais devastador da história dos esportes de combate. Campeão linear do UFC.",
    wiki: "Francis_Ngannou",
  },
  {
    slug: "kamaru-usman",
    name: "Kamaru Usman (The Nigerian Nightmare)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 94, def: 96, spd: 90, hp: 960,
    desc: "5 defesas de título nos meio-médios, wrestling impenetrável e poder nas mãos.",
    wiki: "Kamaru_Usman",
  },
  {
    slug: "colby-covington",
    name: "Colby Covington (Chaos)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "EPIC",
    gender: "MALE",
    aether: 1150,
    atk: 90, def: 93, spd: 93, hp: 950,
    desc: "Gás cardiovascular infinito, volume ininterrupto de golpes e o vilão mais polarizador do MMA.",
    wiki: "Colby_Covington",
  },
  {
    slug: "stipe-miocic",
    name: "Stipe Miocic",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 96, def: 94, spd: 87, hp: 990,
    desc: "Recordista absoluto de defesas de cinturão peso-pesado no UFC. Bombeiro e guerreiro de Cleveland.",
    wiki: "Stipe_Miocic",
  },
  {
    slug: "ronda-rousey",
    name: "Ronda Rousey (Rowdy)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "FEMALE",
    aether: 1370,
    atk: 95, def: 88, spd: 93, hp: 910,
    desc: "Pioneira do MMA feminino no UFC, medalhista olímpica de judô e Rainha do Armbar instantâneo.",
    wiki: "Ronda_Rousey",
  },
  {
    slug: "zhang-weili",
    name: "Zhang Weili (Magnum)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "FEMALE",
    aether: 1260,
    atk: 95, def: 92, spd: 94, hp: 930,
    desc: "Primeira campeã chinesa do UFC, agressividade avassaladora e força bruta com técnica primorosa.",
    wiki: "Zhang_Weili",
  },
  {
    slug: "valentina-shevchenko",
    name: "Valentina Shevchenko (Bullet)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "FEMALE",
    aether: 1360,
    atk: 97, def: 95, spd: 96, hp: 940,
    desc: "Campeã peso-mosca, mestra de Muay Thai e Taekwondo com precisão cirúrgica de contragolpe.",
    wiki: "Valentina_Shevchenko",
  },
  {
    slug: "wanderlei-silva",
    name: "Wanderlei Silva (The Axe Murderer)",
    franchise: "UFC / MMA",
    series: "MMA Legends",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1270,
    atk: 96, def: 85, spd: 90, hp: 960,
    desc: "O Cachorro Louco do Chute Boxe. Reinou com agressividade lendária no PRIDE japonês.",
    wiki: "Wanderlei_Silva",
  },
  {
    slug: "vitor-belfort",
    name: "Vitor Belfort (O Fenômeno)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 97, def: 84, spd: 98, hp: 920,
    desc: "Mãos mais velozes da história do octógono, campeão do torneio do UFC com apenas 19 anos.",
    wiki: "Vitor_Belfort",
  },
  {
    slug: "royce-gracie",
    name: "Royce Gracie (O Pioneiro)",
    franchise: "UFC / MMA",
    series: "MMA Legends",
    nicheKey: "sport_mma",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1390,
    atk: 93, def: 95, spd: 88, hp: 950,
    desc: "O homem que provou ao planeta no UFC 1 a soberania do Jiu-Jitsu brasileiro sobre qualquer arte.",
    wiki: "Royce_Gracie",
  },
  {
    slug: "nate-diaz",
    name: "Nate Diaz (209 Stockton)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1240,
    atk: 92, def: 96, spd: 88, hp: 970,
    desc: "Coração inabalável, tapa de Stockton e jiu-jitsu de rua que finalizou lendas consagradas.",
    wiki: "Nate_Diaz",
  },
  {
    slug: "robert-whittaker",
    name: "Robert Whittaker (The Reaper)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1260,
    atk: 94, def: 92, spd: 94, hp: 930,
    desc: "Ex-campeão dos pesos médios, blitz agressiva e movimentação de karatê de altíssimo nível.",
    wiki: "Robert_Whittaker",
  },
  {
    slug: "dricus-du-plessis",
    name: "Dricus Du Plessis (Stillknocks)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1270,
    atk: 95, def: 90, spd: 89, hp: 960,
    desc: "Primeiro campeão sul-africano do UFC, pressão incansável e força inacreditável.",
    wiki: "Dricus_du_Plessis",
  },
  {
    slug: "belal-muhammad",
    name: "Belal Muhammad (Remember The Name)",
    franchise: "UFC / MMA",
    series: "UFC (Ultimate Fighting Championship)",
    nicheKey: "sport_mma",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1250,
    atk: 92, def: 95, spd: 90, hp: 970,
    desc: "Campeão meio-médio do UFC com wrestling disciplinado e ritmo dominante de 5 rounds.",
    wiki: "Belal_Muhammad",
  },

  // ==========================================
  // 2. FUTEBOL MUNDIAL (sport_football)
  // ==========================================
  {
    slug: "diego-maradona",
    name: "Diego Maradona (El Pibe de Oro)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1500,
    atk: 100, def: 75, spd: 96, hp: 980,
    desc: "Deus do futebol argentino e herói eterno do Napoli. Campeão da Copa de 1986.",
    wiki: "Diego_Maradona",
  },
  {
    slug: "zinedine-zidane",
    name: "Zinedine Zidane (Zizou)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 98, def: 85, spd: 90, hp: 970,
    desc: "A pura elegância com a bola. Campeão da Copa de 1998 e tricampeão da Champions como técnico.",
    wiki: "Zinedine_Zidane",
  },
  {
    slug: "johan-cruyff",
    name: "Johan Cruyff",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 99, def: 82, spd: 95, hp: 960,
    desc: "O arquiteto do Futebol Total no Ajax e Barcelona. Revolucionou para sempre a tática do esporte.",
    wiki: "Johan_Cruyff",
  },
  {
    slug: "zico",
    name: "Zico (O Galinho de Quintino)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 99, def: 78, spd: 94, hp: 960,
    desc: "Maior ídolo da história do Flamengo, camisa 10 da Seleção Brasileira de 82 e gênio das cobranças de falta.",
    wiki: "Zico_(footballer)",
  },
  {
    slug: "romario",
    name: "Romário (O Baixinho)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 100, def: 70, spd: 97, hp: 940,
    desc: "O gênio da grande área. Decidiu a Copa do Mundo de 1994 e ultrapassou a marca de 1.000 gols.",
    wiki: "Rom%C3%A1rio",
  },
  {
    slug: "kaka",
    name: "Kaká (O Último dos Mortais)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1430,
    atk: 97, def: 78, spd: 98, hp: 940,
    desc: "Melhor do Mundo em 2007 pelo Milan, arrancadas verticais imparáveis e classe incomparável.",
    wiki: "Kak%C3%A1",
  },
  {
    slug: "luka-modric",
    name: "Luka Modrić (O Maestro Croata)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1420,
    atk: 96, def: 88, spd: 91, hp: 940,
    desc: "Bola de Ouro 2018 e 6x campeão da Champions pelo Real Madrid. Trivela mágica e longevidade lendária.",
    wiki: "Luka_Modri%C4%87",
  },
  {
    slug: "kevin-de-bruyne",
    name: "Kevin De Bruyne (KDB)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1340,
    atk: 97, def: 82, spd: 89, hp: 930,
    desc: "O passe mais letal do futebol mundial contemporâneo e maestro das conquistas do Manchester City.",
    wiki: "Kevin_De_Bruyne",
  },
  {
    slug: "jude-bellingham",
    name: "Jude Bellingham (Belligol)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1320,
    atk: 95, def: 88, spd: 92, hp: 960,
    desc: "Astro do Real Madrid e Inglaterra, poder físico imponente e estrela de gols decisivos no fim.",
    wiki: "Jude_Bellingham",
  },
  {
    slug: "lamine-yamal",
    name: "Lamine Yamal (O Prodígio da Masia)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 95, def: 70, spd: 98, hp: 890,
    desc: "Campeão da Eurocopa aos 17 anos com a Espanha e joia mais brilhante da nova geração do Barcelona.",
    wiki: "Lamine_Yamal",
  },
  {
    slug: "rodri",
    name: "Rodri (Bola de Ouro 2024)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1410,
    atk: 93, def: 98, spd: 86, hp: 990,
    desc: "Vencedor da Bola de Ouro 2024, campeão da Eurocopa e o primeiro volante a ditar o ritmo da Europa.",
    wiki: "Rodri_(footballer,_born_1996)",
  },
  {
    slug: "manuel-neuer",
    name: "Manuel Neuer (O Goleiro-Líbero)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1420,
    atk: 80, def: 100, spd: 90, hp: 1020,
    desc: "Redefiniu a posição de goleiro moderno. Campeão do Mundo com a Alemanha em 2014.",
    wiki: "Manuel_Neuer",
  },
  {
    slug: "gianluigi-buffon",
    name: "Gianluigi Buffon (Gigi)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1430,
    atk: 75, def: 100, spd: 85, hp: 1010,
    desc: "O guardião eterno da Azzurra e da Juventus. Campeão da Copa de 2006 com defesas inacreditáveis.",
    wiki: "Gianluigi_Buffon",
  },
  {
    slug: "lev-yashin",
    name: "Lev Yashin (O Aranha Negra)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1440,
    atk: 70, def: 100, spd: 88, hp: 1040,
    desc: "O único goleiro da história a conquistar a Bola de Ouro (1963). Reflexos sobre-humanos.",
    wiki: "Lev_Yashin",
  },
  {
    slug: "franz-beckenbauer",
    name: "Franz Beckenbauer (Der Kaiser)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1450,
    atk: 90, def: 100, spd: 91, hp: 1020,
    desc: "O Kaiser alemão. Criador da função de líbero soberano e campeão mundial como capitão e treinador.",
    wiki: "Franz_Beckenbauer",
  },
  {
    slug: "paolo-maldini",
    name: "Paolo Maldini (Il Capitano)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 85, def: 100, spd: 92, hp: 1010,
    desc: "O maior zagueiro da história do futebol mundial. 5 títulos de Champions League pelo Milan.",
    wiki: "Paolo_Maldini",
  },
  {
    slug: "roberto-carlos",
    name: "Roberto Carlos (O Canhão Canarinho)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1440,
    atk: 96, def: 90, spd: 99, hp: 960,
    desc: "Lateral-esquerdo do penta em 2002. Chutes a mais de 130 km/h que desafiavam as leis da física.",
    wiki: "Roberto_Carlos_(footballer)",
  },
  {
    slug: "rivaldo",
    name: "Rivaldo (O Craque do Penta)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1430,
    atk: 98, def: 76, spd: 92, hp: 950,
    desc: "Melhor do Mundo em 1999 e camisa 10 genial do pentacampeonato mundial do Brasil em 2002.",
    wiki: "Rivaldo",
  },
  {
    slug: "thierry-henry",
    name: "Thierry Henry (King Henry)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1450,
    atk: 98, def: 74, spd: 99, hp: 940,
    desc: "Líder dos Invencíveis do Arsenal, classe na finalização de chapa e campeão mundial em 1998.",
    wiki: "Thierry_Henry",
  },
  {
    slug: "andres-iniesta",
    name: "Andrés Iniesta (Don Andrés)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1440,
    atk: 96, def: 84, spd: 91, hp: 930,
    desc: "Autor do gol do título mundial da Espanha em 2010. Maestro da orquestra tiki-taka do Barça.",
    wiki: "Andr%C3%A9s_Iniesta",
  },
  {
    slug: "xavi-hernandez",
    name: "Xavi Hernández (O Maestro)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1430,
    atk: 95, def: 85, spd: 88, hp: 930,
    desc: "O cérebro que controlava a rotação do mundo com passes milimétricos no Barcelona e Espanha.",
    wiki: "Xavi",
  },
  {
    slug: "sergio-ramos",
    name: "Sergio Ramos (El Capitán)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1340,
    atk: 91, def: 98, spd: 89, hp: 990,
    desc: "O zagueiro mais decisivo da era moderna do Real Madrid. Gol histórico aos 92:48 em Lisboa.",
    wiki: "Sergio_Ramos",
  },
  {
    slug: "luis-suarez",
    name: "Luis Suárez (El Pistolero)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1350,
    atk: 98, def: 75, spd: 90, hp: 950,
    desc: "Faro de gol implacável pelo Uruguai, Liverpool e Barcelona no histórico trio MSN.",
    wiki: "Luis_Su%C3%A1rez",
  },
  {
    slug: "karim-benzema",
    name: "Karim Benzema (KB9)",
    franchise: "Futebol Mundial",
    series: "Futebol e Copas do Mundo",
    nicheKey: "sport_football",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1340,
    atk: 97, def: 77, spd: 89, hp: 950,
    desc: "Bola de Ouro 2022 e pentacampeão da Champions pelo Real Madrid com atuações divinas.",
    wiki: "Karim_Benzema",
  },

  // ==========================================
  // 3. NBA / BASQUETE (sport_basketball)
  // ==========================================
  {
    slug: "victor-wembanyama",
    name: "Victor Wembanyama (The Alien)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1440,
    atk: 98, def: 99, spd: 92, hp: 1040,
    desc: "Fenômeno geracional dos Spurs com 2,24m de altura, tocos nas alturas e arremessos do perímetro.",
    wiki: "Victor_Wembanyama",
  },
  {
    slug: "anthony-edwards",
    name: "Anthony Edwards (Ant-Man)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1320,
    atk: 96, def: 88, spd: 98, hp: 950,
    desc: "Explosão atlética monstruosa e carisma de superestrela no Minnesota Timberwolves.",
    wiki: "Anthony_Edwards_(basketball)",
  },
  {
    slug: "jayson-tatum",
    name: "Jayson Tatum",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 96, def: 91, spd: 93, hp: 970,
    desc: "Campeão da NBA em 2024 pelo Boston Celtics e líder consistente da Conferência Leste.",
    wiki: "Jayson_Tatum",
  },
  {
    slug: "nikola-jokic",
    name: "Nikola Jokić (The Joker)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 99, def: 92, spd: 84, hp: 1060,
    desc: "3x MVP da NBA e campeão pelos Nuggets. Passes que desafiam a geometria e visão cósmica de jogo.",
    wiki: "Nikola_Joki%C4%87",
  },
  {
    slug: "joel-embiid",
    name: "Joel Embiid (The Process)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1330,
    atk: 98, def: 95, spd: 86, hp: 1050,
    desc: "MVP da liga em 2023 pelos 76ers e força irresistível no garrafão e meia-distância.",
    wiki: "Joel_Embiid",
  },
  {
    slug: "kevin-durant",
    name: "Kevin Durant (Slim Reaper)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 100, def: 90, spd: 93, hp: 980,
    desc: "O scorer mais indefensável de 2,10m da história do esporte. Bicampeão e MVP das Finais.",
    wiki: "Kevin_Durant",
  },
  {
    slug: "james-harden",
    name: "James Harden (The Beard)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1300,
    atk: 97, def: 80, spd: 91, hp: 940,
    desc: "Criador do stepback moderno e MVP da liga em 2018 com médias históricas de pontuação.",
    wiki: "James_Harden",
  },
  {
    slug: "magic-johnson",
    name: "Magic Johnson (Showtime)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 99, def: 88, spd: 96, hp: 1010,
    desc: "O maior armador de todos os tempos. Liderou a era Showtime dos Lakers com 5 títulos.",
    wiki: "Magic_Johnson",
  },
  {
    slug: "larry-bird",
    name: "Larry Bird (Larry Legend)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 99, def: 91, spd: 88, hp: 1000,
    desc: "Tricampeão pelos Celtics e um dos arremessadores mais implacáveis sob pressão que já existiu.",
    wiki: "Larry_Bird",
  },
  {
    slug: "wilt-chamberlain",
    name: "Wilt Chamberlain (The Big Dipper)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1490,
    atk: 100, def: 98, spd: 95, hp: 1080,
    desc: "O único homem a marcar 100 pontos em um único jogo da NBA. Recordes que nunca serão quebrados.",
    wiki: "Wilt_Chamberlain",
  },
  {
    slug: "bill-russell",
    name: "Bill Russell (11 Rings)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1480,
    atk: 92, def: 100, spd: 94, hp: 1060,
    desc: "O maior vencedor dos esportes coletivos americanos com 11 anéis de campeão da NBA.",
    wiki: "Bill_Russell",
  },
  {
    slug: "tim-duncan",
    name: "Tim Duncan (The Big Fundamental)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1450,
    atk: 97, def: 99, spd: 86, hp: 1040,
    desc: "Pentacampeão pelos Spurs e o maior ala-pivô de todos os tempos. Fundamentos inabaláveis.",
    wiki: "Tim_Duncan",
  },
  {
    slug: "dirk-nowitzki",
    name: "Dirk Nowitzki (O Gênio Alemão)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1440,
    atk: 98, def: 87, spd: 85, hp: 1000,
    desc: "Campeão épico de 2011 pelos Mavericks com seu clássico fadeaway indefensável em uma perna.",
    wiki: "Dirk_Nowitzki",
  },
  {
    slug: "dwyane-wade",
    name: "Dwyane Wade (Flash)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1330,
    atk: 97, def: 90, spd: 99, hp: 960,
    desc: "Tricampeão da NBA pelo Miami Heat com infiltrações ultrarrápidas que incendiavam a quadra.",
    wiki: "Dwyane_Wade",
  },
  {
    slug: "kyrie-irving",
    name: "Kyrie Irving (Uncle Drew)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1340,
    atk: 98, def: 78, spd: 98, hp: 910,
    desc: "O melhor controle de bola da história da NBA e autor da bola tripla do título de 2016 dos Cavaliers.",
    wiki: "Kyrie_Irving",
  },
  {
    slug: "ja-morant",
    name: "Ja Morant",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "EPIC",
    gender: "MALE",
    aether: 1200,
    atk: 95, def: 80, spd: 100, hp: 900,
    desc: "Saltos que parecem levitar no ar e enterradas acrobáticas espetaculares nos Grizzlies.",
    wiki: "Ja_Morant",
  },
  {
    slug: "damian-lillard",
    name: "Damian Lillard (Dame Time)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 97, def: 80, spd: 94, hp: 920,
    desc: "Arremessos do logo nos momentos clutch de eliminar adversários nos playoffs.",
    wiki: "Damian_Lillard",
  },
  {
    slug: "kawhi-leonard",
    name: "Kawhi Leonard (The Klaw)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1330,
    atk: 96, def: 99, spd: 92, hp: 970,
    desc: "Bicampeão e MVP das Finais por Spurs e Raptors com mãos de aço e frieza cirúrgica.",
    wiki: "Kawhi_Leonard",
  },
  {
    slug: "jimmy-butler",
    name: "Jimmy Butler (Jimmy Buckets)",
    franchise: "NBA / Basquete",
    series: "NBA Basketball Legends",
    nicheKey: "sport_basketball",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1300,
    atk: 95, def: 96, spd: 92, hp: 970,
    desc: "Coração de guerreiro dos playoffs no Miami Heat, levando a equipe a duas Finais históricas.",
    wiki: "Jimmy_Butler",
  },

  // ==========================================
  // 4. MÚSICA & TRAP (music_hiphop / music_rock / music_pop)
  // ==========================================
  {
    slug: "2pac",
    name: "2Pac (Tupac Shakur)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 99, def: 90, spd: 95, hp: 980,
    desc: "A lenda imortal do Rap mundial. Poesia revolucionária com All Eyez on Me e mais de 75 milhões de discos.",
    wiki: "Tupac_Shakur",
  },
  {
    slug: "notorious-big",
    name: "The Notorious B.I.G. (Biggie Smalls)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 99, def: 91, spd: 91, hp: 1020,
    desc: "O Rei de Nova York. Flow aveludado e métrica insuperável no clássico Ready to Die.",
    wiki: "The_Notorious_B.I.G.",
  },
  {
    slug: "kendrick-lamar",
    name: "Kendrick Lamar (K.Dot)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1480,
    atk: 99, def: 92, spd: 97, hp: 970,
    desc: "Vencedor do Prêmio Pulitzer com DAMN., versos cortantes e líder geracional do rap com Not Like Us.",
    wiki: "Kendrick_Lamar",
  },
  {
    slug: "drake",
    name: "Drake (Champagne Papi)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 97, def: 86, spd: 93, hp: 960,
    desc: "O artista com mais entradas no topo das paradas da história da Billboard e rei do streaming mundial.",
    wiki: "Drake_(musician)",
  },
  {
    slug: "kanye-west",
    name: "Kanye West (Ye)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1480,
    atk: 99, def: 88, spd: 94, hp: 980,
    desc: "Gênio musical inovador de Graduation e My Beautiful Dark Twisted Fantasy. Visionário da cultura pop.",
    wiki: "Kanye_West",
  },
  {
    slug: "chester-bennington",
    name: "Chester Bennington (Linkin Park)",
    franchise: "Música & Trap",
    series: "Ícones do Rock Mundial",
    nicheKey: "music_rock",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1460,
    atk: 98, def: 84, spd: 94, hp: 950,
    desc: "A voz mais marcante e emocionante do rock dos anos 2000 em Hybrid Theory e Meteora.",
    wiki: "Chester_Bennington",
  },
  {
    slug: "john-lennon",
    name: "John Lennon (The Beatles)",
    franchise: "Música & Trap",
    series: "Ícones do Rock Mundial",
    nicheKey: "music_rock",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 97, def: 90, spd: 90, hp: 970,
    desc: "Coração dos Beatles e compositor de Imagine, o maior hino pacifista da história da música.",
    wiki: "John_Lennon",
  },
  {
    slug: "david-bowie",
    name: "David Bowie (Starman)",
    franchise: "Música & Trap",
    series: "Ícones do Rock Mundial",
    nicheKey: "music_rock",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1470,
    atk: 97, def: 90, spd: 94, hp: 970,
    desc: "O Camaleão do Rock. Reinventou a música, identidade e estética com Ziggy Stardust e Heroes.",
    wiki: "David_Bowie",
  },
  {
    slug: "elvis-presley",
    name: "Elvis Presley (O Rei do Rock)",
    franchise: "Música & Trap",
    series: "Ícones do Rock Mundial",
    nicheKey: "music_rock",
    tier: "MYTHIC",
    gender: "MALE",
    aether: 1480,
    atk: 98, def: 88, spd: 92, hp: 990,
    desc: "O Rei do Rock and Roll que transformou a música jovem e a cultura mundial nos anos 1950.",
    wiki: "Elvis_Presley",
  },
  {
    slug: "bruno-mars",
    name: "Bruno Mars",
    franchise: "Música & Trap",
    series: "Ícones do Pop Mundial",
    nicheKey: "music_pop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1340,
    atk: 95, def: 86, spd: 96, hp: 930,
    desc: "Dança espetacular, vocais impecáveis e hits universais como Uptown Funk e 24K Magic.",
    wiki: "Bruno_Mars",
  },
  {
    slug: "lady-gaga",
    name: "Lady Gaga (Mother Monster)",
    franchise: "Música & Trap",
    series: "Ícones do Pop Mundial",
    nicheKey: "music_pop",
    tier: "MYTHIC",
    gender: "FEMALE",
    aether: 1450,
    atk: 97, def: 90, spd: 93, hp: 960,
    desc: "Voz estrondosa e presença teatral incomparável com Bad Romance, Poker Face e Shallow.",
    wiki: "Lady_Gaga",
  },
  {
    slug: "adele",
    name: "Adele",
    franchise: "Música & Trap",
    series: "Ícones do Pop Mundial",
    nicheKey: "music_pop",
    tier: "MYTHIC",
    gender: "FEMALE",
    aether: 1460,
    atk: 98, def: 92, spd: 87, hp: 980,
    desc: "A potência vocal mais aclamada da Inglaterra moderna com Rolling in the Deep e Someone Like You.",
    wiki: "Adele",
  },
  {
    slug: "lana-del-rey",
    name: "Lana Del Rey (Born to Die)",
    franchise: "Música & Trap",
    series: "Ícones do Pop Mundial",
    nicheKey: "music_pop",
    tier: "LEGENDARY",
    gender: "FEMALE",
    aether: 1320,
    atk: 93, def: 88, spd: 88, hp: 920,
    desc: "Ícone da melancolia cinematográfica e do pop barroco com Born to Die e Norman Fucking Rockwell.",
    wiki: "Lana_Del_Rey",
  },
  {
    slug: "asap-rocky",
    name: "A$AP Rocky (Lord Flacko)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 94, def: 85, spd: 93, hp: 920,
    desc: "O líder da A$AP Mob e ícone supremo que uniu o Rap de Harlem com o topo do mundo fashion.",
    wiki: "ASAP_Rocky",
  },
  {
    slug: "playboi-carti",
    name: "Playboi Carti (King Vamp)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1320,
    atk: 95, def: 82, spd: 96, hp: 910,
    desc: "Redefiniu a sonoridade do rage-trap moderno com Whole Lotta Red e culto underground maciço.",
    wiki: "Playboi_Carti",
  },
  {
    slug: "lil-peep",
    name: "Lil Peep (Goth Angel Sinner)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 93, def: 81, spd: 90, hp: 890,
    desc: "Pioneiro da fusão entre emo e trap com canções confessionais eternas como Star Shopping.",
    wiki: "Lil_Peep",
  },
  {
    slug: "juice-wrld",
    name: "Juice WRLD (999)",
    franchise: "Música & Trap",
    series: "Ícones do Hip-Hop Mundial",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1330,
    atk: 95, def: 83, spd: 93, hp: 910,
    desc: "O rei do freestyle melódico e vulnerável com Lucid Dreams e All Girls Are the Same.",
    wiki: "Juice_Wrld",
  },
  {
    slug: "kayblack",
    name: "KayBlack",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 94, def: 84, spd: 93, hp: 920,
    desc: "Uma das maiores vozes do trap nacional. Flow cortante e hits como Sal e Pedaço de Mim.",
    wiki: "KayBlack",
    wikiLang: "pt",
  },
  {
    slug: "veigh",
    name: "Veigh (Dos Prédios)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 95, def: 84, spd: 94, hp: 920,
    desc: "Quebrou recordes mundiais com Dos Prédios Deluxe. O fenômeno absoluto de Itapevi no trap.",
    wiki: "Veigh",
    wikiLang: "pt",
  },
  {
    slug: "mc-cabelinho",
    name: "MC Cabelinho (Little Hair)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1290,
    atk: 94, def: 83, spd: 93, hp: 910,
    desc: "Astro das favelas cariocas e do trap romântico com o álbum de sucesso Little Love.",
    wiki: "MC_Cabelinho",
    wikiLang: "pt",
  },
  {
    slug: "filipe-ret",
    name: "Filipe Ret (Nume / FR)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1320,
    atk: 95, def: 86, spd: 92, hp: 930,
    desc: "Pioneiro da lírica carioca e dono da Nadamal Records com Vivaz e Lume.",
    wiki: "Filipe_Ret",
    wikiLang: "pt",
  },
  {
    slug: "orochi",
    name: "Orochi (Mainstreet)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1310,
    atk: 95, def: 85, spd: 93, hp: 930,
    desc: "Campeão das batalhas de MCs e fundador da gigante gravadora Mainstreet no Rio.",
    wiki: "Orochi_(rapper)",
    wikiLang: "pt",
  },
  {
    slug: "l7nnon",
    name: "L7NNON (L7)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 93, def: 87, spd: 94, hp: 920,
    desc: "O trapper e skatista do Realengo com hits gigantescos como Freio da Blazer e Ai Preto.",
    wiki: "L7nnon",
    wikiLang: "pt",
  },
  {
    slug: "mc-poze-do-rodo",
    name: "MC Poze do Rodo (O Pitbull)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1290,
    atk: 95, def: 83, spd: 92, hp: 920,
    desc: "A voz crua e verídica da favela carioca com Me Sinto Abençoado e Eu Fiz o Jogo Virar.",
    wiki: "MC_Poze_do_Rodo",
    wikiLang: "pt",
  },
  {
    slug: "mc-ryan-sp",
    name: "MC Ryan SP (O Tubarão)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 94, def: 85, spd: 91, hp: 940,
    desc: "O Tubarão de São Paulo, recordista absoluto de faixas no topo do Spotify Brasil.",
    wiki: "MC_Ryan_SP",
    wikiLang: "pt",
  },
  {
    slug: "wiu",
    name: "WIU (Manual de Como Amar Errado)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1270,
    atk: 93, def: 83, spd: 94, hp: 900,
    desc: "Produtor e hitmaker genial de Fortaleza da 30PRAUM com Coração de Gelo e Felina.",
    wiki: "Wiu",
    wikiLang: "pt",
  },
  {
    slug: "teto",
    name: "Teto (O Rei das Prévias)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1280,
    atk: 94, def: 82, spd: 95, hp: 900,
    desc: "O fenômeno baiano da 30PRAUM com M4, Paypal e fluxo melódico inconfundível.",
    wiki: "Teto_(cantor)",
    wikiLang: "pt",
  },
  {
    slug: "djonga",
    name: "Djonga (Lírica Mineira)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1330,
    atk: 96, def: 88, spd: 92, hp: 940,
    desc: "Força poética e política avassaladora de BH em O Menino que Queria Ser Deus e Ladrão.",
    wiki: "Djonga",
    wikiLang: "pt",
  },
  {
    slug: "bk",
    name: "BK' (Abebe Bikila / Icarus)",
    franchise: "Música & Trap",
    series: "Trap Brasileiro & Funk",
    nicheKey: "music_hiphop",
    tier: "LEGENDARY",
    gender: "MALE",
    aether: 1320,
    atk: 96, def: 87, spd: 91, hp: 940,
    desc: "Um dos maiores letristas do Hip-Hop nacional com Castelos & Ruínas e o espetáculo Icarus.",
    wiki: "BK%27",
    wikiLang: "pt",
  },
];

async function fetchWikiImage(item: ExpandedLegend): Promise<Buffer | null> {
  const lang = item.wikiLang ?? "en";
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    item.wiki
  )}&prop=pageimages&format=json&pithumbsize=600`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "KoguBot/2.0 (contact@kogu.bot)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const pages = data.query?.pages;
    if (!pages) return null;
    const pageId = Object.keys(pages)[0];
    const thumbUrl = pages[pageId]?.thumbnail?.source;
    if (!thumbUrl) return null;

    const imgRes = await fetch(thumbUrl, {
      headers: { "User-Agent": "KoguBot/2.0 (contact@kogu.bot)" },
    });
    if (!imgRes.ok) return null;
    const arr = await imgRes.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  }
}

export async function seedPopCultureExpanded(dbUrl = DATABASE_URL) {
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });
  console.log(`[Seed] Conectando ao banco para adicionar ${EXPANDED_LEGENDS.length} novas cartas...`);

  // Diretório onde as imagens das cartas ficam hospedadas para o GitHub Pages
  const cardsDir = path.resolve("docs/assets/cards");
  if (!fs.existsSync(cardsDir)) fs.mkdirSync(cardsDir, { recursive: true });

  // Fallback padrão se não tiver imagem
  const defaultFallback = fs.existsSync(path.join(cardsDir, "pele.jpg"))
    ? fs.readFileSync(path.join(cardsDir, "pele.jpg"))
    : Buffer.alloc(0);

  let inserted = 0;
  let downloadedImages = 0;

  // 1. Processa e baixa as imagens das cartas primeiro
  console.log("[Seed] Verificando e baixando imagens oficiais das cartas...");
  for (const item of EXPANDED_LEGENDS) {
    const filePath = path.join(cardsDir, `${item.slug}.jpg`);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1000) {
      process.stdout.write(`  Baixando arte de ${item.name}... `);
      const imgBuf = await fetchWikiImage(item);
      if (imgBuf && imgBuf.length > 1000) {
        fs.writeFileSync(filePath, imgBuf);
        downloadedImages++;
        console.log(`✓ (${Math.round(imgBuf.length / 1024)} KB)`);
      } else if (defaultFallback.length > 0) {
        fs.writeFileSync(filePath, defaultFallback);
        console.log(`(fallback aplicado)`);
      } else {
        console.log(`(sem imagem)`);
      }
    }
  }
  console.log(`[Seed] Imagens prontas: ${downloadedImages} novas baixadas com sucesso.`);

  // 2. Insere as entidades no banco
  await sql.begin(async (tx) => {
    // Carrega mapa de nichos
    const nicheRows = await tx<{ id: number; key: string }[]>`SELECT id::int, key FROM niches`;
    const nicheMap = new Map<string, number>();
    for (const n of nicheRows) nicheMap.set(n.key, n.id);

    const [maxRankRow] = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(popularity_rank), 1400)::int AS max FROM entities
    `;
    let nextRank = maxRankRow?.max ?? 1400;

    for (const item of EXPANDED_LEGENDS) {
      const slug = item.slug;
      const norm = normalizeName(item.name);
      const franchiseSlug = slugify(item.franchise);
      const seriesSlug = slugify(item.series);
      const nicheId = nicheMap.get(item.nicheKey) ?? null;

      // 1. Franquia
      const [fr] = await tx<{ id: number }[]>`
        INSERT INTO franchises (slug, name)
        VALUES (${franchiseSlug}, ${item.franchise})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id::int
      `;

      // 2. Série
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
      if (existing.length > 0) {
        // Atualiza niche_id se estiver nulo
        if (nicheId) {
          await tx`UPDATE entities SET niche_id = ${nicheId} WHERE id = ${existing[0].id}`;
        }
        continue;
      }

      nextRank++;
      const rollWeight = TIER_WEIGHT[item.tier];
      const hostedImg = `https://yo-apollon.github.io/kogu/assets/cards/${item.slug}.jpg`;

      // 4. Entidade
      const [ent] = await tx<{ id: number }[]>`
        INSERT INTO entities (
          slug, name, name_native, name_normalized, universe, type, gender, status,
          tier, franchise_id, niche_id, edition, description, base_aether, roll_weight, popularity_rank,
          base_atk, base_def, base_spd, base_hp, stats_seed
        ) VALUES (
          ${slug}, ${item.name}, ${item.name}, ${norm}, 'CINEMA', 'CHARACTER', ${item.gender}, 'ACTIVE',
          ${item.tier}, ${fr.id}, ${nicheId}, 'BASIC', ${item.desc}, ${item.aether}, ${rollWeight}, ${nextRank},
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

  console.log(`[Seed] Sucesso: ${inserted} novas entidades inseridas no banco!`);
  await sql.end();
  return inserted;
}

if (import.meta.url.endsWith("seedPopCultureExpanded.ts")) {
  seedPopCultureExpanded().catch((err) => {
    console.error("Erro ao rodar seedPopCultureExpanded:", err);
    process.exit(1);
  });
}
