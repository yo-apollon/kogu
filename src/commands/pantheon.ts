import {
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import { parseFlags } from "../engine/flagsParser.js";
import { db } from "../database/index.js";
import { pacts, entities, users, guildProfiles } from "../database/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { t } from "../i18n/index.js";

export async function handlePantheonCommand(
  message: Message,
  commandName: string,
  args: string[],
  guildData: any
) {
  const guildId = message.guildId!;
  const targetUser = message.mentions.users.first() || message.author;
  const lang = guildData?.language || "pt-BR";

  // Processa as flags enviadas com o comando (ex: $ptwk=, $mmy, $pt)
  const fullInput = [commandName.replace(/^(pt|pantheon|p|mm)/, ""), ...args].join(" ");
  const flags = parseFlags(fullInput);

  // Busca todos os pactos do jogador no servidor
  const userPacts = await db
    .select({
      pact: pacts,
      entity: entities,
    })
    .from(pacts)
    .innerJoin(entities, eq(pacts.entityId, entities.id))
    .where(and(eq(pacts.guildId, guildId), eq(pacts.userId, targetUser.id)));

  if (userPacts.length === 0) {
    return message.reply(t("pantheon.empty", lang));
  }

  // Aplicação das Flags de Filtro e Ordenação
  let filteredPacts = [...userPacts];

  if (flags.gender) {
    filteredPacts = filteredPacts.filter((p) => p.entity.gender === flags.gender);
  }

  if (flags.keysOnly) {
    filteredPacts = filteredPacts.filter((p) => p.pact.awakeningKeys > 0);
  }

  if (flags.soulmatesOnly) {
    filteredPacts = filteredPacts.filter((p) => p.pact.awakeningKeys >= 10);
  }

  if (flags.sortByAether) {
    filteredPacts.sort((a, b) => b.entity.baseAether - a.entity.baseAether);
  } else if (flags.sortByKeys) {
    filteredPacts.sort((a, b) => b.pact.awakeningKeys - a.pact.awakeningKeys);
  } else if (flags.alphabeticalSort) {
    filteredPacts.sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  }

  // Paginação: 10 entidades por página
  const pageSize = 10;
  const totalPages = Math.ceil(filteredPacts.length / pageSize);
  let currentPage = 1;

  const renderPageEmbed = (page: number) => {
    const start = (page - 1) * pageSize;
    const pageItems = filteredPacts.slice(start, start + pageSize);

    const description = pageItems
      .map((item, index) => {
        const num = start + index + 1;
        const keysText = item.pact.awakeningKeys > 0 ? `★${item.pact.awakeningKeys}` : "";
        const variantIcon =
          item.pact.variant === "ASTRAL"
            ? "🔮"
            : item.pact.variant === "HOLO"
            ? "🌟"
            : item.pact.variant === "FOIL"
            ? "✨"
            : "📜";

        return `**${num}.** ${variantIcon} **${item.entity.name}** \`${keysText}\` — \`${item.entity.franchise}\` (💠 ${item.entity.baseAether})`;
      })
      .join("\n");

    return new EmbedBuilder()
      .setTitle(`🏛️ Panteão de ${targetUser.username} (${filteredPacts.length} Entidades)`)
      .setDescription(description || "Nenhuma entidade encontrada com estes filtros.")
      .setColor("#5865F2")
      .setFooter({ text: `Página ${page}/${totalPages} • Use $sp para reordenar` });
  };

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("prev").setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("Próxima ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1)
  );

  const reply = await message.reply({
    embeds: [renderPageEmbed(currentPage)],
    components: totalPages > 1 ? [buttons] : [],
  });

  if (totalPages <= 1) return;

  const collector = reply.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120_000,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      return interaction.reply({ content: "❌ Apenas quem usou o comando pode navegar.", ephemeral: true });
    }

    if (interaction.customId === "prev") {
      currentPage = Math.max(1, currentPage - 1);
    } else if (interaction.customId === "next") {
      currentPage = Math.min(totalPages, currentPage + 1);
    }

    const updatedButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("prev")
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1),
      new ButtonBuilder()
        .setCustomId("next")
        .setLabel("Próxima ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages)
    );

    await interaction.update({
      embeds: [renderPageEmbed(currentPage)],
      components: [updatedButtons],
    });
  });
}
