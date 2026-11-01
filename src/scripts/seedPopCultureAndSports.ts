/**
 * Seed das 44 Lendas do UFC, Futebol, Basquete (NBA) e Música Mundial.
 *
 * Execução:
 *   npx tsx src/scripts/seedPopCultureAndSports.ts
 */
import postgres from "postgres";
import { TIER_WEIGHT, type EntityTier } from "../config/gacha.js";
import { normalizeName, slugify } from "../lib/text/normalize.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:arqon_dev_pw@127.0.0.1:54329/arqon_dev";

export interface LegendEntry {
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
}

export const LEGENDS: readonly LegendEntry[] = [
  // UFC / MMA
  { slug: "alex-pereira", name: "Alex Poatan Pereira (Chama)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "MYTHIC", gender: "MALE", aether: 1400, atk: 99, def: 88, spd: 86, hp: 980, desc: "Bicampeão do UFC (Médio e Meio-Pesado) e lenda do Kickboxing. Conhecido pelo lendário cruzado de esquerda ('Chama')." },
  { slug: "jon-jones", name: "Jon Jones (Bones)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "MYTHIC", gender: "MALE", aether: 1390, atk: 98, def: 96, spd: 90, hp: 1000, desc: "Considerado o maior lutador de MMA de todos os tempos. Campeão dos pesos pesados e meio-pesados." },
  { slug: "charles-do-bronx", name: "Charles do Bronx (O Iluminado)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "LEGENDARY", gender: "MALE", aether: 1260, atk: 95, def: 85, spd: 94, hp: 920, desc: "Maior finalizador e recordista de bônus da história do UFC. O campeão tem nome: Charles do Bronx." },
  { slug: "conor-mcgregor", name: "Conor McGregor (The Notorious)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "LEGENDARY", gender: "MALE", aether: 1280, atk: 96, def: 80, spd: 95, hp: 880, desc: "O primeiro campeão duplo simultâneo da história do UFC e o maior astro de pay-per-view dos esportes de combate." },
  { slug: "khabib-nurmagomedov", name: "Khabib Nurmagomedov (The Eagle)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "MYTHIC", gender: "MALE", aether: 1380, atk: 92, def: 99, spd: 90, hp: 1020, desc: "Invicto com 29 vitórias e 0 derrotas. Dominou a divisão peso leve com seu grappling avassalador de Daguestão." },
  { slug: "israel-adesanya", name: "Israel Adesanya (The Last Stylebender)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "LEGENDARY", gender: "MALE", aether: 1220, atk: 94, def: 86, spd: 96, hp: 900, desc: "Mestre da precisão e do contra-ataque. Ex-campeão dos médios apaixonado por anime e cultura geek." },
  { slug: "anderson-silva", name: "Anderson Silva (The Spider)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "MYTHIC", gender: "MALE", aether: 1370, atk: 97, def: 95, spd: 98, hp: 940, desc: "Maior reinado como campeão na história do UFC (16 vitórias consecutivas). Movimentação estilo Matrix." },
  { slug: "amanda-nunes", name: "Amanda Nunes (The Lioness)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "MYTHIC", gender: "FEMALE", aether: 1350, atk: 96, def: 92, spd: 90, hp: 950, desc: "A maior lutadora de MMA da história. Dupla campeã simultânea peso-galo e peso-pena com nocautes brutais." },
  { slug: "ilia-topuria", name: "Ilia Topuria (El Matador)", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "LEGENDARY", gender: "MALE", aether: 1210, atk: 95, def: 88, spd: 93, hp: 890, desc: "Campeão peso-pena invicto do UFC, derrubou Alexander Volkanovski com um nocaute cirúrgico." },
  { slug: "islam-makhachev", name: "Islam Makhachev", franchise: "UFC / MMA", series: "UFC (Ultimate Fighting Championship)", tier: "LEGENDARY", gender: "MALE", aether: 1240, atk: 93, def: 97, spd: 89, hp: 960, desc: "Atual campeão peso-leve e #1 peso-por-peso do UFC, herdeiro do lendário treino de Abdulmanap Nurmagomedov." },

  // FUTEBOL MUNDIAL
  { slug: "pele", name: "Pelé (O Rei do Futebol)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1500, atk: 100, def: 85, spd: 97, hp: 1050, desc: "O Atleta do Século. Único tricampeão mundial da Copa do Mundo (1958, 1962, 1970) e mais de 1.200 gols." },
  { slug: "lionel-messi", name: "Lionel Messi (La Pulga / GOAT)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1480, atk: 99, def: 78, spd: 96, hp: 990, desc: "8x vencedor da Bola de Ouro e campeão da Copa do Mundo de 2022 com a Argentina. O gênio da camisa 10." },
  { slug: "cristiano-ronaldo", name: "Cristiano Ronaldo (CR7 / Mister Champions)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1480, atk: 99, def: 82, spd: 98, hp: 1010, desc: "Maior artilheiro em jogos oficiais da história do futebol. 5x Bola de Ouro e 5 títulos de Champions League." },
  { slug: "ronaldinho-gaucho", name: "Ronaldinho Gaúcho (O Bruxo)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1420, atk: 97, def: 75, spd: 98, hp: 940, desc: "A personificação do futebol-arte. Dribles desconcertantes, aplaudido de pé no Santiago Bernabéu." },
  { slug: "neymar-jr", name: "Neymar Jr (Menino Ney)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1300, atk: 96, def: 72, spd: 97, hp: 910, desc: "Maior artilheiro da Seleção Brasileira em jogos oficiais. Campeão da Champions League e ouro olímpico." },
  { slug: "ronaldo-fenomeno", name: "Ronaldo Fenômeno (R9)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1450, atk: 100, def: 76, spd: 99, hp: 970, desc: "Potência, velocidade e finalização incomparáveis. Herói do pentacampeonato mundial do Brasil em 2002." },
  { slug: "kylian-mbappe", name: "Kylian Mbappé", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1320, atk: 97, def: 70, spd: 100, hp: 920, desc: "Velocidade sônica e frieza implacável. Campeão do Mundo em 2018 com a França e hat-trick na final de 2022." },
  { slug: "erling-haaland", name: "Erling Haaland (O Ciborgue)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1310, atk: 98, def: 84, spd: 92, hp: 980, desc: "A máquina de gols norueguesa do Manchester City. Recordista histórico de gols em uma edição da Premier League." },
  { slug: "vini-jr", name: "Vini Jr (Baila Vini)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1290, atk: 96, def: 74, spd: 99, hp: 900, desc: "Estrela do Real Madrid, autor dos gols dos títulos da Champions League 2022 e 2024. O pesadelo das defesas." },
  { slug: "marta-vieira", name: "Marta (Rainha do Futebol)", franchise: "Futebol Mundial", series: "Futebol e Copas do Mundo", tier: "MYTHIC", gender: "FEMALE", aether: 1400, atk: 96, def: 80, spd: 94, hp: 940, desc: "6 vezes eleita a Melhor Jogadora do Mundo pela FIFA. Maior artilheira de todas as Copas do Mundo." },

  // BASQUETE / NBA
  { slug: "michael-jordan", name: "Michael Jordan (Air Jordan)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "MYTHIC", gender: "MALE", aether: 1500, atk: 100, def: 96, spd: 98, hp: 1020, desc: "O maior jogador de basquete da história. 6x campeão da NBA e 6x MVP das Finais pelo Chicago Bulls." },
  { slug: "lebron-james", name: "LeBron James (King James)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "MYTHIC", gender: "MALE", aether: 1470, atk: 98, def: 94, spd: 94, hp: 1050, desc: "Maior pontuador de todos os tempos da NBA. 4 títulos por 3 franquias diferentes e longevidade sobre-humana." },
  { slug: "kobe-bryant", name: "Kobe Bryant (Black Mamba)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "MYTHIC", gender: "MALE", aether: 1480, atk: 99, def: 95, spd: 95, hp: 1000, desc: "A lendária Mamba Mentality. 5 títulos da NBA pelos Los Angeles Lakers e 81 pontos em um único jogo." },
  { slug: "stephen-curry", name: "Stephen Curry (Chef Curry)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "MYTHIC", gender: "MALE", aether: 1420, atk: 99, def: 75, spd: 96, hp: 900, desc: "Revolucionou a história do basquete moderno com seu arremesso de 3 pontos. 4x campeão pelos Warriors." },
  { slug: "shaquille-oneal", name: "Shaquille O'Neal (Shaq Diesel)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "LEGENDARY", gender: "MALE", aether: 1350, atk: 98, def: 97, spd: 78, hp: 1100, desc: "A força mais dominante e imparável que o garrafão da NBA já presenciou. Tetracampeão da liga." },
  { slug: "luka-doncic", name: "Luka Dončić (Luka Magic)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "LEGENDARY", gender: "MALE", aether: 1260, atk: 96, def: 82, spd: 88, hp: 950, desc: "O maestro esloveno dos Dallas Mavericks. Triplo-duplos históricos com facilidade absurda." },
  { slug: "giannis-antetokounmpo", name: "Giannis Antetokounmpo (Greek Freak)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "LEGENDARY", gender: "MALE", aether: 1340, atk: 97, def: 96, spd: 93, hp: 1040, desc: "Físico e atletismo devastadores. Campeão da NBA de 2021 com 50 pontos no jogo decisivo das Finais." },
  { slug: "allen-iverson", name: "Allen Iverson (The Answer)", franchise: "NBA / Basquete", series: "NBA Basketball Legends", tier: "LEGENDARY", gender: "MALE", aether: 1250, atk: 96, def: 80, spd: 100, hp: 880, desc: "O crossover mais mortal do basquete e um dos maiores ícones culturais da história da NBA." },

  // MÚSICA & CANTORES
  { slug: "michael-jackson", name: "Michael Jackson (O Rei do Pop)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1500, atk: 95, def: 90, spd: 100, hp: 1000, desc: "O maior entertainer de todos os tempos. Thriller continua sendo o álbum mais vendido da história humana." },
  { slug: "freddie-mercury", name: "Freddie Mercury (Queen)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1470, atk: 98, def: 88, spd: 94, hp: 980, desc: "A voz mais espetacular da história do Rock. Apresentação imortal no Live Aid de 1985 em Wembley." },
  { slug: "eminem", name: "Eminem (Slim Shady / Rap God)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1450, atk: 99, def: 85, spd: 99, hp: 950, desc: "O Rap God de Detroit. Rimas métricas na velocidade da luz e mais de 220 milhões de discos vendidos." },
  { slug: "taylor-swift", name: "Taylor Swift (The Eras)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "FEMALE", aether: 1460, atk: 94, def: 88, spd: 92, hp: 960, desc: "Fenômeno global com The Eras Tour, quebrando todos os recordes históricos da indústria da música." },
  { slug: "the-weeknd", name: "The Weeknd (Abel Tesfaye)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1320, atk: 92, def: 84, spd: 91, hp: 920, desc: "Criador de Blinding Lights, a música mais ouvida da história do Spotify. Estética cinematográfica marcante." },
  { slug: "travis-scott", name: "Travis Scott (La Flame)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1290, atk: 94, def: 82, spd: 93, hp: 910, desc: "A energia explosiva dos maiores festivais do planeta. Criador do clássico Astroworld e Utopia." },
  { slug: "beyonce", name: "Beyoncé (Queen Bey)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "FEMALE", aether: 1440, atk: 96, def: 90, spd: 95, hp: 970, desc: "A artista mais premiada da história do Grammy com 32 gramofones de ouro. Presença de palco soberana." },
  { slug: "rihanna", name: "Rihanna (Bad Gal Riri)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "FEMALE", aether: 1330, atk: 93, def: 86, spd: 90, hp: 930, desc: "Bilionária e ícone pop de Barbados com 14 singles em primeiro lugar na Billboard Hot 100." },
  { slug: "kurt-cobain", name: "Kurt Cobain (Nirvana)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1350, atk: 95, def: 80, spd: 89, hp: 900, desc: "Voz de uma geração e líder do Nirvana. Redefiniu o rock mundial com o álbum Nevermind e Smells Like Teen Spirit." },
  { slug: "daft-punk", name: "Daft Punk (Robôs Lendários)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "NONBINARY", aether: 1410, atk: 94, def: 96, spd: 95, hp: 990, desc: "A lendária dupla de capacetes dourados e prateados que revolucionou a música eletrônica com Discovery e Random Access Memories." },
  { slug: "matue", name: "Matuê (30PRAUM)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1240, atk: 92, def: 82, spd: 92, hp: 890, desc: "O pioneiro do Trap Brasileiro. Quebrou recordes de streaming nacional com Máquina do Tempo e 333." },
  { slug: "billie-eilish", name: "Billie Eilish", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "FEMALE", aether: 1270, atk: 91, def: 85, spd: 88, hp: 910, desc: "Jovem prodígio vencedora de múltiplos Grammys e dois Oscars. Vocais sussurrados e produção inovadora." },
  { slug: "dua-lipa", name: "Dua Lipa", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "FEMALE", aether: 1260, atk: 92, def: 84, spd: 91, hp: 900, desc: "A rainha da era Disco-Pop com Future Nostalgia, acumulando bilhões de streams em todo o globo." },
  { slug: "post-malone", name: "Post Malone (Rockstar)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1250, atk: 91, def: 83, spd: 90, hp: 910, desc: "Versatilidade entre hip-hop, rock e country. Sucessos estrondosos como Circles, Sunflower e Rockstar." },
  { slug: "bob-marley", name: "Bob Marley (Rei do Reggae)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "MYTHIC", gender: "MALE", aether: 1430, atk: 90, def: 92, spd: 90, hp: 1000, desc: "Símbolo global de paz, espiritualidade e liberdade. Levou o Reggae e a cultura rastafári da Jamaica para o universo." },
  { slug: "snoop-dogg", name: "Snoop Dogg (D-O-Double-G)", franchise: "Lendas da Música", series: "Ícones Musicais do Mundo", tier: "LEGENDARY", gender: "MALE", aether: 1280, atk: 93, def: 87, spd: 91, hp: 930, desc: "A lenda viva do West Coast Hip-Hop da Death Row Records. Estilo inconfundível, flow suave e carisma eterno." }
];

export async function seedPopCultureAndSports(dbUrl = DATABASE_URL) {
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {} });

  console.log(`Conectado ao banco. Inserindo ${LEGENDS.length} lendas do esporte e música...`);
  let inserted = 0;

  await sql.begin(async (tx) => {
    const [maxRankRow] = await tx<{ max: number }[]>`
      SELECT COALESCE(MAX(popularity_rank), 1400)::int AS max FROM entities
    `;
    let nextRank = maxRankRow?.max ?? 1400;

    for (const item of LEGENDS) {
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
