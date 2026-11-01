/**
 * Comando `help` (prefixo + slash): central de ajuda gerada do registry, uma secao por categoria
 * num painel com select (`src/ui/components/panel.ts`).
 *
 *   help -> ajuda, comandos (+ /help)
 *
 * O texto de cada comando vem do `descriptionKey` (help.commands.*) e o titulo da categoria de
 * help.category.*; o rodape traz o prefixo e a atribuicao do TMDB/AniList/IGDB.
 */
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { AnyCommand } from "../../core/contracts.js";
import { listCommands } from "../../core/registry.js";
import { t } from "../../i18n/index.js";
import { getKV } from "../../infra/redis/client.js";
import type { KV } from "../../infra/redis/kv.js";
import { createPanel } from "../../ui/components/panel.js";
import { truncate } from "../../ui/format.js";
import { msg } from "./messages.js";
import { buildHelpGroups } from "./service.js";
import { buildHelpSections, OVERVIEW_SECTION_ID } from "./views.js";

const SLASH_DESCRIPTION_MAX = 100;

export interface HelpDeps {
  /** Lista de comandos no momento da chamada (o registry so esta completo em runtime). */
  getCommands: () => readonly AnyCommand[];
  getKV: () => Promise<KV>;
}

export function createHelpCommand(
  deps: HelpDeps = { getCommands: listCommands, getKV }
): AnyCommand {
  return {
    name: "help",
    aliases: ["ajuda", "comandos"],
    category: "help",
    descriptionKey: "help.commands.help",
    cooldownMs: 3_000,
    slash: () =>
      new SlashCommandBuilder()
        .setName("help")
        .setDescription(truncate(t("help.commands.help", "pt-BR"), SLASH_DESCRIPTION_MAX))
        .setDescriptionLocalizations({
          "en-US": truncate(t("help.commands.help", "en-US"), SLASH_DESCRIPTION_MAX),
        })
        .setContexts(InteractionContextType.Guild),
    async execute(ctx) {
      const prefix = ctx.guildConfig.prefix;
      const groups = buildHelpGroups(deps.getCommands(), ctx.locale, prefix);
      const arg = (ctx.rawArgs?.[0] ?? "").toLowerCase().trim();
      let initialSection = OVERVIEW_SECTION_ID;
      if (arg) {
        const found = groups.find(
          (g) =>
            g.category.toLowerCase() === arg ||
            g.title.toLowerCase().includes(arg) ||
            g.entries.some(
              (e) =>
                e.name.toLowerCase() === arg ||
                e.aliases.some((a) => a.toLowerCase() === arg)
            )
        );
        if (found) {
          initialSection = found.category;
        }
      }
      const panel = await createPanel({
        kv: await deps.getKV(),
        ownerId: ctx.user.id,
        sections: buildHelpSections(groups, ctx.locale, prefix),
        initial: initialSection,
        locale: ctx.locale,
        placeholder: msg(ctx.locale, "help.placeholder"),
      });
      const message = await ctx.reply(panel.payload);
      panel.attach(message);
    },
  };
}

export const helpCommand: AnyCommand = createHelpCommand();

export const helpCommands: AnyCommand[] = [helpCommand];
