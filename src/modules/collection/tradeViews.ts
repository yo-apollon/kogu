/**
 * Componentes visuais e gerenciamento de sessao da Troca ($trade).
 *
 * Namespace de customId: `tr`
 * Sub-acoes:
 * - `tr:pick_user:<pickerId>`
 * - `tr:sel_init:<sessionId>`
 * - `tr:sel_tgt:<sessionId>`
 * - `tr:pg_prev:<sessionId>`
 * - `tr:pg_next:<sessionId>`
 * - `tr:accept:<sessionId>`
 * - `tr:cancel:<sessionId>`
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type Message,
  type MessageComponentInteraction,
} from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import type { ComponentHandler } from "../../core/contracts.js";
import { encodeCustomId } from "../../core/customId.js";
import { t } from "../../i18n/index.js";
import { UserError } from "../../lib/errors.js";
import { errorEmbed } from "../../ui/embeds.js";
import { escapeMarkdown, formatNumber, truncate } from "../../ui/format.js";
import { newComponentId } from "../../ui/components/ownership.js";
import {
  executeTrade,
  getPactForTrade,
  getTradePactsPage,
  type ExecuteTradeResult,
  type TradePactInfo,
} from "./tradeService.js";

export const TRADE_NAMESPACE = "tr";
export { type TradePactInfo } from "./tradeService.js";
export const TRADE_TIMEOUT_MS = 90_000;

export interface TradeParty {
  id: string;
  username: string;
  pact: TradePactInfo | null;
  page: number;
  accepted: boolean;
}

export interface TradeSession {
  id: string;
  guildId: string;
  channelId: string;
  userA: TradeParty;
  userB: TradeParty;
  locale: Locale;
  expiresAt: number;
  message?: Message;
  timeoutTimer: NodeJS.Timeout;
}

export interface TradeDeps {
  getPactsPage: typeof getTradePactsPage;
  getPact: typeof getPactForTrade;
  execute: typeof executeTrade;
}

export const defaultTradeDeps: TradeDeps = {
  getPactsPage: getTradePactsPage,
  getPact: getPactForTrade,
  execute: executeTrade,
};

let tradeDeps: TradeDeps = defaultTradeDeps;

export function setTradeDepsForTest(deps: Partial<TradeDeps> | null): void {
  tradeDeps = deps ? { ...defaultTradeDeps, ...deps } : defaultTradeDeps;
}

/** Sessoes ativas em memoria indexadas pelo id curto da sessao. */
export const activeTradeSessions = new Map<string, TradeSession>();

/** Encerra e remove uma sessao ativa. */
export function removeTradeSession(sessionId: string): void {
  const session = activeTradeSessions.get(sessionId);
  if (session) {
    clearTimeout(session.timeoutTimer);
    activeTradeSessions.delete(sessionId);
  }
}

/** Cria uma nova sessao de troca com timeout de 90 segundos. */
export function createTradeSession(input: {
  guildId: string;
  channelId: string;
  userA: { id: string; username: string; pact?: TradePactInfo | null; accepted?: boolean };
  userB: { id: string; username: string; pact?: TradePactInfo | null; accepted?: boolean };
  locale: Locale;
}): TradeSession {
  const id = newComponentId();
  const session: TradeSession = {
    id,
    guildId: input.guildId,
    channelId: input.channelId,
    userA: {
      id: input.userA.id,
      username: input.userA.username,
      pact: input.userA.pact ?? null,
      page: 1,
      accepted: input.userA.accepted ?? false,
    },
    userB: {
      id: input.userB.id,
      username: input.userB.username,
      pact: input.userB.pact ?? null,
      page: 1,
      accepted: input.userB.accepted ?? false,
    },
    locale: input.locale,
    expiresAt: Date.now() + TRADE_TIMEOUT_MS,
    timeoutTimer: setTimeout(async () => {
      activeTradeSessions.delete(id);
      try {
        if (session.message) {
          await session.message.edit({
            embeds: [buildTradeExpiredEmbed(session)],
            components: [],
          });
        }
      } catch {
        // Mensagem pode ter sido deletada
      }
    }, TRADE_TIMEOUT_MS),
  };

  activeTradeSessions.set(id, session);
  return session;
}

/**
 * Constroi o embed visual da sessao de troca mostrando o status de cada parte.
 */
export function buildTradeEmbed(session: TradeSession): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🤝 Mesa de Negociação")
    .setColor(0x3b82f6)
    .setTimestamp();

  const initPactText = session.userA.pact
    ? `✨ **${session.userA.pact.name}**${
        session.userA.pact.variant !== "COMMON" ? ` *(${session.userA.pact.variant})*` : ""
      }\n> 📚 *${session.userA.pact.series ?? "Série Desconhecida"}*\n> 💰 **${formatNumber(
        session.userA.pact.value,
        session.locale
      )} Éter**`
    : `*Nenhuma carta selecionada*`;

  const initStatus = session.userA.accepted
    ? "✅ **Pronto para Trocar**"
    : "⏳ *Aguardando confirmação...*";

  const tgtPactText = session.userB.pact
    ? `✨ **${session.userB.pact.name}**${
        session.userB.pact.variant !== "COMMON" ? ` *(${session.userB.pact.variant})*` : ""
      }\n> 📚 *${session.userB.pact.series ?? "Série Desconhecida"}*\n> 💰 **${formatNumber(
        session.userB.pact.value,
        session.locale
      )} Éter**`
    : `*Nenhuma carta selecionada*`;

  const tgtStatus = session.userB.accepted
    ? "✅ **Pronto para Trocar**"
    : "⏳ *Aguardando confirmação...*";

  embed.addFields(
    {
      name: `📤 Oferta de ${escapeMarkdown(session.userA.username)}`,
      value: `${initPactText}\n\n**Status:** ${initStatus}`,
      inline: true,
    },
    {
      name: `📥 Oferta de ${escapeMarkdown(session.userB.username)}`,
      value: `${tgtPactText}\n\n**Status:** ${tgtStatus}`,
      inline: true,
    }
  );

  embed.setFooter({
    text: `Kogu ᛫ Expira em 90s ᛫ Ambos precisam confirmar`,
  });

  return embed;
}

export function buildTradeSuccessEmbed(
  session: TradeSession,
  _result: ExecuteTradeResult
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🎉 Troca Realizada com Sucesso!")
    .setColor(0x10b981)
    .setTimestamp();

  let desc = `A negociação entre **${escapeMarkdown(
    session.userA.username
  )}** e **${escapeMarkdown(session.userB.username)}** foi concluída!\n\n`;

  if (session.userA.pact) {
    desc += `📤 **${escapeMarkdown(session.userA.username)}** transferiu **${
      session.userA.pact.name
    }** para **${escapeMarkdown(session.userB.username)}**!\n`;
  }
  if (session.userB.pact) {
    desc += `📥 **${escapeMarkdown(session.userB.username)}** transferiu **${
      session.userB.pact.name
    }** para **${escapeMarkdown(session.userA.username)}**!\n`;
  }

  embed.setDescription(desc);
  return embed;
}

export function buildTradeCancelledEmbed(session: TradeSession, byUsername: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("❌ Troca Cancelada")
    .setColor(0xef4444)
    .setDescription(`A negociação foi cancelada por **${escapeMarkdown(byUsername)}**.`)
    .setTimestamp();
}

export function buildTradeExpiredEmbed(session: TradeSession): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("⏳ Troca Expirada")
    .setColor(0x6b7280)
    .setDescription(
      `O tempo limite de 90 segundos expirou sem que a troca entre **${escapeMarkdown(
        session.userA.username
      )}** e **${escapeMarkdown(session.userB.username)}** fosse confirmada.`
    )
    .setTimestamp();
}

/**
 * Cria os componentes interativos do Discord (Select Menus e Botões) para a sessão.
 */
export async function buildTradeComponents(
  session: TradeSession
): Promise<ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[]> {
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  const [pactsA, pactsB] = await Promise.all([
    tradeDeps.getPactsPage(session.guildId, session.userA.id, session.userA.page, 25),
    tradeDeps.getPactsPage(session.guildId, session.userB.id, session.userB.page, 25),
  ]);

  // Menu de seleção para o Usuário A
  if (pactsA.items.length > 0) {
    const optionsA = pactsA.items.map((pact) => ({
      label: truncate(
        `${pact.name}${pact.variant !== "COMMON" ? ` (${pact.variant})` : ""}`,
        100
      ),
      description: truncate(
        `${pact.series ?? "Sem Série"} ᛫ ${formatNumber(pact.value, session.locale)} Éter`,
        100
      ),
      value: String(pact.pactId),
      default: session.userA.pact?.pactId === pact.pactId,
    }));

    if (session.userA.pact) {
      optionsA.unshift({
        label: "❌ Remover seleção (Não ofertar nada)",
        description: "Limpa a sua oferta atual",
        value: "none",
        default: false,
      });
    }

    const selectA = new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId(TRADE_NAMESPACE, "sel_init", session.id))
      .setPlaceholder(
        truncate(`📤 Carta de ${session.userA.username} (Pág. ${pactsA.page}/${pactsA.totalPages})`, 100)
      )
      .addOptions(optionsA);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectA));
  }

  // Menu de seleção para o Usuário B
  if (pactsB.items.length > 0) {
    const optionsB = pactsB.items.map((pact) => ({
      label: truncate(
        `${pact.name}${pact.variant !== "COMMON" ? ` (${pact.variant})` : ""}`,
        100
      ),
      description: truncate(
        `${pact.series ?? "Sem Série"} ᛫ ${formatNumber(pact.value, session.locale)} Éter`,
        100
      ),
      value: String(pact.pactId),
      default: session.userB.pact?.pactId === pact.pactId,
    }));

    if (session.userB.pact) {
      optionsB.unshift({
        label: "❌ Remover seleção (Não ofertar nada)",
        description: "Limpa a sua oferta atual",
        value: "none",
        default: false,
      });
    }

    const selectB = new StringSelectMenuBuilder()
      .setCustomId(encodeCustomId(TRADE_NAMESPACE, "sel_tgt", session.id))
      .setPlaceholder(
        truncate(`📥 Carta de ${session.userB.username} (Pág. ${pactsB.page}/${pactsB.totalPages})`, 100)
      )
      .addOptions(optionsB);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectB));
  }

  // Linha de Paginação se algum dos jogadores tiver mais de 1 página
  if (pactsA.totalPages > 1 || pactsB.totalPages > 1) {
    const paginationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(TRADE_NAMESPACE, "pg_prev", session.id))
        .setLabel("◀️ Página Anterior")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(TRADE_NAMESPACE, "pg_info", session.id))
        .setLabel("Navegar Coleção")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(TRADE_NAMESPACE, "pg_next", session.id))
        .setLabel("Próxima Página ▶️")
        .setStyle(ButtonStyle.Secondary)
    );
    rows.push(paginationRow);
  }

  // Linha de Ação: Confirmar e Cancelar
  const canConfirm = session.userA.pact !== null || session.userB.pact !== null;
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId(TRADE_NAMESPACE, "accept", session.id))
      .setLabel("✅ Confirmar Troca")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canConfirm),
    new ButtonBuilder()
      .setCustomId(encodeCustomId(TRADE_NAMESPACE, "cancel", session.id))
      .setLabel("❌ Cancelar")
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(actionRow);
  return rows;
}

/**
 * Cria o menu de seleção de membro para quando o comando $trade e executado sem argumentos.
 */
export function buildPickUserComponents(pickerId: string, locale: Locale): ActionRowBuilder<UserSelectMenuBuilder> {
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(encodeCustomId(TRADE_NAMESPACE, "pick_user", pickerId))
    .setPlaceholder(truncate(t("collection.trade_pick_user_placeholder", locale), 100))
    .setMinValues(1)
    .setMaxValues(1);

  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect);
}

/**
 * Manipulador global de interacoes do namespace `tr` (Troca).
 */
export const tradeComponent: ComponentHandler = {
  namespace: TRADE_NAMESPACE,

  async handle(interaction: MessageComponentInteraction, parts: string[]): Promise<void> {
    const action = parts[0];
    const sessionId = parts[1];

    // 1. Selecao inicial de membro atraves do UserSelectMenu ($trade sem mencao)
    if (action === "pick_user" && interaction.isUserSelectMenu()) {
      const pickerId = sessionId;
      if (interaction.user.id !== pickerId) {
        await interaction.reply({
          embeds: [
            errorEmbed({
              description: t("collection.trade_not_participant", DEFAULT_LOCALE),
              footer: false,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetUser = interaction.users.first();
      if (!targetUser) return;

      if (targetUser.bot) {
        await interaction.reply({
          embeds: [
            errorEmbed({
              description: t("collection.trade_bot", DEFAULT_LOCALE),
              footer: false,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (targetUser.id === interaction.user.id) {
        await interaction.reply({
          embeds: [
            errorEmbed({
              description: t("collection.trade_self", DEFAULT_LOCALE),
              footer: false,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!interaction.guildId) return;

      const session = createTradeSession({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userA: {
          id: interaction.user.id,
          username: interaction.user.displayName || interaction.user.username,
        },
        userB: {
          id: targetUser.id,
          username: targetUser.displayName || targetUser.username,
        },
        locale: DEFAULT_LOCALE,
      });

      const components = await buildTradeComponents(session);
      await interaction.update({
        embeds: [buildTradeEmbed(session)],
        components,
      });
      return;
    }

    // Para todas as outras acoes, precisa de uma sessao ativa
    const session = activeTradeSessions.get(sessionId);
    if (!session) {
      await interaction.reply({
        embeds: [
          errorEmbed({
            description: t("collection.trade_expired", DEFAULT_LOCALE),
            footer: false,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Apenas participantes da troca podem interagir
    const isUserA = interaction.user.id === session.userA.id;
    const isUserB = interaction.user.id === session.userB.id;
    if (!isUserA && !isUserB) {
      await interaction.reply({
        embeds: [
          errorEmbed({
            description: t("collection.trade_not_participant", session.locale),
            footer: false,
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Cancelar
    if (action === "cancel") {
      removeTradeSession(session.id);
      const byName = interaction.user.displayName || interaction.user.username;
      await interaction.update({
        embeds: [buildTradeCancelledEmbed(session, byName)],
        components: [],
      });
      return;
    }

    // 3. Selecao de carta do Usuario A
    if (action === "sel_init" && interaction.isStringSelectMenu()) {
      if (!isUserA) {
        await interaction.reply({
          embeds: [
            errorEmbed({
              description: t("collection.trade_only_owner_select", session.locale),
              footer: false,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const val = interaction.values[0];
      if (val === "none") {
        session.userA.pact = null;
      } else {
        const pactId = Number(val);
        session.userA.pact = await tradeDeps.getPact(session.guildId, session.userA.id, pactId);
      }

      // Regra de seguranca anti-bait-and-switch: qualquer alteracao reseta o aceite de ambos
      session.userA.accepted = false;
      session.userB.accepted = false;

      const components = await buildTradeComponents(session);
      await interaction.update({
        embeds: [buildTradeEmbed(session)],
        components,
      });
      return;
    }

    // 4. Selecao de carta do Usuario B
    if (action === "sel_tgt" && interaction.isStringSelectMenu()) {
      if (!isUserB) {
        await interaction.reply({
          embeds: [
            errorEmbed({
              description: t("collection.trade_only_owner_select", session.locale),
              footer: false,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const val = interaction.values[0];
      if (val === "none") {
        session.userB.pact = null;
      } else {
        const pactId = Number(val);
        session.userB.pact = await tradeDeps.getPact(session.guildId, session.userB.id, pactId);
      }

      // Anti-bait-and-switch
      session.userA.accepted = false;
      session.userB.accepted = false;

      const components = await buildTradeComponents(session);
      await interaction.update({
        embeds: [buildTradeEmbed(session)],
        components,
      });
      return;
    }

    // 5. Paginacao da colecao
    if (action === "pg_prev" || action === "pg_next") {
      const delta = action === "pg_next" ? 1 : -1;
      if (isUserA) {
        session.userA.page = Math.max(1, session.userA.page + delta);
      } else if (isUserB) {
        session.userB.page = Math.max(1, session.userB.page + delta);
      }

      const components = await buildTradeComponents(session);
      await interaction.update({
        embeds: [buildTradeEmbed(session)],
        components,
      });
      return;
    }

    // 6. Aceitar / Confirmar
    if (action === "accept") {
      if (isUserA) {
        session.userA.accepted = true;
      }
      if (isUserB) {
        session.userB.accepted = true;
      }

      // Se ambos aceitaram, executa a troca!
      if (session.userA.accepted && session.userB.accepted) {
        removeTradeSession(session.id);
        try {
          const result = await tradeDeps.execute({
            guildId: session.guildId,
            userA: {
              id: session.userA.id,
              username: session.userA.username,
              pactId: session.userA.pact?.pactId ?? null,
            },
            userB: {
              id: session.userB.id,
              username: session.userB.username,
              pactId: session.userB.pact?.pactId ?? null,
            },
          });

          await interaction.update({
            embeds: [buildTradeSuccessEmbed(session, result)],
            components: [],
          });
        } catch (err) {
          const description =
            err instanceof UserError
              ? t(err.key, session.locale, err.params)
              : t("common.error", session.locale);

          await interaction.update({
            embeds: [errorEmbed({ description, footer: false })],
            components: [],
          });
        }
        return;
      }

      // Senao, apenas atualiza o status de aceite
      const components = await buildTradeComponents(session);
      await interaction.update({
        embeds: [buildTradeEmbed(session)],
        components,
      });
    }
  },
};
