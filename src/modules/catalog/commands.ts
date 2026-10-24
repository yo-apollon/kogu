/**
 * Comandos do modulo CATALOG (prefixo + slash).
 *
 *   import         -> add, importar        (+ /import name)        owner e VIP (VIP: 2/dia)
 *   suggest        -> sugerir              (+ /suggest name)       qualquer membro, com limite
 *   suggestlist    -> sugestoes            (+ /suggestlist)        staff
 *   approvesuggest -> aprovar              (+ /approvesuggest name) staff
 *   catalog        -> (sem alias)          (+ /catalog review|merge) owner / catalog_moderators
 *
 * Portes de handleImportCommand/handleSuggestCommand/handleSuggestionAdminCommands (legado) sobre o
 * pipeline do catalogo (`service.ts`). O `$import` do legado liberava qualquer Administrator; aqui
 * so OWNER_IDS e VIPs (users.vip_tier > 0).
 */
import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { z } from "zod";
import type { AnyCommand, CommandContext, CommandDefinition } from "../../core/contracts.js";
import { isOwner } from "../../config/env.js";
import { t } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import type { DbExecutor } from "../../catalog/executor.js";
import { getKV } from "../../infra/redis/client.js";
import { UserError } from "../../lib/errors.js";
import { confirm } from "../../ui/components/confirm.js";
import { createPaginator, pageIndicator } from "../../ui/components/paginator.js";
import { errorEmbed, infoEmbed, successEmbed } from "../../ui/embeds.js";
import { truncate } from "../../ui/format.js";
import { AniListCharacterFinder, CatalogApiError, createAniListLimiter, type CharacterFinder } from "./anilist.js";
import { renderReview } from "./components.js";
import { msg } from "./messages.js";
import { isCatalogModerator } from "./review.js";
import {
  VIP_DAILY_IMPORT_LIMIT,
  claimSuggestion,
  claimVipImport,
  createSuggestion,
  findPendingSuggestion,
  importCharacter,
  listPendingSuggestions,
  mergeCatalogEntities,
  notifyCatalogUpdated,
  previewMerge,
  refundVipImport,
  releaseSuggestion,
  resolveImportRole,
  resolveSuggestion,
  type SuggestionScope,
} from "./service.js";
import { importEmbed, suggestionListEmbed } from "./views.js";

const SLASH_DESCRIPTION_MAX = 100;
const SUGGEST_PAGE_SIZE = 10;

function database(): DbExecutor {
  return db as unknown as DbExecutor;
}

/** Cria o buscador do AniList uma vez, com o token bucket compartilhado (`catalog:anilist`). */
let finderPromise: Promise<CharacterFinder> | undefined;
function getFinder(): Promise<CharacterFinder> {
  finderPromise ??= getKV().then((kv) => new AniListCharacterFinder({ rateLimiter: createAniListLimiter(kv) }));
  finderPromise.catch(() => {
    finderPromise = undefined;
  });
  return finderPromise;
}

const define = <S extends z.ZodTypeAny>(def: CommandDefinition<S>): AnyCommand =>
  def as unknown as AnyCommand;

function slashBase(name: string, descriptionKey: string, fallback: { pt: string; en: string }) {
  const text = (lang: "pt-BR" | "en-US", alt: string) =>
    truncate(msg(lang, descriptionKey) === descriptionKey ? alt : msg(lang, descriptionKey), SLASH_DESCRIPTION_MAX);
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(text("pt-BR", fallback.pt))
    .setDescriptionLocalizations({ "en-US": text("en-US", fallback.en) })
    .setContexts(InteractionContextType.Guild);
}

const OPT_NAME = { pt: "Nome do personagem", en: "Character name" };

function failure(ctx: CommandContext, description: string) {
  return { embeds: [errorEmbed({ description, locale: ctx.locale, footer: false })], ephemeral: true as const };
}

/* ------------------------------------------------------------------ */
/* $import                                                            */
/* ------------------------------------------------------------------ */

const queryArgs = z.object({ query: z.string().max(200) });
const queryFromTokens = (tokens: string[]) => ({ query: tokens.join(" ") });

export const importCommand: AnyCommand = define({
  name: "import",
  aliases: ["add", "importar"],
  category: "catalog",
  descriptionKey: "help.commands.import",
  args: queryArgs,
  parseArgs: queryFromTokens,
  cooldownMs: 10_000,
  slash: () =>
    slashBase("import", "help.commands.import", {
      pt: "Importa um personagem do AniList para o catálogo.",
      en: "Imports a character from AniList into the catalog.",
    }).addStringOption((o) =>
      o
        .setName("name")
        .setDescription(OPT_NAME.pt)
        .setDescriptionLocalizations({ "en-US": OPT_NAME.en })
        .setRequired(true)
        .setMaxLength(200)
    ),
  slashArgs: (i) => ({ query: i.options.getString("name", true) }),
  async execute(ctx) {
    const prefix = ctx.guildConfig.prefix;
    const query = ctx.args.query.replace(/\s+/g, " ").trim();
    if (!query) {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.import_usage", { prefix })));
      return;
    }

    const database_ = database();
    const role = await resolveImportRole(database_, ctx.user.id);
    if (role === "denied") {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.import_restricted", { prefix, query })));
      return;
    }

    const usesQuota = role === "vip";
    if (usesQuota) {
      const claim = await claimVipImport(database_, ctx.user.id);
      if (!claim.ok) {
        await ctx.reply(
          failure(ctx, msg(ctx.locale, "catalog.import_vip_limit", { max: VIP_DAILY_IMPORT_LIMIT }))
        );
        return;
      }
    }

    await ctx.defer();
    let imported = false;
    try {
      const outcome = await importCharacter(query, {
        db: database_,
        finder: await getFinder(),
        actor: { id: ctx.user.id, isOwner: role === "owner" },
      });
      if (outcome.kind === "not_found") {
        await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.import_not_found", { query })));
        return;
      }
      imported = outcome.kind === "imported";
      await ctx.reply({ embeds: [importEmbed(outcome, ctx.locale)] });
      if (outcome.kind === "imported" && outcome.entity.status === "ACTIVE") {
        await notifyCatalogUpdated("import");
      }
    } catch (err) {
      if (err instanceof CatalogApiError) {
        await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.import_api_error")));
        return;
      }
      throw err;
    } finally {
      // Cota so vale para importacao que de fato aconteceu.
      if (usesQuota && !imported) {
        await refundVipImport(database_, ctx.user.id).catch(() => undefined);
      }
    }
  },
});

/* ------------------------------------------------------------------ */
/* $suggest                                                           */
/* ------------------------------------------------------------------ */

export const suggestCommand: AnyCommand = define({
  name: "suggest",
  aliases: ["sugerir"],
  category: "catalog",
  descriptionKey: "help.commands.suggest",
  args: queryArgs,
  parseArgs: queryFromTokens,
  cooldownMs: 15_000,
  slash: () =>
    slashBase("suggest", "help.commands.suggest", {
      pt: "Sugere um personagem para o catálogo.",
      en: "Suggests a character for the catalog.",
    }).addStringOption((o) =>
      o
        .setName("name")
        .setDescription(OPT_NAME.pt)
        .setDescriptionLocalizations({ "en-US": OPT_NAME.en })
        .setRequired(true)
        .setMaxLength(100)
    ),
  slashArgs: (i) => ({ query: i.options.getString("name", true) }),
  async execute(ctx) {
    const prefix = ctx.guildConfig.prefix;
    const query = ctx.args.query.replace(/\s+/g, " ").trim();
    if (!query) {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.suggest_usage", { prefix })));
      return;
    }
    const result = await createSuggestion(database(), {
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      username: ctx.user.username,
      characterName: query,
    });
    switch (result.status) {
      case "created":
        await ctx.reply({
          embeds: [successEmbed({ description: msg(ctx.locale, "catalog.suggest_sent", { query, prefix }) })],
        });
        return;
      case "limit":
        await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.suggest_limit", { max: result.max })));
        return;
      case "duplicate":
        await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.suggest_duplicate", { query })));
        return;
      case "exists":
        await ctx.reply({
          embeds: [
            infoEmbed({
              description: msg(ctx.locale, "catalog.import_exists", {
                name: result.entityName,
                franchise: result.franchise,
              }),
            }),
          ],
        });
    }
  },
});

/* ------------------------------------------------------------------ */
/* $suggestlist / $approvesuggest (staff)                             */
/* ------------------------------------------------------------------ */

/**
 * Staff do catalogo: owner e moderadores veem/aprovam a fila inteira; Administrator do servidor,
 * so as sugestoes do proprio servidor. Os demais recebem `catalog.suggest_admin_only`.
 */
async function suggestionScope(ctx: CommandContext): Promise<SuggestionScope> {
  if (await isCatalogModerator(database(), ctx.user.id)) return {};
  if (ctx.member?.permissions.has(PermissionFlagsBits.Administrator)) return { guildId: ctx.guild.id };
  throw new UserError("catalog.suggest_admin_only");
}

export const suggestListCommand: AnyCommand = define({
  name: "suggestlist",
  aliases: ["sugestoes"],
  category: "catalog",
  descriptionKey: "help.commands.suggestlist",
  cooldownMs: 5_000,
  slash: () =>
    slashBase("suggestlist", "help.commands.suggestlist", {
      pt: "Lista as sugestões pendentes (staff).",
      en: "Lists pending suggestions (staff).",
    }),
  async execute(ctx) {
    const scope = await suggestionScope(ctx);
    const prefix = ctx.guildConfig.prefix;
    const paginator = await createPaginator({
      kv: await getKV(),
      ownerId: ctx.user.id,
      locale: ctx.locale,
      pageSize: SUGGEST_PAGE_SIZE,
      loader: async (page, size) => {
        const { rows, total } = await listPendingSuggestions(database(), {
          ...scope,
          limit: size,
          offset: (page - 1) * size,
        });
        return { items: rows, total };
      },
      renderPage: (items, page, totalPages, total) => {
        if (total === 0) {
          return { embeds: [infoEmbed({ description: msg(ctx.locale, "catalog.suggest_list_empty") })] };
        }
        return {
          embeds: [
            suggestionListEmbed({
              rows: items,
              total,
              offset: (page - 1) * SUGGEST_PAGE_SIZE,
              prefix,
              locale: ctx.locale,
              pageLabel: totalPages > 1 ? pageIndicator(page, totalPages, ctx.locale) : undefined,
            }),
          ],
        };
      },
    });
    const message = await ctx.reply(paginator.payload);
    paginator.attach(message);
  },
});

export const approveSuggestCommand: AnyCommand = define({
  name: "approvesuggest",
  aliases: ["aprovar"],
  category: "catalog",
  descriptionKey: "help.commands.approvesuggest",
  args: queryArgs,
  parseArgs: queryFromTokens,
  cooldownMs: 5_000,
  slash: () =>
    slashBase("approvesuggest", "help.commands.approvesuggest", {
      pt: "Aprova uma sugestão e importa o personagem (staff).",
      en: "Approves a suggestion and imports the character (staff).",
    }).addStringOption((o) =>
      o
        .setName("name")
        .setDescription(OPT_NAME.pt)
        .setDescriptionLocalizations({ "en-US": OPT_NAME.en })
        .setRequired(true)
        .setMaxLength(100)
    ),
  slashArgs: (i) => ({ query: i.options.getString("name", true) }),
  async execute(ctx) {
    const prefix = ctx.guildConfig.prefix;
    const typed = ctx.args.query.replace(/\s+/g, " ").trim();
    const scope = await suggestionScope(ctx);
    if (!typed) {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.approve_usage", { prefix })));
      return;
    }

    const database_ = database();
    const found = await findPendingSuggestion(database_, typed, scope);
    if (found && !(await claimSuggestion(database_, found.id, ctx.user.id))) {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.review_stale")));
      return;
    }
    const query = found?.characterName ?? typed;

    await ctx.reply({ embeds: [infoEmbed({ description: msg(ctx.locale, "catalog.approve_ok", { query }) })] });
    let done = false;
    try {
      const outcome = await importCharacter(query, {
        db: database_,
        finder: await getFinder(),
        actor: { id: ctx.user.id, isOwner: isOwner(ctx.user.id) },
      });
      if (outcome.kind === "not_found") {
        await ctx.followUp(failure(ctx, msg(ctx.locale, "catalog.import_not_found", { query })));
        return;
      }
      done = true;
      if (found) {
        await resolveSuggestion(database_, found.id, {
          entityId: outcome.entity.id,
          anilistId: outcome.kind === "disabled" ? null : outcome.anilistId,
        });
      }
      await ctx.followUp({ embeds: [importEmbed(outcome, ctx.locale)] });
      if (outcome.kind === "imported" && outcome.entity.status === "ACTIVE") {
        await notifyCatalogUpdated("import");
      }
    } catch (err) {
      if (err instanceof CatalogApiError) {
        await ctx.followUp(failure(ctx, msg(ctx.locale, "catalog.import_api_error")));
        return;
      }
      throw err;
    } finally {
      // Nao importou: a sugestao volta para a fila em vez de ficar "aprovada" sem entidade.
      if (found && !done) await releaseSuggestion(database_, found.id).catch(() => undefined);
    }
  },
});

/* ------------------------------------------------------------------ */
/* /catalog review | merge                                            */
/* ------------------------------------------------------------------ */

const catalogArgs = z.object({
  sub: z.enum(["review", "merge"]).default("review"),
  id1: z.coerce.number().int().positive().optional(),
  id2: z.coerce.number().int().positive().optional(),
});

export const catalogCommand: AnyCommand = define({
  name: "catalog",
  category: "catalog",
  descriptionKey: "help.commands.catalog",
  args: catalogArgs,
  parseArgs: (tokens) => ({ sub: tokens[0]?.toLowerCase(), id1: tokens[1], id2: tokens[2] }),
  cooldownMs: 3_000,
  slash: () => {
    const builder = slashBase("catalog", "help.commands.catalog", {
      pt: "Moderação do catálogo (revisão e merge).",
      en: "Catalog moderation (review and merge).",
    });
    builder.addSubcommand((s) =>
      s
        .setName("review")
        .setDescription("Revisa a fila de moderação do catálogo.")
        .setDescriptionLocalizations({ "en-US": "Reviews the catalog moderation queue." })
    );
    builder.addSubcommand((s) =>
      s
        .setName("merge")
        .setDescription("Mescla a entidade id2 na entidade id1.")
        .setDescriptionLocalizations({ "en-US": "Merges entity id2 into entity id1." })
        .addIntegerOption((o) =>
          o
            .setName("id1")
            .setDescription("ID da entidade que permanece")
            .setDescriptionLocalizations({ "en-US": "ID of the entity that stays" })
            .setMinValue(1)
            .setRequired(true)
        )
        .addIntegerOption((o) =>
          o
            .setName("id2")
            .setDescription("ID da entidade a mesclar")
            .setDescriptionLocalizations({ "en-US": "ID of the entity to merge" })
            .setMinValue(1)
            .setRequired(true)
        )
    );
    return builder;
  },
  slashArgs: (i) => ({
    sub: i.options.getSubcommand(),
    id1: i.options.getInteger("id1") ?? undefined,
    id2: i.options.getInteger("id2") ?? undefined,
  }),
  async execute(ctx) {
    const database_ = database();
    if (!(await isCatalogModerator(database_, ctx.user.id))) {
      throw new UserError("common.no_permission");
    }

    if (ctx.args.sub === "review") {
      const view = await renderReview(database_, ctx.locale, null);
      await ctx.reply({ ...view, ephemeral: true });
      return;
    }

    const { id1, id2 } = ctx.args;
    if (id1 === undefined || id2 === undefined) {
      await ctx.reply(failure(ctx, msg(ctx.locale, "catalog.merge_usage", { prefix: ctx.guildConfig.prefix })));
      return;
    }
    const preview = await previewMerge(database_, id1, id2);
    if (!preview.ok) {
      await ctx.reply(
        failure(
          ctx,
          preview.code === "not_found"
            ? msg(ctx.locale, "catalog.merge_not_found", { id: preview.id })
            : msg(ctx.locale, "catalog.merge_failed", { reason: preview.reason })
        )
      );
      return;
    }
    const confirmed = await confirm({
      ownerId: ctx.user.id,
      locale: ctx.locale,
      danger: true,
      prompt: msg(ctx.locale, "catalog.merge_confirm", {
        loser: preview.loser.name,
        loserId: preview.loser.id,
        winner: preview.winner.name,
        winnerId: preview.winner.id,
      }),
      send: (payload) => ctx.reply({ ...payload, ephemeral: true }),
    });
    if (!confirmed) {
      await ctx.followUp({ content: t("ui.confirm.cancelled", ctx.locale), ephemeral: true });
      return;
    }
    const outcome = await mergeCatalogEntities(database_, id1, id2, ctx.user.id);
    if (!outcome.ok) {
      await ctx.followUp(
        failure(
          ctx,
          outcome.code === "not_found"
            ? msg(ctx.locale, "catalog.merge_not_found", { id: outcome.id })
            : msg(ctx.locale, "catalog.merge_failed", { reason: outcome.reason })
        )
      );
      return;
    }
    await notifyCatalogUpdated("merge");
    await ctx.followUp({
      embeds: [
        successEmbed({
          description: msg(ctx.locale, "catalog.merge_ok", {
            loser: outcome.loser.name,
            winner: outcome.winner.name,
            pacts: outcome.result.pactsMoved,
            conflicts: outcome.result.pactConflicts,
            wishes: outcome.result.wishesMoved,
          }),
        }),
      ],
      ephemeral: true,
    });
  },
});

export const catalogCommands: AnyCommand[] = [
  importCommand,
  suggestCommand,
  suggestListCommand,
  approveSuggestCommand,
  catalogCommand,
];
