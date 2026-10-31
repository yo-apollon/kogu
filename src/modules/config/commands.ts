/**
 * Comandos de configuracao do servidor.
 *
 *  - `$settings` / `$serversettings` / `$config` e `/settings`: painel com select menu de secoes.
 *  - `$setrolls`, `$settimer`, `$setclaim`, `$gamemode`, `$prefix` (`$prefixo`), `$lang` (`$idioma`) e
 *    `/set rolls|timer|claim|gamemode|prefix|lang` (tambem `$set <config> <valor>`): exigem Gerenciar
 *    Servidor (`permissions`, conferido pelo middleware antes do `execute`).
 *  - `$disable`, `$antidisable` (`$ad`), `$disablelist` (`$dl`) e `/disable add|remove|list`, com
 *    autocomplete de serie/franquia. `--server` (ou a opcao `server`) atua no servidor inteiro e exige
 *    Administrador.
 */
import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandBooleanOption,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { z } from "zod";
import type { Locale } from "../../config/constants.js";
import type { AnyCommand, CommandContext, CommandDefinition } from "../../core/contracts.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { createPaginator } from "../../ui/components/paginator.js";
import { createPanel } from "../../ui/components/panel.js";
import { escapeMarkdown } from "../../ui/format.js";
import {
  applyGuildSetting,
  assertCanManageServerWide,
  autocompleteDisabled,
  autocompleteTargets,
  disableTarget,
  DISABLE_PAGE_SIZE,
  enableTarget,
  findDisabledEntry,
  getGuildSettings,
  listDisabled,
  resolveTarget,
  SETTING_KEYS,
  SETTING_LIMITS,
  TARGET_AUTOCOMPLETE_LIMIT,
  type SettingKey,
} from "./service.js";
import {
  buildSettingsSections,
  disableAlreadyEmbed,
  disableOkEmbed,
  emptyDisabledEmbed,
  enableOkEmbed,
  renderDisabledPage,
  replyFallbackError,
  settingAppliedEmbed,
  SLASH_TEXT,
  targetChoice,
} from "./views.js";

/** Gerenciar Servidor (Administrador tambem passa: `has` considera o bit de admin). */
const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;

/** Chaves de erro que ainda nao estao nos locales viram texto local em vez da chave crua. */
function guarded<A>(
  run: (ctx: CommandContext<A>) => Promise<void>
): (ctx: CommandContext<A>) => Promise<void> {
  return async (ctx) => {
    try {
      await run(ctx);
    } catch (err) {
      if (await replyFallbackError(ctx, err)) return;
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// $settings / /settings
// ---------------------------------------------------------------------------

export async function runSettings(ctx: CommandContext): Promise<void> {
  const kv = await getKV();
  const sections = buildSettingsSections({
    locale: ctx.locale,
    guildName: ctx.guild.name,
    load: () => getGuildSettings(ctx.guild.id),
    loadServerDisabled: () => listDisabled(ctx.guild.id, ctx.user.id, true),
  });
  const panel = await createPanel({ kv, ownerId: ctx.user.id, sections, locale: ctx.locale });
  const message = await ctx.reply(panel.payload);
  panel.attach(message);
}

export const settingsCommand: CommandDefinition = {
  name: "settings",
  aliases: ["serversettings", "config"],
  category: "config",
  descriptionKey: "help.commands.settings",
  slash: () => new SlashCommandBuilder().setName("settings"),
  cooldownMs: 3_000,
  execute: runSettings,
};

// ---------------------------------------------------------------------------
// $setrolls, $settimer, $setclaim, $gamemode, $prefix, $lang
// ---------------------------------------------------------------------------

export async function runSetting(
  ctx: CommandContext<unknown>,
  key: SettingKey,
  raw: unknown
): Promise<void> {
  const applied = await applyGuildSetting(ctx.guild.id, key, raw, {
    prefix: ctx.guildConfig.prefix,
  });
  // A confirmacao de $lang ja sai no idioma novo.
  const locale: Locale = key === "lang" ? (applied.value as Locale) : ctx.locale;
  await ctx.reply({ embeds: [settingAppliedEmbed(locale, applied)] });
}

const settingValueSchema = z.object({
  value: z.union([z.string(), z.number()]).optional(),
});
type SettingValueArgs = z.infer<typeof settingValueSchema>;

function settingCommand(
  key: SettingKey,
  def: { name: string; aliases?: string[]; descriptionKey: string }
): CommandDefinition<typeof settingValueSchema> {
  return {
    ...def,
    category: "config",
    args: settingValueSchema,
    parseArgs: (tokens) => ({ value: tokens[0] }),
    permissions: MANAGE_GUILD,
    cooldownMs: 3_000,
    execute: guarded<SettingValueArgs>((ctx) => runSetting(ctx, key, ctx.args.value)),
  };
}

export const setRollsCommand = settingCommand("rolls", {
  name: "setrolls",
  descriptionKey: "help.commands.setrolls",
});
export const setTimerCommand = settingCommand("timer", {
  name: "settimer",
  descriptionKey: "help.commands.settimer",
});
export const setClaimCommand = settingCommand("claim", {
  name: "setclaim",
  descriptionKey: "help.commands.setclaim",
});
export const gamemodeCommand = settingCommand("gamemode", {
  name: "gamemode",
  descriptionKey: "help.commands.gamemode",
});
export const prefixCommand = settingCommand("prefix", {
  name: "prefix",
  aliases: ["prefixo"],
  descriptionKey: "help.commands.prefix",
});
export const langCommand = settingCommand("lang", {
  name: "lang",
  aliases: ["idioma"],
  descriptionKey: "help.commands.lang",
});

// ---------------------------------------------------------------------------
// $set <config> <valor> e /set <config> valor
// ---------------------------------------------------------------------------

const SETTING_ALIASES = new Map<string, SettingKey>([
  ...SETTING_KEYS.map((key): [string, SettingKey] => [key, key]),
  ["setrolls", "rolls"],
  ["settimer", "timer"],
  ["setclaim", "claim"],
  ["prefixo", "prefix"],
  ["idioma", "lang"],
]);

export const setArgsSchema = z.object({
  setting: z.enum(SETTING_KEYS),
  value: z.union([z.string(), z.number()]).optional(),
});
type SetArgs = z.infer<typeof setArgsSchema>;

export function parseSetTokens(tokens: string[]): unknown {
  const first = tokens[0]?.toLowerCase();
  return { setting: first ? (SETTING_ALIASES.get(first) ?? first) : undefined, value: tokens[1] };
}

/** `/set rolls|timer|claim|gamemode|prefix|lang value:<...>`. */
export function buildSetSlash(): SlashCommandBuilder {
  const pt = SLASH_TEXT["pt-BR"];
  const en = SLASH_TEXT["en-US"];
  const L = SETTING_LIMITS;
  const integerSub = (key: "rolls" | "timer" | "claim" | "gamemode") => (
    sub: SlashCommandSubcommandBuilder
  ) =>
    sub
      .setName(key)
      .setDescription(pt[key])
      .setDescriptionLocalizations({ "en-US": en[key] })
      .addIntegerOption((o) =>
        o
          .setName("value")
          .setDescription(pt.value)
          .setDescriptionLocalizations({ "en-US": en.value })
          .setRequired(true)
          .setMinValue(L[key].min)
          .setMaxValue(L[key].max)
      );

  return new SlashCommandBuilder()
    .setName("set")
    .setDescription(pt.set)
    .setDescriptionLocalizations({ "en-US": en.set })
    .setDefaultMemberPermissions(MANAGE_GUILD)
    .addSubcommand(integerSub("rolls"))
    .addSubcommand(integerSub("timer"))
    .addSubcommand(integerSub("claim"))
    .addSubcommand(integerSub("gamemode"))
    .addSubcommand((sub) =>
      sub
        .setName("prefix")
        .setDescription(pt.prefix)
        .setDescriptionLocalizations({ "en-US": en.prefix })
        .addStringOption((o) =>
          o
            .setName("value")
            .setDescription(pt.value)
            .setDescriptionLocalizations({ "en-US": en.value })
            .setRequired(true)
            .setMinLength(L.prefix.min)
            .setMaxLength(L.prefix.max)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("lang")
        .setDescription(pt.lang)
        .setDescriptionLocalizations({ "en-US": en.lang })
        .addStringOption((o) =>
          o
            .setName("value")
            .setDescription(pt.value)
            .setDescriptionLocalizations({ "en-US": en.value })
            .setRequired(true)
            .addChoices(
              { name: "Português (pt-BR)", value: "pt-br" },
              { name: "English (en-US)", value: "en" }
            )
        )
    ) as unknown as SlashCommandBuilder;
}

export const setCommand: CommandDefinition<typeof setArgsSchema> = {
  name: "set",
  category: "config",
  descriptionKey: "help.commands.set",
  args: setArgsSchema,
  parseArgs: (tokens) => parseSetTokens(tokens),
  slash: buildSetSlash,
  slashArgs: (interaction: ChatInputCommandInteraction) => ({
    setting: interaction.options.getSubcommand(),
    value: interaction.options.get("value")?.value,
  }),
  permissions: MANAGE_GUILD,
  cooldownMs: 3_000,
  execute: guarded<SetArgs>((ctx) => runSetting(ctx, ctx.args.setting, ctx.args.value)),
};

// ---------------------------------------------------------------------------
// $disable, $antidisable, $disablelist e /disable add|remove|list
// ---------------------------------------------------------------------------

export const disableArgsSchema = z
  .object({
    action: z.enum(["add", "remove", "list"]),
    query: z.string().trim().min(1).max(100).optional(),
    /** Atua no servidor inteiro (Administrador). */
    server: z.boolean().default(false),
  })
  .superRefine((args, ctx) => {
    if (args.action !== "list" && !args.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "required" });
    }
  });
export type DisableArgs = z.infer<typeof disableArgsSchema>;

const SERVER_FLAGS = new Set(["--server", "--servidor"]);

/**
 * Tokens de prefixo -> argumentos. A flag `--server` pode vir em qualquer posicao. `$disable` sem nome
 * lista (comportamento do bot antigo).
 */
export function parseDisableTokens(
  tokens: string[],
  action: "add" | "remove" | "list"
): unknown {
  const server = tokens.some((tok) => SERVER_FLAGS.has(tok.toLowerCase()));
  const query = tokens
    .filter((tok) => !SERVER_FLAGS.has(tok.toLowerCase()))
    .join(" ")
    .trim();
  if (action === "list" || (action === "add" && query === "")) return { action: "list", server };
  return { action, query: query || undefined, server };
}

async function showDisabled(ctx: CommandContext<DisableArgs>, serverWide: boolean): Promise<void> {
  const entries = await listDisabled(ctx.guild.id, ctx.user.id, serverWide);
  const prefix = ctx.guildConfig.prefix;
  if (entries.length === 0) {
    await ctx.reply({ embeds: [emptyDisabledEmbed(ctx.locale, prefix, serverWide)] });
    return;
  }
  const kv = await getKV();
  const view = { locale: ctx.locale, prefix, serverWide, pageSize: DISABLE_PAGE_SIZE };
  const paginator = await createPaginator({
    kv,
    ownerId: ctx.user.id,
    pageSize: DISABLE_PAGE_SIZE,
    items: entries,
    locale: ctx.locale,
    renderPage: (items, page, totalPages, total) =>
      renderDisabledPage(items, page, totalPages, total, view),
  });
  const message = await ctx.reply(paginator.payload);
  paginator.attach(message);
}

export async function runDisable(ctx: CommandContext<DisableArgs>): Promise<void> {
  const { action, query, server } = ctx.args;
  if (action === "list") {
    await showDisabled(ctx, server);
    return;
  }
  // Alterar o servidor inteiro e privilegio de Administrador; checado antes de qualquer escrita.
  if (server) assertCanManageServerWide(ctx.member);

  const guildId = ctx.guild.id;
  const userId = ctx.user.id;
  const text = query ?? "";

  if (action === "add") {
    const target = await resolveTarget(text);
    if (!target) throw new UserError("config.disable_series_not_found", { query: escapeMarkdown(text) });
    const { created } = await disableTarget({
      guildId,
      userId,
      username: ctx.user.username,
      target,
      serverWide: server,
    });
    await ctx.reply({
      embeds: [
        created
          ? disableOkEmbed(ctx.locale, target, server)
          : disableAlreadyEmbed(ctx.locale, target),
      ],
    });
    return;
  }

  const entry = findDisabledEntry(await listDisabled(guildId, userId, server), text);
  if (!entry) throw new UserError("config.disable_not_found", { query: escapeMarkdown(text) });
  await enableTarget({ guildId, userId, target: entry, serverWide: server });
  await ctx.reply({ embeds: [enableOkEmbed(ctx.locale, entry.name, server)] });
}

/** Autocomplete da opcao `series` de `/disable`: catalogo (add) ou o que ja esta desativado (remove). */
export async function handleDisableAutocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "series" || !interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const query = String(focused.value ?? "");
  if (interaction.options.getSubcommand(false) === "remove") {
    const entries = await autocompleteDisabled(
      interaction.guildId,
      interaction.user.id,
      interaction.options.getBoolean("server") ?? false,
      query
    );
    await interaction.respond(entries.slice(0, TARGET_AUTOCOMPLETE_LIMIT).map(targetChoice));
    return;
  }
  const targets = await autocompleteTargets(await getKV(), query);
  await interaction.respond(targets.slice(0, TARGET_AUTOCOMPLETE_LIMIT).map(targetChoice));
}

/** `/disable add|remove|list`. A descricao do comando vem de `help.commands.disable` (registry). */
export function buildDisableSlash(): SlashCommandBuilder {
  const pt = SLASH_TEXT["pt-BR"];
  const en = SLASH_TEXT["en-US"];
  const seriesOption = (o: SlashCommandStringOption) =>
    o
      .setName("series")
      .setDescription(pt.series)
      .setDescriptionLocalizations({ "en-US": en.series })
      .setAutocomplete(true)
      .setRequired(true)
      .setMaxLength(100);
  const serverOption = (o: SlashCommandBooleanOption) =>
    o
      .setName("server")
      .setDescription(pt.server)
      .setDescriptionLocalizations({ "en-US": en.server })
      .setRequired(false);

  return new SlashCommandBuilder()
    .setName("disable")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription(pt.disableAdd)
        .setDescriptionLocalizations({ "en-US": en.disableAdd })
        .addStringOption(seriesOption)
        .addBooleanOption(serverOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription(pt.disableRemove)
        .setDescriptionLocalizations({ "en-US": en.disableRemove })
        .addStringOption(seriesOption)
        .addBooleanOption(serverOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription(pt.disableList)
        .setDescriptionLocalizations({ "en-US": en.disableList })
        .addBooleanOption(serverOption)
    ) as unknown as SlashCommandBuilder;
}

export const disableCommand: CommandDefinition<typeof disableArgsSchema> = {
  name: "disable",
  aliases: ["d"],
  category: "config",
  descriptionKey: "help.commands.disable",
  args: disableArgsSchema,
  parseArgs: (tokens) => parseDisableTokens(tokens, "add"),
  slash: buildDisableSlash,
  slashArgs: (interaction: ChatInputCommandInteraction) => ({
    action: interaction.options.getSubcommand(),
    query: interaction.options.getString("series") ?? undefined,
    server: interaction.options.getBoolean("server") ?? false,
  }),
  autocomplete: handleDisableAutocomplete,
  cooldownMs: 1_500,
  execute: guarded(runDisable),
};

export const antiDisableCommand: CommandDefinition<typeof disableArgsSchema> = {
  name: "antidisable",
  aliases: ["ad", "enable", "e"],
  category: "config",
  descriptionKey: "help.commands.antidisable",
  args: disableArgsSchema,
  parseArgs: (tokens) => parseDisableTokens(tokens, "remove"),
  cooldownMs: 1_500,
  execute: guarded(runDisable),
};

export const disableListCommand: CommandDefinition<typeof disableArgsSchema> = {
  name: "disablelist",
  aliases: ["dl"],
  category: "config",
  descriptionKey: "help.commands.disablelist",
  args: disableArgsSchema,
  parseArgs: (tokens) => parseDisableTokens(tokens, "list"),
  cooldownMs: 2_000,
  execute: guarded(runDisable),
};

const limroulArgs = z.object({
  limit: z.number().int().min(1).max(50000).optional(),
});

export const limroulCommand: CommandDefinition<typeof limroulArgs> = {
  name: "limroul",
  aliases: ["lr"],
  category: "config",
  descriptionKey: "help.commands.gamemode",
  args: limroulArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens) => {
    if (tokens.length === 0) return {};
    const n = parseInt(tokens[0]!, 10);
    return isNaN(n) ? {} : { limit: n };
  },
  async execute(ctx) {
    const p = ctx.guildConfig.prefix;
    const kv = await getKV();
    const key = `user:${ctx.user.id}:limroul`;

    if (ctx.args.limit !== undefined) {
      const val = Math.min(Math.max(ctx.args.limit, 100), 20000);
      await kv.set(key, String(val));
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle("🎯 Limite de Rolagem Pessoal Atualizado ($limroul)")
            .setDescription(
              `Seu limite de invocação foi ajustado para os **Top ${val.toLocaleString("pt-BR")}** personagens mais populares!\n` +
                `Todas as suas rolagens em \`${p}w\`, \`${p}h\`, etc. agora priorizam personagens deste patamar de rank.`
            ),
        ],
      });
      return;
    }

    const current = (await kv.get(key)) ?? "4000";
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle("🎯 Modo Competitivo — Limite de Rolagem ($limroul)")
          .setDescription(
            `Filtre o pool de sorteio para conter apenas os personagens mais conhecidos do mundo dos animes, jogos e cinema!\n\n` +
              `▸ Limite Pessoal Atual: **Top ${parseInt(current, 10).toLocaleString("pt-BR")}**\n\n` +
              `**Como Alterar:**\n` +
              `\`${p}limroul 1000\` — Sorteia apenas o Top 1.000 global\n` +
              `\`${p}limroul 4000\` — Padrão balanceado do Mudae (Top 4.000)\n` +
              `\`${p}limroul 8000\` — Pool expandido com personagens secundários`
          ),
      ],
    });
  },
};

const personalrareArgs = z.object({
  rate: z.number().int().min(1).max(5).optional(),
});

export const personalrareCommand: CommandDefinition<typeof personalrareArgs> = {
  name: "personalrare",
  aliases: ["prb", "rare"],
  category: "config",
  descriptionKey: "help.commands.gamemode",
  args: personalrareArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens) => {
    if (tokens.length === 0) return {};
    const n = parseInt(tokens[0]!, 10);
    return isNaN(n) ? {} : { rate: n };
  },
  async execute(ctx) {
    const p = ctx.guildConfig.prefix;
    const kv = await getKV();
    const key = `user:${ctx.user.id}:personalrare`;

    if (ctx.args.rate !== undefined) {
      await kv.set(key, String(ctx.args.rate));
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle("🎲 Frequência de Cartas Casadas ($personalrare)")
            .setDescription(
              `Seu nível de raridade pessoal foi definido para **Nível ${ctx.args.rate}**!\n` +
                (ctx.args.rate === 1
                  ? "▸ Nível 1: Prioriza cartas livres ainda não casadas por ninguém no servidor."
                  : ctx.args.rate === 5
                    ? "▸ Nível 5: Máxima frequência de cartas já casadas para geração de Éter e Orbes."
                    : `▸ Nível ${ctx.args.rate}: Equilíbrio calibrado entre cartas livres e cartas casadas.`)
            ),
        ],
      });
      return;
    }

    const current = (await kv.get(key)) ?? "2";
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle("🎲 Frequência de Cartas Casadas ($personalrare)")
          .setDescription(
            `Controle a probabilidade de sortear cartas que já pertencem a outros jogadores no servidor:\n\n` +
              `▸ Nível Atual: **Nível ${current}** (de 1 a 5)\n\n` +
              `**Escala de 1 a 5:**\n` +
              `▸ \`${p}personalrare 1\` — Menor taxa de repetidos (foco em achar cartas solteiras)\n` +
              `▸ \`${p}personalrare 2\` — Padrão recomendado\n` +
              `▸ \`${p}personalrare 5\` — Maior taxa de repetidos (foco em farm de Éter / Kakera com orbes)`
          ),
      ],
    });
  },
};

export const configCommands: AnyCommand[] = [
  settingsCommand,
  setRollsCommand,
  setTimerCommand,
  setClaimCommand,
  gamemodeCommand,
  prefixCommand,
  langCommand,
  setCommand,
  disableCommand,
  antiDisableCommand,
  disableListCommand,
  limroulCommand,
  personalrareCommand,
];
