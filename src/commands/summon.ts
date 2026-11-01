import {
  Message,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import { rollEntity, rollCardVariant, calculateAetherValue } from "../engine/summonEngine.js";
import { renderCharacterCard } from "../canvas/cardRenderer.js";
import { db } from "../database/index.js";
import { pacts, guildProfiles, users, entities, disabledSeries } from "../database/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "../redis/index.js";
import { t } from "../i18n/index.js";

export async function handleSummonCommand(
  message: Message,
  commandName: string,
  _args: string[],
  guildData: any
) {
  const guildId = message.guildId!;
  const lang = guildData?.language || "pt-BR";

  // 1. Determina filtros com base no atalho de invocação
  let genderFilter: "FEMALE" | "MALE" | "BOTH" | undefined;
  let universeFilter: string | undefined;
  let typeFilter: "CHARACTER" | "WEAPON" | "COMPANION" | "DOMAIN" | undefined;

  if (commandName.startsWith("w")) {
    genderFilter = "FEMALE";
    if (commandName === "wa") universeFilter = "ANIME";
    else if (commandName === "wg") universeFilter = "GAME";
    else if (commandName === "wc") universeFilter = "CINEMA";
    else if (commandName === "wm") universeFilter = "MYTHOLOGY";
  } else if (commandName.startsWith("h")) {
    genderFilter = "MALE";
    if (commandName === "ha") universeFilter = "ANIME";
    else if (commandName === "hg") universeFilter = "GAME";
    else if (commandName === "hc") universeFilter = "CINEMA";
    else if (commandName === "hm") universeFilter = "MYTHOLOGY";
  } else if (commandName === "ar") {
    typeFilter = "WEAPON";
  } else if (commandName === "ma" || commandName === "sa") {
    universeFilter = "ANIME";
  } else if (commandName === "mg" || commandName === "sg") {
    universeFilter = "GAME";
  } else if (commandName === "mc" || commandName === "sc") {
    universeFilter = "CINEMA";
  }

  // 1. Controle de Limite de Invocações da Hora ($rolls / $tu)
  const userId = message.author.id;
  let userProfile = await db.query.guildProfiles.findFirst({
    where: and(eq(guildProfiles.guildId, guildId), eq(guildProfiles.userId, userId)),
  });

  const baseRolls = guildData?.baseRolls || 10;

  if (!userProfile) {
    const id = `${guildId}:${userId}`;
    db.insert(users)
      .values({ id: userId, username: message.author.username })
      .onConflictDoNothing()
      .run();
    db.insert(guildProfiles)
      .values({
        id,
        guildId,
        userId,
        rollsRemaining: baseRolls,
        pactsAvailable: 1,
        aetherBalance: 300,
      })
      .run();
    userProfile = await db.query.guildProfiles.findFirst({
      where: and(eq(guildProfiles.guildId, guildId), eq(guildProfiles.userId, userId)),
    });
  }

  // Verifica se o usuário tem rolls restantes (mesmo para o dono/criador)
  if (userProfile && userProfile.rollsRemaining <= 0) {
    if (userProfile.stackedRolls > 0) {
      // Consome 1 roll empilhado do $daily
      db.update(guildProfiles)
        .set({ stackedRolls: userProfile.stackedRolls - 1 })
        .where(eq(guildProfiles.id, userProfile.id))
        .run();
    } else {
      return message.reply(
        `⏳ **Suas invocações da hora se esgotaram (0/${baseRolls})!**\nUse \`$tu\` para ver quanto tempo falta para o reset da hora, ou \`$daily\` para coletar rolls empilhados extras!`
      );
    }
  } else if (userProfile) {
    db.update(guildProfiles)
      .set({ rollsRemaining: userProfile.rollsRemaining - 1 })
      .where(eq(guildProfiles.id, userProfile.id))
      .run();
  }

  // Busca séries desativadas pelo usuário no servidor ($disable)
  const userDisabled = await db
    .select()
    .from(disabledSeries)
    .where(and(eq(disabledSeries.guildId, guildId), eq(disabledSeries.userId, message.author.id)));
  const excludeSeries = userDisabled.map((d) => d.seriesName);


  // 2. Sorteia a Entidade (Tipada via Drizzle + Anti-Repetição por Servidor)
  const entity = await rollEntity({
    gender: genderFilter,
    universe: universeFilter,
    type: typeFilter,
    excludeSeries,
    guildId,
  });

  if (!entity) {
    return message.reply("❌ Nenhuma entidade encontrada no catálogo dimensional.");
  }

  // 3. Verifica se a entidade já possui Pacto firmado neste servidor
  const existingPact = await db.query.pacts.findFirst({
    where: and(eq(pacts.guildId, guildId), eq(pacts.entityId, entity.id)),
  });

  let ownerName: string | undefined;
  let newKeysAwarded = 0;

  if (existingPact) {
    const ownerUser = await db.query.users.findFirst({
      where: eq(users.id, existingPact.userId),
    });
    ownerName = ownerUser?.username || "Invocador";

    // Se quem invocou é o próprio dono do Pacto, ganha +1 Selo de Despertar (Key)!
    if (existingPact.userId === message.author.id) {
      newKeysAwarded = 1;
      const updatedKeys = (existingPact.awakeningKeys || 0) + 1;
      db.update(pacts)
        .set({
          awakeningKeys: updatedKeys,
          isSoulmate: updatedKeys >= 10,
        })
        .where(eq(pacts.id, existingPact.id))
        .run();
      existingPact.awakeningKeys = updatedKeys;
    }
  }

  // 4. Determina a variante visual e calcula o Éter com precisão
  const variant = existingPact ? (existingPact.variant as any) : rollCardVariant();
  const awakeningKeys = existingPact ? existingPact.awakeningKeys : 0;
  const aetherValue = calculateAetherValue(entity.baseAether, variant, awakeningKeys);

  // 5. Extrai a URL da imagem oficial
  let firstImage: string | undefined;
  try {
    const parsedImages = JSON.parse(entity.imagesJson || "[]");
    if (Array.isArray(parsedImages) && parsedImages.length > 0) {
      firstImage = parsedImages[0];
    }
  } catch {
    firstImage = undefined;
  }

  // 6. Renderiza o Card AAA em Canvas
  const cardBuffer = await renderCharacterCard({
    name: entity.name,
    franchise: entity.franchise,
    universe: entity.universe,
    imageUrl: firstImage,
    variant,
    awakeningKeys,
    aetherValue,
    popularityRank: entity.popularityRank,
    atk: entity.baseAtk,
    def: entity.baseDef,
    spd: entity.baseSpd,
    ownerName,
  });

  const attachment = new AttachmentBuilder(cardBuffer, { name: "kogu-card.png" });

  // Cores do Embed Lateral segundo a Raridade da Carta
  const embedColors: Record<string, number> = {
    STANDARD: 0x5865f2,
    FOIL: 0xcbd5e1,
    HOLO: 0xfacc15,
    ASTRAL: 0xd946ef,
  };

  const variantLabels: Record<string, string> = {
    STANDARD: "📜 Standard",
    FOIL: "✨ Foil Prateada (+25% Éter)",
    HOLO: "🌟 Holográfica Dourada (+75% Éter)",
    ASTRAL: "🔮 Astral Abissal (+300% Éter)",
  };

  const genderSymbol = entity.gender === "FEMALE" ? "♀" : entity.gender === "MALE" ? "♂" : "⚧";
  const claimRank = entity.popularityRank && entity.popularityRank < 99999 ? `#${entity.popularityRank}` : `#${entity.baseAether > 800 ? "70" : "150"}`;
  const likeRank = `#${Math.max(1, (entity.popularityRank || 100) + 44)}`;

  // Formato Clássico & Limpo idêntico ao Mudae
  // Linha 1: Franquia + Símbolo de gênero
  // Linha 2: Roleta de Universo • Éter 💠 • Selos de Despertar 🔑 (Keys)
  // Linha 3: Claim Rank
  // Linha 4: Like Rank
  // Linha 5: Dono do Pacto (se houver)
  const rouletteName =
    entity.universe === "ANIME"
      ? "Animanga roulette"
      : entity.universe === "GAME"
      ? "Game roulette"
      : entity.universe === "CINEMA"
      ? "Cinema roulette"
      : "Dimensional roulette";

  const keysDisplay = awakeningKeys > 0 ? ` • 🗝️ (${awakeningKeys})` : "";
  const variantDisplay = variant !== "STANDARD" ? ` [${variant}]` : "";

  let desc = `**${entity.franchise}** ${genderSymbol}\n`;
  desc += `*${rouletteName}* · **${aetherValue}** 💠${keysDisplay}${variantDisplay}\n`;
  desc += `Pact Rank: ${claimRank}\n`;
  desc += `Like Rank: ${likeRank}\n`;
  if (entity.baseAtk) {
    desc += `Combat: ATK ${entity.baseAtk} · DEF ${entity.baseDef} · SPD ${entity.baseSpd}\n`;
  }

  const embed = new EmbedBuilder()
    .setAuthor({
      name: entity.name,
      iconURL: message.author.displayAvatarURL(),
    })
    .setDescription(desc)
    .setImage("attachment://kogu-card.png")
    .setColor(existingPact ? 0x2b2d31 : 0xe03b54); // Tom característico vermelho/bordô estilo Mudae se livre

  if (existingPact) {
    embed.setFooter({
      text: `Belongs to ${ownerName} ~ ${awakeningKeys} / 50 [${entity.baseAether}]`,
      iconURL: message.guild?.iconURL() || undefined,
    });
  }

  // 7. Botões Interativos Nativos
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (!existingPact) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`pact:${entity.id}`)
        .setLabel("Firmar Pacto")
        .setEmoji("❤️")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`like:${entity.id}`)
        .setLabel("Favoritar")
        .setEmoji("⭐")
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    const orbReward = Math.max(25, Math.round(aetherValue * 0.2));
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`aether_orb:${entity.id}:${orbReward}`)
        .setLabel(`Absorver Éter (+${orbReward} 💠)`)
        .setEmoji("💠")
        .setStyle(ButtonStyle.Primary)
    );
  }

  const summonMsg = await message.reply({
    embeds: [embed],
    files: [attachment],
    components: [row],
  });

  // 8. Coletor de Interação Protegido por Lock Atômico
  const collector = summonMsg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: (guildData?.claimWindowSeconds || 45) * 1000,
  });

  collector.on("collect", async (interaction) => {
    const clickerId = interaction.user.id;
    const clickerName = interaction.user.username;

    if (interaction.customId.startsWith("like:")) {
      db.update(entities)
        .set({ likesCount: sql`${entities.likesCount} + 1` })
        .where(eq(entities.id, entity.id))
        .run();
      return interaction.reply({
        content: `❤️ Você adicionou **${entity.name}** aos seus favoritos!`,
        ephemeral: true,
      });
    }

    if (interaction.customId.startsWith("pact:")) {
      const lockKey = `lock:pact:${guildId}:${entity.id}`;
      const acquired = await (redis as any).atomicPactLock(lockKey, clickerId, 60);

      if (!acquired) {
        return interaction.reply({
          content: t("summon.pact_failed_taken", lang),
          ephemeral: true,
        });
      }

      // Garante usuário no banco
      try {
        db.insert(users)
          .values({ id: clickerId, username: clickerName })
          .onConflictDoUpdate({ target: users.id, set: { username: clickerName } })
          .run();
      } catch {}

      // Insere o Pacto no Panteão
      try {
        db.insert(pacts)
          .values({
            id: `${guildId}:${entity.id}`,
            guildId,
            userId: clickerId,
            entityId: entity.id,
            variant,
            awakeningKeys: 1,
          })
          .run();
      } catch {
        return interaction.reply({
          content: "⚡ Esta entidade já foi vinculada neste servidor!",
          ephemeral: true,
        });
      }

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("pact_done")
          .setLabel(`Pacto Firmado com ${clickerName}`)
          .setEmoji("✨")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      const claimedEmbed = EmbedBuilder.from(embed)
        .setColor(0x4ade80)
        .setDescription(
          `**${entity.franchise}** *(${entity.universe})*\n` +
            `💠 **${aetherValue} Éter**  •  ${variantLabels[variant] || variantLabels.STANDARD}\n` +
            `⚔️ \`ATK ${entity.baseAtk}\`  🛡️ \`DEF ${entity.baseDef}\`  ⚡ \`SPD ${entity.baseSpd}\`\n\n` +
            `✨ **Pacto Sagrado firmado por ${clickerName}!**`
        );

      await interaction.update({ embeds: [claimedEmbed], components: [disabledRow] });
      if ("send" in message.channel) {
        await message.channel.send(
          `📜 ✨ **${clickerName}** firmou um Pacto Dimensional com **${entity.name}** (\`${variant}\` • 💠 **${aetherValue} Éter**)!`
        );
      }
      collector.stop("claimed");
    } else if (interaction.customId.startsWith("aether_orb:")) {
      const orbKey = `lock:orb:${guildId}:${summonMsg.id}`;
      const acquired = await (redis as any).atomicOrbClaim(orbKey, clickerId, 60);

      if (!acquired) {
        return interaction.reply({
          content: "⚡ Este Orbe de Éter já foi absorvido!",
          ephemeral: true,
        });
      }

      const parts = interaction.customId.split(":");
      const orbAmount = Number(parts[2]) || 50;

      // Atualiza ou cria saldo de Éter do jogador no servidor
      const profileId = `${guildId}:${clickerId}`;
      const existingProfile = await db.query.guildProfiles.findFirst({
        where: eq(guildProfiles.id, profileId),
      });

      if (existingProfile) {
        db.update(guildProfiles)
          .set({ aetherBalance: existingProfile.aetherBalance + orbAmount })
          .where(eq(guildProfiles.id, profileId))
          .run();
      } else {
        try {
          db.insert(users)
            .values({ id: clickerId, username: clickerName })
            .onConflictDoNothing()
            .run();
          db.insert(guildProfiles)
            .values({
              id: profileId,
              userId: clickerId,
              guildId,
              aetherBalance: orbAmount,
            })
            .run();
        } catch {}
      }

      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("orb_done")
          .setLabel(`+${orbAmount} Éter Absorvido por ${clickerName}`)
          .setEmoji("💠")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await interaction.update({ components: [disabledRow] });
      if ("send" in message.channel) {
        await message.channel.send(
          `💠 **${clickerName}** absorveu **+${orbAmount} Éter** da fenda de **${entity.name}**!`
        );
      }
      collector.stop("orb_claimed");
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "time") {
      const expiredRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("expired")
          .setLabel("Fenda Dimensional Dissipada")
          .setEmoji("🌫️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      await summonMsg.edit({ components: [expiredRow] }).catch(() => null);
    }
  });
}
