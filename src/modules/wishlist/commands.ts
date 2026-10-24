/**
 * Comandos da Lista de Desejos.
 *
 *  - `$wish <nome>` (alterna), `$wish add|remove|list ...`, `/wish add|remove|list`
 *  - `$wl` / `$wishlist` (lista), `$sw` / `$starwish <nome>` (Desejo Estelar), `/starwish`
 * O autocomplete da opcao `entity` busca no catalogo (add/starwish) ou na propria lista (remove).
 */
import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from "discord.js";
import { z } from "zod";
import type { AnyCommand, CommandContext, CommandDefinition } from "../../core/contracts.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { createPaginator } from "../../ui/components/paginator.js";
import { escapeMarkdown } from "../../ui/format.js";
import type { MemberRef } from "../economy/service.js";
import {
  addWish,
  autocompleteEntities,
  autocompleteWishes,
  AUTOCOMPLETE_LIMIT,
  findWishEntry,
  guildAllowsAdult,
  listWishes,
  removeWish,
  resolveEntity,
  toggleWish,
  WISHLIST_PAGE_SIZE,
  type EntityHit,
} from "./service.js";
import {
  emptyWishlistEmbed,
  entityChoice,
  removedEmbed,
  renderWishlistPage,
  replyFallbackError,
  SLASH_TEXT,
  wishResultEmbed,
} from "./views.js";

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

export const wishArgsSchema = z
  .object({
    action: z.enum(["list", "add", "remove", "toggle"]),
    query: z.string().trim().min(1).max(100).optional(),
    /** `true` = Desejo Estelar. */
    star: z.boolean().default(false),
  })
  .superRefine((args, ctx) => {
    if (args.action !== "list" && !args.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["query"], message: "required" });
    }
  });

export type WishArgs = z.infer<typeof wishArgsSchema>;

type WishVerb = "add" | "remove" | "list";

const WISH_VERBS = new Map<string, WishVerb>([
  ["add", "add"],
  ["adicionar", "add"],
  ["remove", "remove"],
  ["rm", "remove"],
  ["del", "remove"],
  ["remover", "remove"],
  ["list", "list"],
  ["lista", "list"],
  ["ls", "list"],
]);

/**
 * Tokens de prefixo -> argumentos brutos.
 * `$wish` sem texto lista; `$wish add|remove <nome>` e explicito; `$wish <nome>` alterna
 * (comportamento do bot antigo: adiciona se nao estiver, remove se estiver).
 */
export function parseWishTokens(tokens: string[], opts: { star: boolean }): unknown {
  const verb = tokens[0] ? WISH_VERBS.get(tokens[0].toLowerCase()) : undefined;
  if (verb === "list") return { action: "list", star: false };
  if (verb) {
    return { action: verb, query: tokens.slice(1).join(" ").trim() || undefined, star: opts.star };
  }
  const query = tokens.join(" ").trim();
  if (query === "") return { action: "list", star: false };
  return { action: "toggle", query, star: opts.star };
}

// ---------------------------------------------------------------------------
// Execucao
// ---------------------------------------------------------------------------

function memberRef(ctx: CommandContext<unknown>): MemberRef {
  return { guildId: ctx.guild.id, userId: ctx.user.id, username: ctx.user.username };
}

async function showWishlist(ctx: CommandContext<WishArgs>): Promise<void> {
  const entries = await listWishes(ctx.guild.id, ctx.user.id);
  if (entries.length === 0) {
    await ctx.reply({ embeds: [emptyWishlistEmbed(ctx.locale, ctx.guildConfig.prefix)] });
    return;
  }
  const kv = await getKV();
  const view = {
    locale: ctx.locale,
    userName: ctx.member?.displayName ?? ctx.user.username,
    prefix: ctx.guildConfig.prefix,
    pageSize: WISHLIST_PAGE_SIZE,
  };
  const paginator = await createPaginator({
    kv,
    ownerId: ctx.user.id,
    pageSize: WISHLIST_PAGE_SIZE,
    items: entries,
    locale: ctx.locale,
    renderPage: (items, page, totalPages, total) =>
      renderWishlistPage(items, page, totalPages, total, view),
  });
  const message = await ctx.reply(paginator.payload);
  paginator.attach(message);
}

export async function runWish(ctx: CommandContext<WishArgs>): Promise<void> {
  const { action, query, star } = ctx.args;
  if (action === "list") {
    await showWishlist(ctx);
    return;
  }
  const text = query ?? "";
  const ref = memberRef(ctx);

  if (action === "remove") {
    const entry = findWishEntry(await listWishes(ref.guildId, ref.userId), text);
    if (!entry) throw new UserError("wishlist.not_in_list", { query: escapeMarkdown(text) });
    await removeWish(ref.guildId, ref.userId, entry.entityId);
    await ctx.reply({ embeds: [removedEmbed(ctx.locale, entry.name)] });
    return;
  }

  const entity = await resolveEntity(text, { allowAdult: ctx.guildConfig.allowAdult });
  if (!entity) {
    throw new UserError("wishlist.not_found", {
      query: escapeMarkdown(text),
      prefix: ctx.guildConfig.prefix,
    });
  }
  const result =
    action === "toggle"
      ? await toggleWish(ref, entity.id, { starwish: star })
      : await addWish(ref, entity.id, { starwish: star });
  await ctx.reply({ embeds: [wishResultEmbed(ctx.locale, result, entity)] });
}

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
// Slash e autocomplete
// ---------------------------------------------------------------------------

function entityOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName("entity")
    .setDescription(SLASH_TEXT["pt-BR"].entityOption)
    .setDescriptionLocalizations({ "en-US": SLASH_TEXT["en-US"].entityOption })
    .setAutocomplete(true)
    .setRequired(true)
    .setMaxLength(100);
}

/** `/wish add|remove|list`. A descricao do comando vem de `help.commands.wish` (registry). */
export function buildWishSlash(): SlashCommandBuilder {
  const pt = SLASH_TEXT["pt-BR"];
  const en = SLASH_TEXT["en-US"];
  return new SlashCommandBuilder()
    .setName("wish")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription(pt.add)
        .setDescriptionLocalizations({ "en-US": en.add })
        .addStringOption(entityOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription(pt.remove)
        .setDescriptionLocalizations({ "en-US": en.remove })
        .addStringOption(entityOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription(pt.list)
        .setDescriptionLocalizations({ "en-US": en.list })
    ) as unknown as SlashCommandBuilder;
}

/** `/starwish entity:<...>`. */
export function buildStarwishSlash(): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName("starwish")
    .addStringOption(entityOption) as unknown as SlashCommandBuilder;
}

/** Autocomplete da opcao `entity` de `/wish` e `/starwish`. */
export async function handleEntityAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "entity" || !interaction.guildId) {
    await interaction.respond([]);
    return;
  }
  const query = String(focused.value ?? "");
  let hits: EntityHit[];
  if (interaction.options.getSubcommand(false) === "remove") {
    hits = await autocompleteWishes(interaction.guildId, interaction.user.id, query);
  } else {
    const kv = await getKV();
    hits = await autocompleteEntities(kv, query, await guildAllowsAdult(kv, interaction.guildId));
  }
  await interaction.respond(hits.slice(0, AUTOCOMPLETE_LIMIT).map(entityChoice));
}

// ---------------------------------------------------------------------------
// Definicoes
// ---------------------------------------------------------------------------

export const wishCommand: CommandDefinition<typeof wishArgsSchema> = {
  name: "wish",
  category: "wishlist",
  descriptionKey: "help.commands.wish",
  args: wishArgsSchema,
  parseArgs: (tokens) => parseWishTokens(tokens, { star: false }),
  slash: buildWishSlash,
  slashArgs: (interaction: ChatInputCommandInteraction) => ({
    action: interaction.options.getSubcommand(),
    query: interaction.options.getString("entity") ?? undefined,
    star: false,
  }),
  autocomplete: handleEntityAutocomplete,
  cooldownMs: 1_500,
  execute: guarded(runWish),
};

export const wishlistCommand: CommandDefinition<typeof wishArgsSchema> = {
  name: "wishlist",
  aliases: ["wl"],
  category: "wishlist",
  descriptionKey: "help.commands.wishlist",
  args: wishArgsSchema,
  parseArgs: () => ({ action: "list", star: false }),
  cooldownMs: 2_000,
  execute: guarded(runWish),
};

export const starwishCommand: CommandDefinition<typeof wishArgsSchema> = {
  name: "starwish",
  aliases: ["sw"],
  category: "wishlist",
  descriptionKey: "help.commands.starwish",
  args: wishArgsSchema,
  parseArgs: (tokens) => parseWishTokens(tokens, { star: true }),
  slash: buildStarwishSlash,
  slashArgs: (interaction: ChatInputCommandInteraction) => ({
    action: "add",
    query: interaction.options.getString("entity") ?? undefined,
    star: true,
  }),
  autocomplete: handleEntityAutocomplete,
  cooldownMs: 1_500,
  execute: guarded(runWish),
};

export const wishlistCommands: AnyCommand[] = [wishCommand, wishlistCommand, starwishCommand];
