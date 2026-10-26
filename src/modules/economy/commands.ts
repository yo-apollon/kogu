/**
 * Comandos do modulo ECONOMY (prefixo + slash): timers, daily, perfil, reliquias e ranking.
 * Portes de src/commands/{timers,rpgCommands}.ts (legado) sobre `service.ts`/`extra.ts`.
 *
 * Aliases (todos os do bot antigo preservados):
 *   timers   -> tu, timersup           (+ /timers)
 *   marryup  -> mu                     ($mu: posso firmar pacto?)
 *   rollsup  -> ru, rollsleft, rolls   ($ru: rolls restantes)
 *   kakeraup -> ku                     ($ku: orbes de Eter)
 *   daily    -> dk, dailykakera, diario (+ /daily)
 *   profile  -> pr, perfil             (+ /profile [user])
 *   relics   -> k, kakera, badge, reliquias (+ /relics [relic])
 *   top      -> topserv, ts            (+ /top [mode])
 *
 * Mudanca deliberada: no bot antigo `$rolls` resgatava o daily; ele conflitava com a familia de
 * timers e agora responde como `$ru` (rolls restantes). O daily fica em `$daily`/`$dk`/`$diario`.
 * `$top` deixou de listar o catalogo global e passou a ranquear o servidor (Eter ou pactos).
 */
import { MessageFlags, SlashCommandBuilder, type User } from "discord.js";
import { z } from "zod";
import type { Locale } from "../../config/constants.js";
import type { AnyCommand, CommandContext, ComponentHandler } from "../../core/contracts.js";
import { t } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import { getKV } from "../../infra/redis/client.js";
import type { KV } from "../../infra/redis/kv.js";
import { UserError } from "../../lib/errors.js";
import { assertOwner } from "../../ui/components/ownership.js";
import { createPaginator, type Paginator } from "../../ui/components/paginator.js";
import { createPanel } from "../../ui/components/panel.js";
import { truncate } from "../../ui/format.js";
import { getTimers } from "../summon/service.js";
import {
  getGuildBasics,
  getMemberSnapshot,
  getPantheonSummary,
  getTimersConfig,
  getTopPage,
  TOP_MODES,
  upgradeRelic,
  type RankRow,
  type TopMode,
} from "./extra.js";
import { parseRelicKey, RELIC_KEYS, type RelicKey } from "./relics.js";
import { claimDaily, ensureMember } from "./service.js";
import {
  dailyEmbed,
  ECONOMY_NS,
  orbUpText,
  pactUpText,
  parseTopMode,
  profileSections,
  relicButtons,
  relicsEmbed,
  relicUpgradedEmbed,
  rollsUpText,
  timersEmbed,
  TOP_PAGE_SIZE,
  topEmbed,
  topModeRow,
  tl,
} from "./views.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLASH_DESCRIPTION_MAX = 100;

/** Builder base com nome e descricao (pt-BR + en-US) vindos de `help.commands.*`. */
function slashBase(name: string, descriptionKey: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(truncate(t(descriptionKey, "pt-BR"), SLASH_DESCRIPTION_MAX))
    .setDescriptionLocalizations({
      "en-US": truncate(t(descriptionKey, "en-US"), SLASH_DESCRIPTION_MAX),
    });
}

function optionDescription(key: string): {
  description: string;
  localizations: { "pt-BR": string; "en-US": string };
} {
  const pt = truncate(tl(key, "pt-BR"), SLASH_DESCRIPTION_MAX);
  return {
    description: pt,
    localizations: { "pt-BR": pt, "en-US": truncate(tl(key, "en-US"), SLASH_DESCRIPTION_MAX) },
  };
}

/** Nome mostrado nas respostas: apelido no servidor, senao o nome global/usuario. */
export function displayName(ctx: Pick<CommandContext, "member" | "user">): string {
  return (
    ctx.member?.displayName?.trim() ||
    ctx.user.displayName?.trim() ||
    ctx.user.username?.trim() ||
    "Viajante"
  );
}

const SNOWFLAKE = /^\d{15,25}$/;

/** `<@123>`, `<@!123>` ou `123` -> id; qualquer outra coisa -> undefined. */
export function parseUserId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const mention = /^<@!?(\d{15,25})>$/.exec(raw);
  if (mention) return mention[1];
  return SNOWFLAKE.test(raw) ? raw : undefined;
}

async function loadTimers(ctx: CommandContext) {
  const cfg = await getTimersConfig(ctx.guildConfig);
  return getTimers(ctx.guild.id, ctx.user.id, cfg);
}

// ---------------------------------------------------------------------------
// Timers: $tu, $mu, $ru, $ku, /timers
// ---------------------------------------------------------------------------

export const timersCommand: AnyCommand = {
  name: "timers",
  aliases: ["tu", "timersup"],
  category: "economy",
  descriptionKey: "help.commands.timers",
  cooldownMs: 3_000,
  slash: () => slashBase("timers", "help.commands.timers"),
  async execute(ctx) {
    const timers = await loadTimers(ctx);
    await ctx.reply({
      embeds: [
        timersEmbed({
          timers,
          locale: ctx.locale,
          prefix: ctx.guildConfig.prefix,
          userName: displayName(ctx),
        }),
      ],
    });
  },
};

export const marryUpCommand: AnyCommand = {
  name: "marryup",
  aliases: ["mu"],
  category: "economy",
  descriptionKey: "help.commands.pact_up",
  cooldownMs: 2_000,
  async execute(ctx) {
    const timers = await loadTimers(ctx);
    await ctx.reply(pactUpText({ timers, locale: ctx.locale, userName: displayName(ctx) }));
  },
};

export const rollsUpCommand: AnyCommand = {
  name: "rollsup",
  aliases: ["ru", "rollsleft", "rolls"],
  category: "economy",
  descriptionKey: "help.commands.rolls_up",
  cooldownMs: 2_000,
  async execute(ctx) {
    const timers = await loadTimers(ctx);
    await ctx.reply(rollsUpText({ timers, locale: ctx.locale, userName: displayName(ctx) }));
  },
};

export const kakeraUpCommand: AnyCommand = {
  name: "kakeraup",
  aliases: ["ku"],
  category: "economy",
  descriptionKey: "help.commands.orb_up",
  cooldownMs: 2_000,
  async execute(ctx) {
    await ctx.reply(orbUpText({ locale: ctx.locale, userName: displayName(ctx) }));
  },
};

// ---------------------------------------------------------------------------
// Daily: $daily, $dk, $dailykakera, $diario, /daily
// ---------------------------------------------------------------------------

export const dailyCommand: AnyCommand = {
  name: "daily",
  aliases: ["dk", "dailykakera", "diario"],
  category: "economy",
  descriptionKey: "help.commands.daily",
  cooldownMs: 3_000,
  slash: () => slashBase("daily", "help.commands.daily"),
  async execute(ctx) {
    // O cooldown do daily (UserError `economy.daily_cooldown` com horario) vem do service.
    const result = await claimDaily(ctx.guild.id, ctx.user.id, {
      username: ctx.user.username,
      profile: { avatar: ctx.user.avatar, globalName: ctx.user.globalName },
    });
    await ctx.reply({
      embeds: [dailyEmbed({ result, baseRolls: ctx.guildConfig.baseRolls, locale: ctx.locale })],
    });
  },
};

// ---------------------------------------------------------------------------
// Perfil: $pr, $profile, $perfil, /profile [user]
// ---------------------------------------------------------------------------

const profileArgs = z.object({ userId: z.string().regex(SNOWFLAKE).optional() });

async function resolveTarget(ctx: CommandContext, id: string): Promise<User | null> {
  if (id === ctx.user.id) return ctx.user;
  const fromSlash = ctx.interaction?.options?.getUser?.("user");
  if (fromSlash?.id === id) return fromSlash;
  const fromMessage = ctx.message?.mentions?.users?.get(id);
  if (fromMessage) return fromMessage;
  return ctx.guild.client.users.fetch(id).catch(() => null);
}

export const profileCommand: AnyCommand = {
  name: "profile",
  aliases: ["pr", "perfil"],
  category: "economy",
  descriptionKey: "help.commands.profile",
  args: profileArgs,
  cooldownMs: 3_000,
  parseArgs: (tokens) => {
    if (tokens.length === 0) return {};
    const userId = parseUserId(tokens[0]);
    if (!userId) throw new UserError("errors.invalid_user");
    return { userId };
  },
  slash: () => {
    const option = optionDescription("economy.slash_user_option");
    return slashBase("profile", "help.commands.profile").addUserOption((o) =>
      o
        .setName("user")
        .setDescription(option.description)
        .setDescriptionLocalizations(option.localizations)
        .setRequired(false)
    );
  },
  slashArgs: (interaction) => ({ userId: interaction.options.getUser("user")?.id }),
  async execute(ctx: CommandContext<z.infer<typeof profileArgs>>) {
    const targetId = ctx.args.userId ?? ctx.user.id;
    const target = await resolveTarget(ctx as CommandContext, targetId);
    if (!target) throw new UserError("errors.invalid_user");

    // Quem consulta o proprio perfil entra no jogo (saldo de boas-vindas), como no legado.
    if (target.id === ctx.user.id) {
      await ensureMember(db, {
        guildId: ctx.guild.id,
        userId: target.id,
        username: target.username,
      });
    }

    const [member, pantheon] = await Promise.all([
      getMemberSnapshot(ctx.guild.id, target.id),
      getPantheonSummary(ctx.guild.id, target.id),
    ]);

    const panel = await createPanel({
      kv: await getKV(),
      ownerId: ctx.user.id,
      locale: ctx.locale,
      sections: profileSections({
        userName: target.displayName ?? target.username,
        avatarUrl: target.displayAvatarURL(),
        member,
        pantheon,
        locale: ctx.locale,
        prefix: ctx.guildConfig.prefix,
      }),
    });
    panel.attach(await ctx.reply(panel.payload));
  },
};

// ---------------------------------------------------------------------------
// Reliquias: $k, $kakera, $relics, $badge, $reliquias, /relics [relic]
// ---------------------------------------------------------------------------

const relicsArgs = z.object({ relic: z.enum(RELIC_KEYS).optional() });

export const relicsCommand: AnyCommand = {
  name: "relics",
  aliases: ["k", "kakera", "badge", "reliquias"],
  category: "economy",
  descriptionKey: "help.commands.relics",
  args: relicsArgs,
  cooldownMs: 2_000,
  parseArgs: (tokens) => {
    if (tokens.length === 0) return {};
    const text = tokens.join(" ");
    // Entrada desconhecida passa crua e e rejeitada pelo enum (errors.invalid_argument).
    return { relic: parseRelicKey(text) ?? text };
  },
  slash: () => {
    const option = optionDescription("economy.slash_relic_option");
    return slashBase("relics", "help.commands.relics").addStringOption((o) =>
      o
        .setName("relic")
        .setDescription(option.description)
        .setDescriptionLocalizations(option.localizations)
        .setRequired(false)
        .addChoices(
          ...RELIC_KEYS.map((key) => ({
            name: truncate(t(`economy.relic.${key}.name`, "pt-BR"), 100),
            name_localizations: {
              "pt-BR": truncate(t(`economy.relic.${key}.name`, "pt-BR"), 100),
              "en-US": truncate(t(`economy.relic.${key}.name`, "en-US"), 100),
            },
            value: key,
          }))
        )
    );
  },
  slashArgs: (interaction) => ({ relic: interaction.options.getString("relic") ?? undefined }),
  async execute(ctx: CommandContext<z.infer<typeof relicsArgs>>) {
    const guildId = ctx.guild.id;
    const userId = ctx.user.id;
    const { prefix } = ctx.guildConfig;

    if (ctx.args.relic) {
      const result = await upgradeRelic(guildId, userId, ctx.args.relic, {
        username: ctx.user.username,
        locale: ctx.locale,
        prefix,
      });
      await ctx.reply({
        embeds: [
          relicUpgradedEmbed({
            key: result.key,
            toLevel: result.toLevel,
            balance: result.balance,
            locale: ctx.locale,
          }),
        ],
      });
      return;
    }

    await ensureMember(db, { guildId, userId, username: ctx.user.username });
    const snapshot = await getMemberSnapshot(guildId, userId);
    await ctx.reply({
      embeds: [
        relicsEmbed({
          userName: displayName(ctx),
          balance: snapshot.balance,
          levels: snapshot.relics,
          locale: ctx.locale,
          prefix,
        }),
      ],
      components: relicButtons({
        levels: snapshot.relics,
        balance: snapshot.balance,
        ownerId: userId,
        locale: ctx.locale,
      }),
    });
  },
};

// ---------------------------------------------------------------------------
// Ranking: $top, $topserv, $ts, /top [mode]
// ---------------------------------------------------------------------------

const topArgs = z.object({ mode: z.enum(TOP_MODES).default("aether") });

/** Paginador do ranking (10 por pagina) com a linha de troca de criterio. */
export function buildTopPaginator(opts: {
  kv: KV;
  guildId: string;
  mode: TopMode;
  ownerId: string;
  locale: Locale;
}): Promise<Paginator> {
  const { kv, guildId, mode, ownerId, locale } = opts;
  return createPaginator<RankRow>({
    kv,
    ownerId,
    locale,
    pageSize: TOP_PAGE_SIZE,
    loader: async (page, pageSize) => {
      const result = await getTopPage(guildId, mode, page, pageSize);
      return { items: result.rows, total: result.total };
    },
    renderPage: (items, page, totalPages) => ({
      embeds: [topEmbed({ mode, rows: items, page, totalPages, locale })],
      components: [topModeRow({ mode, ownerId, locale })],
    }),
  });
}

export const topCommand: AnyCommand = {
  name: "top",
  aliases: ["topserv", "ts"],
  category: "economy",
  descriptionKey: "help.commands.topserv",
  args: topArgs,
  cooldownMs: 3_000,
  parseArgs: (tokens) => ({
    mode: tokens[0] === undefined ? undefined : (parseTopMode(tokens[0]) ?? tokens[0]),
  }),
  slash: () => {
    const option = optionDescription("economy.slash_top_mode_option");
    return slashBase("top", "help.commands.topserv").addStringOption((o) =>
      o
        .setName("mode")
        .setDescription(option.description)
        .setDescriptionLocalizations(option.localizations)
        .setRequired(false)
        .addChoices(
          {
            name: tl("economy.top_mode_aether", "pt-BR"),
            name_localizations: {
              "pt-BR": tl("economy.top_mode_aether", "pt-BR"),
              "en-US": tl("economy.top_mode_aether", "en-US"),
            },
            value: "aether",
          },
          {
            name: tl("economy.top_mode_pacts", "pt-BR"),
            name_localizations: {
              "pt-BR": tl("economy.top_mode_pacts", "pt-BR"),
              "en-US": tl("economy.top_mode_pacts", "en-US"),
            },
            value: "pacts",
          }
        )
    );
  },
  slashArgs: (interaction) => ({ mode: interaction.options.getString("mode") ?? undefined }),
  async execute(ctx: CommandContext<z.infer<typeof topArgs>>) {
    const paginator = await buildTopPaginator({
      kv: await getKV(),
      guildId: ctx.guild.id,
      mode: ctx.args.mode,
      ownerId: ctx.user.id,
      locale: ctx.locale,
    });
    paginator.attach(await ctx.reply(paginator.payload));
  },
};

// ---------------------------------------------------------------------------
// Componentes: botoes `ec:rl:<relic>:<ownerId>` e `ec:top:<mode>:<ownerId>`
// ---------------------------------------------------------------------------

/**
 * Sem estado em memoria nem no KV: tudo vem do customId e do banco, entao os botoes sobrevivem a
 * reinicios. Erros de dominio (UserError) sobem para o roteador, que responde de forma efemera.
 */
export const economyComponent: ComponentHandler = {
  namespace: ECONOMY_NS,
  async handle(interaction, parts) {
    const [kind, arg, ownerId] = parts;
    if (!interaction.isButton() || !interaction.guildId || !ownerId) return;
    const guildId = interaction.guildId;

    if (kind === "rl") {
      const key = RELIC_KEYS.find((k): k is RelicKey => k === arg);
      if (!key) return;
      const { prefix, locale } = await getGuildBasics(guildId);
      if (!(await assertOwner(interaction, ownerId, locale))) return;

      const result = await upgradeRelic(guildId, interaction.user.id, key, {
        username: interaction.user.username,
        locale,
        prefix,
      });
      await interaction.update({
        embeds: [
          relicsEmbed({
            userName:
              (interaction.member &&
              "displayName" in interaction.member &&
              typeof interaction.member.displayName === "string" &&
              interaction.member.displayName.trim()) ||
              interaction.user.displayName?.trim() ||
              interaction.user.username?.trim() ||
              "Viajante",
            balance: result.balance,
            levels: result.levels,
            locale,
            prefix,
          }),
        ],
        components: relicButtons({
          levels: result.levels,
          balance: result.balance,
          ownerId,
          locale,
        }),
      });
      await interaction.followUp({
        embeds: [
          relicUpgradedEmbed({
            key,
            toLevel: result.toLevel,
            balance: result.balance,
            locale,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (kind === "top") {
      const mode = parseTopMode(arg);
      if (!mode) return;
      const { locale } = await getGuildBasics(guildId);
      if (!(await assertOwner(interaction, ownerId, locale))) return;

      const paginator = await buildTopPaginator({
        kv: await getKV(),
        guildId,
        mode,
        ownerId,
        locale,
      });
      await interaction.update(paginator.payload);
      paginator.attach(interaction.message);
    }
  },
};
