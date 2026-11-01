import {
  Message,
  EmbedBuilder,
  AttachmentBuilder,
} from "discord.js";
import { db } from "../database/index.js";
import { entities, pacts, guildProfiles, wishes, users, characterSuggestions } from "../database/schema.js";
import { eq, and, like, desc, sql } from "drizzle-orm";
import { renderCharacterCard } from "../canvas/cardRenderer.js";
import { fetchAniListImage } from "../scripts/seed.js";
import crypto from "crypto";

/**
 * Garante que o perfil do usuário existe no servidor atual
 */
async function ensureGuildProfile(guildId: string, userId: string, username: string) {
  db.insert(users)
    .values({ id: userId, username })
    .onConflictDoUpdate({ target: users.id, set: { username } })
    .run();

  let profile = await db.query.guildProfiles.findFirst({
    where: and(eq(guildProfiles.guildId, guildId), eq(guildProfiles.userId, userId)),
  });

  if (!profile) {
    const id = crypto.randomUUID();
    db.insert(guildProfiles)
      .values({
        id,
        guildId,
        userId,
        aetherBalance: 500, // Bônus inicial de boas-vindas
        rollsRemaining: 10,
        pactsAvailable: 1,
        stackedRolls: 0,
      })
      .run();
    profile = await db.query.guildProfiles.findFirst({
      where: and(eq(guildProfiles.guildId, guildId), eq(guildProfiles.userId, userId)),
    });
  }
  return profile!;
}

/**
 * 1. $im / $infomarry / $info <nome> — Inspeciona qualquer personagem com carta AAA renderizada
 */
export async function handleInfoCommand(message: Message, args: string[]) {
  const query = args.join(" ").trim();
  if (!query) {
    return message.reply("🔍 Informe o nome do personagem ou série. Exemplo: `$im Zero Two` ou `$im Satoru Gojo`");
  }

  const allEntities = await db.select().from(entities);
  const found = allEntities.find(
    (e) =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.franchise.toLowerCase().includes(query.toLowerCase())
  );

  if (!found) {
    return message.reply(
      `❌ Nenhuma entidade encontrada para **"${query}"**.\n💡 Dica: Você pode importar qualquer personagem de Anime/Game em tempo real usando \`$import ${query}\`!`
    );
  }

  const existingPact = await db.query.pacts.findFirst({
    where: and(eq(pacts.guildId, message.guildId!), eq(pacts.entityId, found.id)),
  });

  let ownerName: string | undefined;
  if (existingPact) {
    const ownerUser = await db.query.users.findFirst({ where: eq(users.id, existingPact.userId) });
    ownerName = ownerUser?.username || "Selado";
  }

  let images: string[] = [];
  try {
    images = JSON.parse(found.imagesJson || "[]");
  } catch {
    images = [];
  }

  const cardBuffer = await renderCharacterCard({
    name: found.name,
    franchise: found.franchise,
    universe: found.universe,
    imageUrl: images[0],
    variant: (existingPact?.variant as any) || "STANDARD",
    awakeningKeys: existingPact?.awakeningKeys || 0,
    aetherValue: found.baseAether,
    popularityRank: found.popularityRank,
    atk: found.baseAtk,
    def: found.baseDef,
    spd: found.baseSpd,
    ownerName,
  });

  const attachment = new AttachmentBuilder(cardBuffer, { name: "kogu-info.png" });

  const genderSymbol = found.gender === "FEMALE" ? "♀" : found.gender === "MALE" ? "♂" : "⚧";
  const claimRank = found.popularityRank && found.popularityRank < 99999 ? `#${found.popularityRank}` : `#1`;
  const likeRank = `#${Math.max(1, (found.popularityRank || 1) + 44)}`;
  const keysCount = existingPact?.awakeningKeys || 0;
  const keysDisplay = keysCount > 0 ? ` · 🗝️ (${keysCount})` : "";

  const rouletteName =
    found.universe === "ANIME"
      ? "Animanga roulette"
      : found.universe === "GAME"
      ? "Game roulette"
      : found.universe === "CINEMA"
      ? "Cinema roulette"
      : "Dimensional roulette";

  let desc = `**${found.franchise}** ${genderSymbol}\n`;
  desc += `*${rouletteName}* · **${found.baseAether}** 💠${keysDisplay}\n`;
  desc += `Claim Rank: ${claimRank}\n`;
  desc += `Like Rank: ${likeRank}\n`;
  desc += `Power (+${Math.round(found.baseAether / 100)})\n`;
  if (found.description) {
    desc += `\n*${found.description.slice(0, 160)}...*`;
  }

  const embed = new EmbedBuilder()
    .setAuthor({
      name: found.name,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(desc)
    .setImage("attachment://kogu-info.png")
    .setColor(0xe03b54);

  if (existingPact) {
    embed.setFooter({
      text: `Belongs to ${ownerName} ~ 1 / 50 [${found.baseAether}]`,
      iconURL: message.guild?.iconURL() || undefined,
    });
  } else {
    embed.setFooter({
      text: `Livre para Pacto ~ 1 / 50 [${found.baseAether}]`,
    });
  }

  return message.reply({ embeds: [embed], files: [attachment] });
}

/**
 * 2. $pr / $profile — Perfil Dimensional completo do jogador
 */
export async function handleProfileCommand(message: Message) {
  const targetUser = message.mentions.users.first() || message.author;
  const guildId = message.guildId!;
  const profile = await ensureGuildProfile(guildId, targetUser.id, targetUser.username);

  const userPacts = await db
    .select({ pact: pacts, entity: entities })
    .from(pacts)
    .innerJoin(entities, eq(pacts.entityId, entities.id))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, targetUser.id)));

  const totalValue = userPacts.reduce((acc, item) => acc + (item.entity.baseAether || 0), 0);
  const totalKeys = userPacts.reduce((acc, item) => acc + (item.pact.awakeningKeys || 0), 0);
  const soulmates = userPacts.filter((item) => (item.pact.awakeningKeys || 0) >= 10).length;

  // Líder do Panteão (maior Éter ou favorito)
  const topEntity = [...userPacts].sort((a, b) => b.entity.baseAether - a.entity.baseAether)[0];
  let thumbUrl = targetUser.displayAvatarURL();
  if (topEntity) {
    try {
      const imgs = JSON.parse(topEntity.entity.imagesJson || "[]");
      if (imgs[0]) thumbUrl = imgs[0];
    } catch {}
  }

  const relics = [
    `🥉 **Bronze** Nv.${profile.relicBronze}`,
    `🥈 **Prata** Nv.${profile.relicSilver}`,
    `🥇 **Ouro** Nv.${profile.relicGold}`,
    `💎 **Safira** Nv.${profile.relicSapphire}`,
    `🩸 **Rubi** Nv.${profile.relicRuby}`,
    `💚 **Esmeralda** Nv.${profile.relicEmerald}`,
  ].join(" • ");

  const embed = new EmbedBuilder()
    .setTitle(`👑 Perfil Dimensional — ${targetUser.username}`)
    .setThumbnail(thumbUrl)
    .setColor("#E879F9")
    .addFields(
      {
        name: "💠 Economia de Éter",
        value: `Saldo Atual: **${profile.aetherBalance} Éter**\nPatrimônio do Panteão: **${totalValue} Éter**`,
        inline: true,
      },
      {
        name: "🏛️ Panteão & Despertar",
        value: `Entidades Seladas: **${userPacts.length}**\nSelos de Despertar (★): **${totalKeys}**\nAlmas Gêmeas (★10+): **${soulmates}**`,
        inline: true,
      },
      {
        name: "🌟 Líder do Panteão ($fm)",
        value: topEntity
          ? `**${topEntity.entity.name}** (${topEntity.entity.franchise}) — 💠 ${topEntity.entity.baseAether}`
          : "*Nenhuma entidade ainda*",
        inline: false,
      },
      {
        name: "🏺 Relíquias Dimensionais ($k)",
        value: relics,
        inline: false,
      }
    )
    .setFooter({ text: "Use $pt para ver sua coleção • $k para evoluir Relíquias • $daily para resgatar bônus" });

  return message.reply({ embeds: [embed] });
}

/**
 * 3. $dissolve / $divorce <nome> — Dissolve um pacto e recebe 100% do valor em Éter
 */
export async function handleDissolveCommand(message: Message, args: string[]) {
  const query = args.join(" ").trim();
  if (!query) {
    return message.reply("⚠️ Informe o nome da entidade que deseja dissolver. Exemplo: `$divorce Zero Two`");
  }

  const guildId = message.guildId!;
  const userId = message.author.id;

  const userPacts = await db
    .select({ pact: pacts, entity: entities })
    .from(pacts)
    .innerJoin(entities, eq(pacts.entityId, entities.id))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, userId)));

  const match = userPacts.find((p) => p.entity.name.toLowerCase().includes(query.toLowerCase()));
  if (!match) {
    return message.reply(`❌ Você não possui nenhuma entidade chamada **"${query}"** no seu Panteão.`);
  }

  const refund = match.entity.baseAether || 150;
  db.delete(pacts).where(eq(pacts.id, match.pact.id)).run();

  const profile = await ensureGuildProfile(guildId, userId, message.author.username);
  const newBalance = (profile.aetherBalance || 0) + refund;
  db.update(guildProfiles)
    .set({ aetherBalance: newBalance })
    .where(eq(guildProfiles.id, profile.id))
    .run();

  return message.reply(
    `💔 Pacto com **${match.entity.name}** foi dissolvido! Você absorveu **+${refund} Éter 💠** (Novo saldo: **${newBalance} Éter**).`
  );
}

/**
 * 4. $daily / $dk — Resgate diário de Éter e Rolls Empilhados ($rolls)
 */
export async function handleDailyCommand(message: Message) {
  const guildId = message.guildId!;
  const userId = message.author.id;
  const profile = await ensureGuildProfile(guildId, userId, message.author.username);

  const rewardAether = Math.floor(Math.random() * 250) + 350; // 350 a 600 Éter
  const newBalance = (profile.aetherBalance || 0) + rewardAether;
  const newStacked = (profile.stackedRolls || 0) + 5;

  db.update(guildProfiles)
    .set({
      aetherBalance: newBalance,
      stackedRolls: newStacked,
      rollsRemaining: 10,
      pactsAvailable: 1,
    })
    .where(eq(guildProfiles.id, profile.id))
    .run();

  const embed = new EmbedBuilder()
    .setTitle("🎁 Bônus Dimensional Diário Resgatado!")
    .setColor("#00FFA3")
    .setDescription(
      `✨ **+${rewardAether} Éter 💠** adicionados à sua conta!\n` +
        `🎲 **+5 Invocações Empilhadas** adicionadas!\n` +
        `🔄 Suas invocações da hora (**10/10**) e carga de Pacto foram restauradas!\n\n` +
        `💰 **Saldo Atual:** \`${newBalance} Éter\``
    );

  return message.reply({ embeds: [embed] });
}

/**
 * 5. $k / $kakera / $relics — Painel e Evolução de Relíquias (Equivalente aos Badges do Mudae)
 */
export async function handleRelicsCommand(message: Message, args: string[]) {
  const guildId = message.guildId!;
  const userId = message.author.id;
  const profile = await ensureGuildProfile(guildId, userId, message.author.username);

  const sub = args[0]?.toLowerCase();
  const relicMap: Record<string, { col: keyof typeof profile; name: string; cost: number; desc: string }> = {
    bronze: { col: "relicBronze", name: "🥉 Relíquia de Bronze", cost: 500, desc: "+25% Éter ao rolar desejos ($wish)" },
    silver: { col: "relicSilver", name: "🥈 Relíquia de Prata", cost: 1000, desc: "+2 Slots na Lista de Desejos ($wl)" },
    gold: { col: "relicGold", name: "🥇 Relíquia de Ouro", cost: 1500, desc: "Reduz custo de recarga de Orbes" },
    sapphire: { col: "relicSapphire", name: "💎 Relíquia de Safira", cost: 2500, desc: "Transforma Orbes Azuis em Amarelos (+500 Éter)" },
    ruby: { col: "relicRuby", name: "🩸 Relíquia de Rubi", cost: 4000, desc: "-25% no preço de todas as outras Relíquias" },
    emerald: { col: "relicEmerald", name: "💚 Relíquia de Esmeralda", cost: 5000, desc: "Faz todo Pacto render o valor da carta em Éter na hora!" },
  };

  if (sub && relicMap[sub]) {
    const target = relicMap[sub];
    const currentLevel = Number(profile[target.col] || 0);
    if (currentLevel >= 4) {
      return message.reply(`🌟 Sua **${target.name}** já está no Nível Máximo (**Nv. 4**)!`);
    }
    const discount = (profile.relicRuby || 0) >= 4 ? 0.75 : 1;
    const finalCost = Math.round(target.cost * (currentLevel + 1) * discount);

    if ((profile.aetherBalance || 0) < finalCost) {
      return message.reply(
        `❌ Éter insuficiente! Você precisa de **${finalCost} Éter 💠**, mas possui **${profile.aetherBalance} Éter**.\n💡 Dica: Use \`$daily\` para ganhar Éter agora mesmo!`
      );
    }

    const newBalance = (profile.aetherBalance || 0) - finalCost;
    db.update(guildProfiles)
      .set({
        aetherBalance: newBalance,
        [target.col]: currentLevel + 1,
      })
      .where(eq(guildProfiles.id, profile.id))
      .run();

    return message.reply(
      `🏺 **Relíquia Evoluída!** Sua **${target.name}** subiu para o **Nível ${currentLevel + 1}/4**!\n` +
        `✨ Efeito: *${target.desc}*\n` +
        `💠 Saldo Restante: **${newBalance} Éter**`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle(`🏺 Altar de Relíquias de ${message.author.username}`)
    .setColor("#FACC15")
    .setDescription(
      `💰 **Seu Saldo:** **${profile.aetherBalance} Éter 💠**\n` +
        `Para evoluir uma Relíquia, digite \`$k <nome>\` (ex: \`$k bronze\`, \`$k emerald\`).\n\n` +
        Object.entries(relicMap)
          .map(([key, r]) => {
            const lvl = Number(profile[r.col] || 0);
            const bars = "🟩".repeat(lvl) + "⬛".repeat(4 - lvl);
            return `${r.name} [\`${bars}\` Nv.${lvl}/4] — **\`$k ${key}\`**\n↳ *${r.desc}*`;
          })
          .join("\n\n")
    );

  return message.reply({ embeds: [embed] });
}

/**
 * 6. $wish / $wl — Lista de Desejos e Starwish ($sw)
 */
export async function handleWishCommand(message: Message, commandName: string, args: string[]) {
  const guildId = message.guildId!;
  const userId = message.author.id;
  const query = args.join(" ").trim();

  // Se for $wl ou $wish sem argumentos, mostra a lista de desejos
  if (commandName === "wl" || commandName === "wishlist" || !query) {
    const userWishes = await db
      .select({ wish: wishes, entity: entities })
      .from(wishes)
      .innerJoin(entities, eq(wishes.entityId, entities.id))
      .where(and(eq(wishes.guildId, guildId), eq(wishes.userId, userId)));

    if (userWishes.length === 0) {
      return message.reply("🌠 Sua Lista de Desejos está vazia! Adicione um personagem com `$wish <nome>` (ex: `$wish Zero Two`).");
    }

    const list = userWishes
      .map((w, i) => `${i + 1}. ${w.wish.isStarwish ? "🌟" : "⭐"} **${w.entity.name}** — *${w.entity.franchise}* (💠 ${w.entity.baseAether})`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`🌠 Lista de Desejos de ${message.author.username} (${userWishes.length}/10)`)
      .setDescription(list)
      .setColor("#00FFA3")
      .setFooter({ text: "Use $sw <nome> para definir seu Desejo Estelar (Starwish)!" });

    return message.reply({ embeds: [embed] });
  }

  const allEntities = await db.select().from(entities);
  const found = allEntities.find((e) => e.name.toLowerCase().includes(query.toLowerCase()));
  if (!found) {
    return message.reply(`❌ Personagem **"${query}"** não encontrado. Use \`$import ${query}\` para trazê-lo do AniList!`);
  }

  const isStar = commandName === "sw" || commandName === "starwish";

  const existing = await db.query.wishes.findFirst({
    where: and(eq(wishes.guildId, guildId), eq(wishes.userId, userId), eq(wishes.entityId, found.id)),
  });

  if (existing) {
    db.delete(wishes).where(eq(wishes.id, existing.id)).run();
    return message.reply(`🗑️ **${found.name}** foi removido da sua Lista de Desejos.`);
  }

  db.insert(wishes)
    .values({
      id: crypto.randomUUID(),
      guildId,
      userId,
      entityId: found.id,
      isStarwish: isStar,
    })
    .run();

  return message.reply(
    `${isStar ? "🌟 **Desejo Estelar Definido!**" : "⭐ **Adicionado à Lista de Desejos!**"} Você receberá um alerta especial quando **${found.name}** (*${found.franchise}*) aparecer nas rolagens!`
  );
}

/**
 * 7. $top / $topserv — Ranking Global de Personagens e Ranking do Servidor
 */
export async function handleTopCommand(message: Message, commandName: string) {
  const guildId = message.guildId!;

  if (commandName === "topserv" || commandName === "ts") {
    const profiles = await db
      .select()
      .from(guildProfiles)
      .where(eq(guildProfiles.guildId, guildId));

    const sorted = profiles.sort((a, b) => (b.aetherBalance || 0) - (a.aetherBalance || 0)).slice(0, 10);
    const desc =
      sorted
        .map((p, idx) => `**#${idx + 1}** <@${p.userId}> — **${p.aetherBalance} Éter 💠**`)
        .join("\n") || "Nenhum jogador registrado ainda.";

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Ranking Dimensional do Servidor`)
      .setDescription(desc)
      .setColor("#FACC15");

    return message.reply({ embeds: [embed] });
  }

  const allEntities = await db.select().from(entities);
  const top15 = allEntities.sort((a, b) => a.popularityRank - b.popularityRank).slice(0, 15);

  const desc = top15
    .map((e) => `**#${e.popularityRank}** **${e.name}** (*${e.franchise}*) — 💠 **${e.baseAether} Éter**`)
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🌌 Top 15 Entidades Mais Valiosas (Catálogo Kogu)")
    .setDescription(desc)
    .setColor("#5865F2")
    .setFooter({ text: "Use $im <nome> para ver a carta completa de qualquer personagem!" });

  return message.reply({ embeds: [embed] });
}

/**
 * 8. $import <nome> — Importação restrita a Criador, Admins e VIPs (com cota diária de 2 imports)
 */
export async function handleImportCommand(message: Message, args: string[]) {
  const searchName = args.join(" ").trim();
  if (!searchName) {
    return message.reply("✨ Digite o nome do personagem para importar! Exemplo: `$import Killua Zoldyck`");
  }

  const userId = message.author.id;
  const isAdminOrCreator = message.member?.permissions.has("Administrator");

  // Verifica dados do usuário
  let userRecord = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!userRecord) {
    db.insert(users)
      .values({ id: userId, username: message.author.username })
      .onConflictDoNothing()
      .run();
    userRecord = await db.query.users.findFirst({ where: eq(users.id, userId) });
  }

  const isVip = Boolean(userRecord?.isVip || (userRecord?.vipTier && userRecord.vipTier > 0));

  // Validação das 3 Opções Combinadas:
  // Se NÃO for Admin/Criador E NÃO for VIP: deve usar $suggest
  if (!isAdminOrCreator && !isVip) {
    return message.reply(
      `🔒 **Acesso Restrito:** A importação direta (\`$import\`) é exclusiva para a **Equipe / Criador** e membros **VIP / Booster**.\n` +
        `💡 Usuários podem enviar para aprovação usando: \`$suggest ${searchName}\`!`
    );
  }

  // Se for VIP (mas não Admin), aplica limite de 2 importações por dia
  if (!isAdminOrCreator && isVip) {
    const today = new Date().toISOString().slice(0, 10);
    const lastReset = (userRecord?.lastImportReset || "").slice(0, 10);
    let count = userRecord?.dailyImportsCount || 0;

    if (lastReset !== today) {
      count = 0;
      await db
        .update(users)
        .set({ dailyImportsCount: 0, lastImportReset: new Date().toISOString() })
        .where(eq(users.id, userId));
    }

    if (count >= 2) {
      return message.reply(
        "⏳ **Limite Diário VIP Atingido (2/2)!** Membros VIP podem importar até 2 personagens por dia. Seu limite recarregará amanhã."
      );
    }

    await db
      .update(users)
      .set({ dailyImportsCount: count + 1 })
      .where(eq(users.id, userId));
  }

  try {
    const query = `
      query ($search: String) {
        Character(search: $search) {
          id
          name { full native }
          image { large }
          favourites
          description
          gender
          media(sort: POPULARITY_DESC, perPage: 1) {
            nodes {
              title { romaji english }
              type
            }
          }
        }
      }
    `;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { search: searchName } }),
    });

    if (!res.ok) {
      return message.reply("❌ Erro ao consultar a API do AniList. Tente novamente em instantes.");
    }

    const json: any = await res.json();
    const char = json?.data?.Character;
    if (!char) {
      return message.reply(`❌ Nenhum personagem encontrado no AniList para **"${searchName}"**.`);
    }

    const fullName = char.name.full;
    const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const mediaTitle = char.media?.nodes?.[0]?.title?.english || char.media?.nodes?.[0]?.title?.romaji || "Universo Dimensional";
    const imageUrl = char.image?.large;
    const favs = Number(char.favourites || 100);
    const calculatedAether = Math.min(1300, Math.max(150, Math.round(180 + Math.sqrt(favs) * 4.2)));
    const gender = char.gender === "Female" ? "FEMALE" : char.gender === "Male" ? "MALE" : "BOTH";

    const allCount = (await db.select().from(entities)).length;

    const existing = await db.query.entities.findFirst({ where: eq(entities.slug, slug) });
    if (existing) {
      return handleInfoCommand(message, [fullName]);
    }

    db.insert(entities)
      .values({
        id: crypto.randomUUID(),
        slug,
        name: fullName,
        originalName: char.name?.native || null,
        universe: "ANIME",
        type: "CHARACTER",
        gender,
        franchise: mediaTitle,
        description: (char.description || "").replace(/<[^>]*>?/gm, "").slice(0, 240),
        imagesJson: JSON.stringify(imageUrl ? [imageUrl] : []),
        baseAether: calculatedAether,
        popularityRank: allCount + 1,
        baseAtk: Math.min(99, 70 + Math.round(calculatedAether / 40)),
        baseDef: Math.min(99, 68 + Math.round(calculatedAether / 42)),
        baseSpd: Math.min(99, 72 + Math.round(calculatedAether / 38)),
        baseHp: 95,
      } as any)
      .run();

    await message.reply(`✨ **${fullName}** (*${mediaTitle}*) foi importado com sucesso para o Panteão Dimensional com valor **💠 ${calculatedAether} Éter**!`);
    return handleInfoCommand(message, [fullName]);
  } catch (err) {
    console.error("Erro no $import:", err);
    return message.reply("❌ Ocorreu um erro ao importar o personagem.");
  }
}

/**
 * 9. $suggest <nome> — Fila de Sugestões de Personagens para Membros Comuns (Opção C)
 */
export async function handleSuggestCommand(message: Message, args: string[]) {
  const queryName = args.join(" ").trim();
  if (!queryName) {
    return message.reply("💡 Digite o nome do personagem que deseja sugerir. Exemplo: `$suggest Eren Yeager`");
  }

  const guildId = message.guildId!;
  const userId = message.author.id;

  const id = crypto.randomUUID();
  await db.insert(characterSuggestions).values({
    id,
    guildId,
    userId,
    characterName: queryName,
    status: "PENDING",
  });

  return message.reply(
    `📩 **Sugestão Enviada!** O personagem **"${queryName}"** foi adicionado à Fila de Moderação.\n` +
      `Assim que o Criador ou a Staff aprovar com \`$approvesuggest\`, ele entrará oficialmente no catálogo!`
  );
}

/**
 * 10. $approvesuggest e $suggestlist — Gestão da Fila de Moderação (Criador/Staff)
 */
export async function handleSuggestionAdminCommands(message: Message, commandName: string, args: string[]) {
  if (!message.member?.permissions.has("Administrator")) {
    return message.reply("🛡️ Apenas administradores e o criador podem moderar sugestões de catálogo.");
  }

  if (commandName === "suggestlist" || commandName === "sugestoes") {
    const pending = await db
      .select()
      .from(characterSuggestions)
      .where(eq(characterSuggestions.status, "PENDING"));

    if (pending.length === 0) {
      return message.reply("📋 Não há nenhuma sugestão pendente no momento.");
    }

    const list = pending
      .slice(0, 15)
      .map((s, i) => `**#${i + 1}** \`${s.characterName}\` sugerido por <@${s.userId}>`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`📋 Fila de Moderação de Personagens (${pending.length} Pendentes)`)
      .setDescription(list)
      .setColor("#5865F2")
      .setFooter({ text: "Use $approvesuggest <nome> para aprovar e importar diretamente!" });

    return message.reply({ embeds: [embed] });
  }

  if (commandName === "approvesuggest" || commandName === "aprovar") {
    const targetName = args.join(" ").trim();
    if (!targetName) {
      return message.reply("⚠️ Informe o nome da sugestão que deseja aprovar. Exemplo: `$approvesuggest Eren Yeager`");
    }

    const match = await db
      .select()
      .from(characterSuggestions)
      .where(eq(characterSuggestions.status, "PENDING"));

    const found = match.find((m) => m.characterName.toLowerCase().includes(targetName.toLowerCase()));
    if (found) {
      await db
        .update(characterSuggestions)
        .set({ status: "APPROVED" })
        .where(eq(characterSuggestions.id, found.id));
    }

    // Executa a importação oficial
    await message.reply(`✅ Sugestão de **"${targetName}"** aprovada! Importando para o catálogo global...`);
    return handleImportCommand(message, [targetName]);
  }
}

