/** Views do modulo HELP: embeds da central de ajuda e secoes do painel (select de categorias). */
import type { EmbedBuilder } from "discord.js";
import type { Locale } from "../../config/constants.js";
import { emoji } from "../../ui/emojis.js";
import { baseEmbed } from "../../ui/embeds.js";
import { truncate } from "../../ui/format.js";
import type { PanelSection } from "../../ui/components/panel.js";
import { msg, tmdbAttribution } from "./messages.js";
import type { HelpEntry, HelpGroup } from "./service.js";

export const OVERVIEW_SECTION_ID = "overview";
const EMBED_DESCRIPTION_SOFT_LIMIT = 3800;
const MAX_EMBEDS_PER_CATEGORY = 3;
const FOOTER_MAX = 2048;
const SELECT_DESCRIPTION_MAX = 100;

/** Rodape de todas as telas: marca, prefixo e atribuicoes das fontes (TMDB exige a sua). */
export function helpFooter(locale: Locale, prefix: string): string {
  return truncate(
    [
      msg(locale, "help.footer", { prefix }),
      msg(locale, "help.credits"),
      tmdbAttribution(locale),
    ].join(" • "),
    FOOTER_MAX
  );
}

export function commandLine(entry: HelpEntry, locale: Locale): string {
  const base = entry.description
    ? msg(locale, "help.command_line", { usage: entry.usage, description: entry.description })
    : `\`${entry.usage}\``;
  return entry.ownerOnly ? `${base} ${emoji("lock")}` : base;
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
  const categories = groups.map(
    (g) => `**${g.title}** — ${msg(locale, "help.commands_count", { count: g.entries.length })}`
  );
  return baseEmbed({
    title: msg(locale, "help.title"),
    description: [msg(locale, "help.overview"), "", ...categories].join("\n"),
    footer: helpFooter(locale, prefix),
  });
}

export function categoryEmbeds(group: HelpGroup, locale: Locale, prefix: string): EmbedBuilder[] {
  if (group.entries.length === 0) {
    return [
      baseEmbed({
        title: group.title,
        description: msg(locale, "help.no_commands"),
        footer: helpFooter(locale, prefix),
      }),
    ];
  }
  const lines = group.entries.map((e) => commandLine(e, locale));
  const chunks = chunkLines(lines).slice(0, MAX_EMBEDS_PER_CATEGORY);
  return chunks.map((chunk, i) =>
    baseEmbed({
      title: i === 0 ? group.title : undefined,
      description: chunk,
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
  return [
    {
      id: OVERVIEW_SECTION_ID,
      label: msg(locale, "help.overview_label"),
      emoji: "🌌",
      render: () => ({ embeds: [overviewEmbed(groups, locale, prefix)] }),
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
        render: () => ({ embeds: categoryEmbeds(group, locale, prefix) }),
      })
    ),
  ];
}
