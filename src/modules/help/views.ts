/** Views do modulo HELP: embeds da central de ajuda e secoes do painel (select de categorias). */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
} from "discord.js";
import type { Locale } from "../../config/constants.js";
import { emoji } from "../../ui/emojis.js";
import { baseEmbed } from "../../ui/embeds.js";
import { truncate } from "../../ui/format.js";
import type { PanelSection } from "../../ui/components/panel.js";
import type { AnyRow } from "../../ui/components/paginator.js";
import { msg } from "./messages.js";
import type { HelpEntry, HelpGroup } from "./service.js";

export const OVERVIEW_SECTION_ID = "overview";
const EMBED_DESCRIPTION_SOFT_LIMIT = 3800;
const MAX_EMBEDS_PER_CATEGORY = 3;
const FOOTER_MAX = 2048;
const SELECT_DESCRIPTION_MAX = 100;

export const KOGU_AVATAR_URL =
  "https://yo-apollon.github.io/kogu/assets/kogu_avatar_animated.gif";
export const KOGU_PORTAL_URL = "https://yo-apollon.github.io/kogu/";
export const KOGU_TERMS_URL = "https://yo-apollon.github.io/kogu/terms.html";
export const KOGU_PRIVACY_URL = "https://yo-apollon.github.io/kogu/privacy.html";
export const KOGU_INVITE_URL =
  "https://discord.com/oauth2/authorize?client_id=1561074418250416178&permissions=412317240384&scope=bot%20applications.commands";

/** Rodape limpo e elegante de todas as telas. Zero informacoes de APIs ou avisos legais desnecessarios. */
export function helpFooter(locale: Locale, prefix: string): string {
  return truncate(msg(locale, "help.footer", { prefix }), FOOTER_MAX);
}

export function commandLine(entry: HelpEntry, locale: Locale): string {
  const base = entry.description
    ? msg(locale, "help.command_line", { usage: entry.usage, description: entry.description })
    : `\`${entry.usage}\``;
  return entry.ownerOnly ? `${base} ${emoji("lock")}` : base;
}

/** Cria botoes de acao rapida para o catalogo web, termos e convite do bot. */
export function helpButtonsRow(locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const isPt = locale === "pt-BR";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(isPt ? "Catálogo Web" : "Web Catalog")
      .setStyle(ButtonStyle.Link)
      .setURL(KOGU_PORTAL_URL)
      .setEmoji("🌐"),
    new ButtonBuilder()
      .setLabel(isPt ? "Tutorial" : "Tutorial")
      .setStyle(ButtonStyle.Link)
      .setURL("https://yo-apollon.github.io/kogu/#tutorial")
      .setEmoji("📖"),
    new ButtonBuilder()
      .setLabel(isPt ? "Termos & Privacidade" : "Terms & Privacy")
      .setStyle(ButtonStyle.Link)
      .setURL(KOGU_TERMS_URL)
      .setEmoji("📜"),
    new ButtonBuilder()
      .setLabel(isPt ? "Convidar Bot" : "Invite Bot")
      .setStyle(ButtonStyle.Link)
      .setURL(KOGU_INVITE_URL)
      .setEmoji("➕")
  );
}

/** Junta linhas em blocos que cabem na descricao de um embed. */
export function chunkLines(lines: readonly string[], limit = EMBED_DESCRIPTION_SOFT_LIMIT): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current === "" ? line : `${current}\n${line}`;
    if (next.length > limit && current !== "") {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

export function overviewEmbed(groups: readonly HelpGroup[], locale: Locale, prefix: string): EmbedBuilder {
  const isPt = locale === "pt-BR";
  const intro = isPt
    ? `### 🌌 Bem-vindo ao Multiverso Kogu!\n` +
      `Explore mais de **7.000 cartas ativas**, colecione heróis, vilões e lendas de **Animes, Games, Séries, Filmes, Esportes e Música**, dispute o ranking global do Panteão e vença as 12 Amarras da **Torre de Éter**!\n\n` +
      `> 💡 **Guia Rápido:** ${msg(locale, "help.overview")}\n` +
      `> Navegue pelo menu interativo abaixo ou acesse os links oficiais:`
    : `### 🌌 Welcome to the Kogu Multiverse!\n` +
      `Explore over **7,000 active cards**, collect heroes, villains and legends across **Anime, Gaming, Cinema, Sports and Music**, climb the Pantheon global rankings, and conquer the 12 floors of the **Aether Tower**!\n\n` +
      `> 💡 **Quick Guide:** ${msg(locale, "help.overview")}\n` +
      `> Browse categories via the interactive menu below or click official links:`;

  const embed = baseEmbed({
    title: msg(locale, "help.title"),
    description: intro,
    color: 0x7c3aed,
    thumbnail: KOGU_AVATAR_URL,
    footer: helpFooter(locale, prefix),
  });

  for (const g of groups) {
    const highlights = g.entries
      .slice(0, 4)
      .map((e) => `\`${prefix}${e.name}\``)
      .join(" • ");
    const countLabel = msg(locale, "help.commands_count", { count: g.entries.length });
    embed.addFields({
      name: `${g.title} (${countLabel})`,
      value: highlights.length > 0 ? `${highlights}\n*(Selecione no menu para ver todos)*` : `*${countLabel}*`,
      inline: true,
    });
  }

  return embed;
}

export function categoryEmbeds(group: HelpGroup, locale: Locale, prefix: string): EmbedBuilder[] {
  if (group.entries.length === 0) {
    return [
      baseEmbed({
        title: group.title,
        description: msg(locale, "help.no_commands"),
        color: 0x7c3aed,
        thumbnail: KOGU_AVATAR_URL,
        footer: helpFooter(locale, prefix),
      }),
    ];
  }
  const lines = group.entries.map((e) => {
    const lock = e.ownerOnly ? ` ${emoji("lock")} *(Staff)*` : "";
    const slash = e.slash ? " `[/]`" : "";
    const desc = e.description ? `\n> ${e.description}` : "";
    return `### 🔹 \`${e.usage}\`${slash}${lock}${desc}`;
  });
  const chunks = chunkLines(lines).slice(0, MAX_EMBEDS_PER_CATEGORY);
  return chunks.map((chunk, i) =>
    baseEmbed({
      title: i === 0 ? group.title : undefined,
      description: chunk,
      color: 0x7c3aed,
      thumbnail: KOGU_AVATAR_URL,
      footer: helpFooter(locale, prefix),
    })
  );
}

/** Secao "Visao geral" + uma por categoria, prontas para `createPanel`. */
export function buildHelpSections(
  groups: readonly HelpGroup[],
  locale: Locale,
  prefix: string
): PanelSection[] {
  const buttons = helpButtonsRow(locale) as AnyRow;
  return [
    {
      id: OVERVIEW_SECTION_ID,
      label: msg(locale, "help.overview_label"),
      emoji: "🌌",
      render: () => ({
        embeds: [overviewEmbed(groups, locale, prefix)],
        components: [buttons],
      }),
    },
    ...groups.map(
      (group): PanelSection => ({
        id: group.category,
        label: group.title,
        description: truncate(
          group.entries
            .slice(0, 6)
            .map((e) => `${prefix}${e.name}`)
            .join(" "),
          SELECT_DESCRIPTION_MAX
        ),
        render: () => ({
          embeds: categoryEmbeds(group, locale, prefix),
          components: [buttons],
        }),
      })
    ),
  ];
}
