/**
 * Comandos do modulo ADMIN (prefixo + slash).
 *
 *   setvip     (owner)          $setvip @user <0-3>             (+ /setvip user tier)
 *   adminreset (owner)          -> godmode, resetme  [rolls]    (+ /adminreset [rolls])
 *   cleanuser  (Administrator)  -> userdivorce  @user           (+ /cleanuser user)
 *   thanos     (Administrator)                                  (+ /thanos)
 *
 * Mudanca deliberada (seguranca): no bot antigo `$setvip` e `$adminreset` bastavam a permissao
 * Administrator de qualquer servidor e gravavam VIP/rolls globais. Agora exigem OWNER_IDS
 * (`ownerOnly: true`, verificado no middleware de permissoes). Os comandos destrutivos de
 * moderacao (`cleanuser`, `thanos`) pedem confirmacao e rodam em transacao.
 */
import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { z } from "zod";
import type { AnyCommand, CommandContext, CommandDefinition } from "../../core/contracts.js";
import { t } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import { getKV } from "../../infra/redis/client.js";
import { confirm } from "../../ui/components/confirm.js";
import { truncate } from "../../ui/format.js";
import { msg } from "./messages.js";
import {
  ADMIN_RESET_MAX_ROLLS,
  MAX_VIP_TIER,
  MIN_VIP_TIER,
  countThanosCandidates,
  countUserPacts,
  createBitesTheDust,
  isValidVipTier,
  releaseUserPacts,
  restoreRolls,
  restoreUserHarem,
  setVipTier,
  snapThanos,
} from "./service.js";
import {
  adminResetOkEmbed,
  cleanUserOkEmbed,
  cleanUserPrompt,
  setVipOkEmbed,
  thanosOkEmbed,
  thanosPrompt,
  usageError,
} from "./views.js";

const SLASH_DESCRIPTION_MAX = 100;
const SNOWFLAKE = /^\d{15,25}$/;

const define = <S extends z.ZodTypeAny>(def: CommandDefinition<S>): AnyCommand =>
  def as unknown as AnyCommand;

/** `<@123>`, `<@!123>` ou `123` -> id; qualquer outra coisa -> undefined. */
export function parseUserId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const mention = /^<@!?(\d{15,25})>$/.exec(raw);
  if (mention) return mention[1];
  return SNOWFLAKE.test(raw) ? raw : undefined;
}

function slashBase(
  name: string,
  descriptionKey: string,
  fallback: { pt: string; en: string },
  permission: bigint = PermissionFlagsBits.Administrator
) {
  const text = (lang: "pt-BR" | "en-US", alt: string) => {
    const translated = t(descriptionKey, lang);
    return truncate(translated === descriptionKey ? alt : translated, SLASH_DESCRIPTION_MAX);
  };
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(text("pt-BR", fallback.pt))
    .setDescriptionLocalizations({ "en-US": text("en-US", fallback.en) })
    .setDefaultMemberPermissions(permission)
    .setContexts(InteractionContextType.Guild);
}

const USER_OPTION = { pt: "Usuário alvo", en: "Target user" };

function targetUsername(ctx: CommandContext, userId: string): string | undefined {
  return (
    ctx.message?.mentions?.users?.get(userId)?.username ??
    ctx.interaction?.options.getUser("user")?.username ??
    undefined
  );
}

/* ------------------------------------------------------------------ */
/* $setvip (somente OWNER_IDS)                                        */
/* ------------------------------------------------------------------ */

export const setVipCommand: AnyCommand = define({
  name: "setvip",
  category: "admin",
  descriptionKey: "help.commands.setvip",
  ownerOnly: true,
  args: z.object({ userId: z.string().default(""), tier: z.string().default("") }),
  parseArgs: (tokens) => ({ userId: parseUserId(tokens[0]) ?? "", tier: tokens[1] ?? "" }),
  cooldownMs: 3_000,
  slash: () =>
    slashBase("setvip", "help.commands.setvip", {
      pt: "Define o nível VIP de um membro (dono do bot).",
      en: "Sets a member's VIP tier (bot owner).",
    })
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription(USER_OPTION.pt)
          .setDescriptionLocalizations({ "en-US": USER_OPTION.en })
          .setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("tier")
          .setDescription("0 = Normal, 1 = Booster, 2 = VIP Nobre, 3 = Divindade")
          .setDescriptionLocalizations({
            "en-US": "0 = Normal, 1 = Booster, 2 = Noble VIP, 3 = Divinity",
          })
          .setMinValue(MIN_VIP_TIER)
          .setMaxValue(MAX_VIP_TIER)
          .setRequired(true)
      ),
  slashArgs: (i) => ({
    userId: i.options.getUser("user", true).id,
    tier: String(i.options.getInteger("tier", true)),
  }),
  async execute(ctx) {
    const { userId, tier: rawTier } = ctx.args;
    const tier = /^\d+$/.test(rawTier) ? Number(rawTier) : Number.NaN;
    if (!SNOWFLAKE.test(userId) || !isValidVipTier(tier)) {
      await ctx.reply(
        usageError(ctx.locale, msg(ctx.locale, "admin.setvip_usage", { prefix: ctx.guildConfig.prefix }))
      );
      return;
    }
    await setVipTier(db, { id: userId, username: targetUsername(ctx, userId) }, tier);
    await ctx.reply({ embeds: [setVipOkEmbed(ctx.locale, userId, tier)], ephemeral: true });
  },
});

/* ------------------------------------------------------------------ */
/* $adminreset / $godmode / $resetme (somente OWNER_IDS)              */
/* ------------------------------------------------------------------ */

export const adminResetCommand: AnyCommand = define({
  name: "adminreset",
  aliases: ["godmode", "resetme"],
  category: "admin",
  descriptionKey: "help.commands.adminreset",
  ownerOnly: true,
  args: z.object({ rolls: z.string().default("") }),
  parseArgs: (tokens) => ({ rolls: tokens[0] ?? "" }),
  cooldownMs: 3_000,
  slash: () =>
    slashBase("adminreset", "help.commands.adminreset", {
      pt: "Restaura seus rolls para testes (dono do bot).",
      en: "Restores your rolls for testing (bot owner).",
    }).addIntegerOption((o) =>
      o
        .setName("rolls")
        .setDescription("Rolls disponíveis após o reset (padrão: o limite do servidor)")
        .setDescriptionLocalizations({
          "en-US": "Rolls available after the reset (default: the server limit)",
        })
        .setMinValue(0)
        .setMaxValue(ADMIN_RESET_MAX_ROLLS)
    ),
  slashArgs: (i) => ({ rolls: String(i.options.getInteger("rolls") ?? "") }),
  async execute(ctx) {
    const cfg = ctx.guildConfig;
    let rolls = cfg.baseRolls;
    if (ctx.args.rolls !== "") {
      const parsed = /^\d+$/.test(ctx.args.rolls) ? Number(ctx.args.rolls) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed > ADMIN_RESET_MAX_ROLLS) {
        await ctx.reply(
          usageError(
            ctx.locale,
            t("errors.invalid_number_range", ctx.locale, { min: 0, max: ADMIN_RESET_MAX_ROLLS })
          )
        );
        return;
      }
      rolls = parsed;
    }
    const result = await restoreRolls(db, {
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      username: ctx.user.username,
      baseRolls: cfg.baseRolls,
      rollIntervalMin: cfg.rollIntervalMin,
      resetOffsetMin: cfg.resetOffsetMin,
      claimIntervalMin: cfg.claimIntervalMin,
      rolls,
    });
    await ctx.reply({
      embeds: [adminResetOkEmbed(ctx.locale, result.rolls, result.stacked)],
      ephemeral: true,
    });
  },
});

/* ------------------------------------------------------------------ */
/* $cleanuser / $userdivorce (Administrator + confirmacao)            */
/* ------------------------------------------------------------------ */

export const cleanUserCommand: AnyCommand = define({
  name: "cleanuser",
  aliases: ["userdivorce"],
  category: "admin",
  descriptionKey: "help.commands.cleanuser",
  permissions: PermissionFlagsBits.Administrator,
  args: z.object({ userId: z.string().default("") }),
  parseArgs: (tokens) => ({ userId: parseUserId(tokens[0]) ?? "" }),
  cooldownMs: 5_000,
  slash: () =>
    slashBase("cleanuser", "help.commands.cleanuser", {
      pt: "Libera todos os pactos de um usuário (staff).",
      en: "Releases every pact of a user (staff).",
    }).addUserOption((o) =>
      o
        .setName("user")
        .setDescription(USER_OPTION.pt)
        .setDescriptionLocalizations({ "en-US": USER_OPTION.en })
        .setRequired(true)
    ),
  slashArgs: (i) => ({ userId: i.options.getUser("user", true).id }),
  async execute(ctx) {
    const { userId } = ctx.args;
    if (!SNOWFLAKE.test(userId)) {
      await ctx.reply(
        usageError(ctx.locale, msg(ctx.locale, "admin.cleanuser_usage", { prefix: ctx.guildConfig.prefix }))
      );
      return;
    }
    const count = await countUserPacts(db, ctx.guild.id, userId);
    if (count === 0) {
      await ctx.reply({ embeds: [cleanUserOkEmbed(ctx.locale, userId, 0)] });
      return;
    }
    const confirmed = await confirm({
      ownerId: ctx.user.id,
      locale: ctx.locale,
      danger: true,
      prompt: cleanUserPrompt(ctx.locale, userId, count),
      send: (payload) => ctx.reply(payload),
    });
    if (!confirmed) {
      await ctx.followUp({ content: t("ui.confirm.cancelled", ctx.locale) });
      return;
    }
    const released = await releaseUserPacts(db, ctx.guild.id, userId);
    await ctx.followUp({ embeds: [cleanUserOkEmbed(ctx.locale, userId, released)] });
  },
});

/* ------------------------------------------------------------------ */
/* $thanos (Administrator + confirmacao)                              */
/* ------------------------------------------------------------------ */

export const thanosCommand: AnyCommand = define({
  name: "thanos",
  category: "admin",
  descriptionKey: "help.commands.thanos",
  permissions: PermissionFlagsBits.Administrator,
  cooldownMs: 30_000,
  slash: () =>
    slashBase("thanos", "help.commands.thanos", {
      pt: "Dissolve metade das entidades sem Selos (staff).",
      en: "Dissolves half of the entities without Seals (staff).",
    }),
  async execute(ctx) {
    const eligible = await countThanosCandidates(db, ctx.guild.id);
    if (eligible === 0) {
      await ctx.reply({ content: msg(ctx.locale, "admin.thanos_nothing") });
      return;
    }
    const confirmed = await confirm({
      ownerId: ctx.user.id,
      locale: ctx.locale,
      danger: true,
      prompt: thanosPrompt(ctx.locale, eligible),
      send: (payload) => ctx.reply(payload),
    });
    if (!confirmed) {
      await ctx.followUp({ content: t("ui.confirm.cancelled", ctx.locale) });
      return;
    }
    const result = await snapThanos(db, ctx.guild.id);
    await ctx.followUp({ embeds: [thanosOkEmbed(ctx.locale, result.removed)] });
  },
});

export const bitesTheDustCommand: AnyCommand = define({
  name: "bitesthedust",
  aliases: ["btd"],
  category: "admin",
  descriptionKey: "help.commands.thanos",
  permissions: PermissionFlagsBits.Administrator,
  cooldownMs: 60_000,
  slash: () =>
    slashBase("bitesthedust", "help.commands.thanos", {
      pt: "Reseta o servidor criando um backup seguro e criptografado.",
      en: "Resets the server creating a secure encrypted backup.",
    }),
  async execute(ctx) {
    const p = ctx.guildConfig.prefix;
    const confirmed = await confirm({
      ownerId: ctx.user.id,
      locale: ctx.locale,
      danger: true,
      prompt:
        `⚠️ **AVISO CRÍTICO — BITES THE DUST**\n\n` +
        `Você está prestes a **REINICIAR TODOS OS PACTOS E CASAMENTOS** deste servidor!\n\n` +
        `🔒 **Proteção Total:** Um snapshot completo de backup será gravado na nuvem e poderá ser restaurado a qualquer momento com \`${p}restore @usuario\`.\n\n` +
        `Deseja ativar o Bites the Dust e retornar ao tempo zero?`,
      send: (payload) => ctx.reply(payload),
    });

    if (!confirmed) {
      await ctx.followUp({ content: t("ui.confirm.cancelled", ctx.locale) });
      return;
    }

    const res = await createBitesTheDust(db, ctx.guild.id);
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle("⏳ BITES THE DUST ATIVADO COM SUCESSO!")
      .setDescription(
        `O tempo deste servidor foi reiniciado. **${res.totalPacts}** cartas foram liberadas ao vácuo dimensional!\n\n` +
          `📦 **Snapshot de Restauração Criado:**\n\`${res.snapshotId}\`\n\n` +
          `Para devolver o harém de um jogador específico a qualquer momento:\n` +
          `\`${p}restore @usuario\` (ou \`${p}restore @usuario ${res.snapshotId}\`)`
      );

    await ctx.followUp({ embeds: [embed] });
  },
});

const restoreArgs = z.object({
  user: z.string().optional(),
  snapshotId: z.string().optional(),
});

export const restoreCommand: AnyCommand = define({
  name: "restore",
  aliases: ["restaurar", "restorerecover"],
  category: "admin",
  descriptionKey: "help.commands.thanos",
  permissions: PermissionFlagsBits.Administrator,
  args: restoreArgs,
  cooldownMs: 5_000,
  parseArgs: (tokens) => {
    if (tokens.length === 0) return {};
    const userId = parseUserId(tokens[0]);
    const snapshotId = tokens.length > 1 ? tokens[1] : undefined;
    return { user: userId, snapshotId };
  },
  async execute(ctx) {
    const p = ctx.guildConfig.prefix;
    const targetId = ctx.args.user;
    if (!targetId) {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle("🔄 Como Restaurar Cartas ($restore)")
            .setDescription(
              `Restaura as cartas de um jogador que foram salvas antes de um \`${p}btd\`:\n\n` +
                `▸ Uso: \`${p}restore @usuario\` (restaura do último backup gravado)\n` +
                `▸ Uso com ID específico: \`${p}restore @usuario <snapshot_id>\`\n\n` +
                `Digite \`${p}restorelist\` para visualizar os backups disponíveis.`
            ),
        ],
      });
      return;
    }

    try {
      const res = await restoreUserHarem(db, ctx.guild.id, targetId, ctx.args.snapshotId);
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle("✅ Harém Restaurado com Sucesso!")
            .setDescription(
              `Foram devolvidas **${res.restoredCount}** cartas para <@${targetId}> a partir do backup:\n` +
                `\`${res.snapshotId}\``
            ),
        ],
      });
    } catch {
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setTitle("⚠️ Falha na Restauração")
            .setDescription(`Nenhum snapshot de backup encontrado ou usuário sem cartas no registro.`),
        ],
      });
    }
  },
});

export const restoreListCommand: AnyCommand = define({
  name: "restorelist",
  aliases: ["backuplist", "snapshots"],
  category: "admin",
  descriptionKey: "help.commands.thanos",
  permissions: PermissionFlagsBits.Administrator,
  cooldownMs: 5_000,
  async execute(ctx) {
    const kv = await getKV();
    const latest = await kv.get(`btd_latest:${ctx.guild.id}`);
    const p = ctx.guildConfig.prefix;

    const embed = new EmbedBuilder()
      .setColor(0x3b82f6)
      .setTitle("📦 Snapshots de Restauração — Kogu")
      .setDescription(
        latest
          ? `Último backup registrado deste servidor:\n` +
              `▸ **ID:** \`${latest}\`\n\n` +
              `Para restaurar um jogador deste backup:\n\`${p}restore @usuario ${latest}\``
          : `Nenhum snapshot do \`${p}bitesthedust\` foi realizado recentemente neste servidor.`
      );

    await ctx.reply({ embeds: [embed] });
  },
});

export const adminCommands: AnyCommand[] = [
  setVipCommand,
  adminResetCommand,
  cleanUserCommand,
  thanosCommand,
  bitesTheDustCommand,
  restoreCommand,
  restoreListCommand,
];
