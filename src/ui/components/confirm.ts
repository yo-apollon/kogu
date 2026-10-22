/**
 * Confirmacao Sim/Nao.
 *
 * Escolha de design (a mais simples): `confirm()` devolve `Promise<boolean>` e o
 * resolvedor fica em um Map em memoria do processo. Nao usa KV: uma confirmacao
 * dura segundos e o comando que a pediu esta `await`-ando; se o processo reiniciar,
 * o comando morre junto. Cliques orfaos recebem aviso de expirado e os botoes sao
 * desabilitados. customIds: `cf:<id>:yes|no`, roteados por `handleConfirmInteraction`.
 *
 *   const ok = await confirm({ ownerId, locale, prompt: "Dissolver?", send: (p) => ctx.reply(p) });
 *   if (!ok) return;
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type APIEmbed,
  type ButtonInteraction,
  type EmbedBuilder,
} from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { t } from "../../i18n/index.js";
import { emoji } from "../emojis.js";
import { errorEmbed, warnEmbed } from "../embeds.js";
import { assertOwner, CONFIRM_NS, newComponentId } from "./ownership.js";
import { disableComponents, type AnyRow, type EditableMessage } from "./paginator.js";

export const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000;

export interface ConfirmPayload {
  content?: string;
  embeds: Array<EmbedBuilder | APIEmbed>;
  components: AnyRow[];
}

export interface ConfirmOptions {
  ownerId: string;
  locale?: Locale;
  /** Texto da pergunta (vira um warnEmbed). Ignorado se `embeds` for informado. */
  prompt?: string;
  embeds?: Array<EmbedBuilder | APIEmbed>;
  content?: string;
  yesLabel?: string;
  noLabel?: string;
  /** Botao "Sim" vermelho para acoes destrutivas. */
  danger?: boolean;
  timeoutMs?: number;
  /** Envia o payload e devolve a mensagem criada (ex.: `(p) => ctx.reply(p)`). */
  send(payload: ConfirmPayload): Promise<EditableMessage | void | undefined>;
}

interface Pending {
  ownerId: string;
  locale: Locale;
  resolve(value: boolean): void;
  message?: EditableMessage;
  rows: AnyRow[];
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

export function activeConfirmations(): number {
  return pending.size;
}

export async function confirm(options: ConfirmOptions): Promise<boolean> {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const id = newComponentId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_NS}:${id}:yes`)
      .setEmoji(emoji("success"))
      .setLabel(options.yesLabel ?? t("ui.confirm.yes", locale))
      .setStyle(options.danger ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${CONFIRM_NS}:${id}:no`)
      .setEmoji(emoji("error"))
      .setLabel(options.noLabel ?? t("ui.confirm.no", locale))
      .setStyle(ButtonStyle.Secondary)
  );

  const embeds = options.embeds ?? [
    warnEmbed(options.prompt ?? t("ui.confirm.default_prompt", locale)),
  ];

  return new Promise<boolean>((resolve) => {
    const entry: Pending = {
      ownerId: options.ownerId,
      locale,
      resolve,
      rows: [row],
      timer: setTimeout(() => void timeout(id), timeoutMs),
    };
    entry.timer.unref?.();
    pending.set(id, entry);

    options
      .send({ content: options.content, embeds, components: [row] })
      .then((message) => {
        if (message) entry.message = message;
      })
      .catch(() => settle(id, false));
  });
}

function settle(id: string, value: boolean): Pending | undefined {
  const entry = pending.get(id);
  if (!entry) return undefined;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.resolve(value);
  return entry;
}

async function timeout(id: string): Promise<void> {
  const entry = settle(id, false);
  if (entry?.message) {
    try {
      await entry.message.edit({ components: disableComponents(entry.rows) });
    } catch {
      // mensagem apagada ou sem permissao
    }
  }
}

/** Trata `cf:<id>:yes|no`. */
export async function handleConfirmInteraction(interaction: ButtonInteraction): Promise<void> {
  const [ns, id, action] = interaction.customId.split(":");
  if (ns !== CONFIRM_NS || !id || (action !== "yes" && action !== "no")) return;

  const entry = pending.get(id);
  if (!entry) {
    try {
      await interaction.update({ components: disableComponents(interaction.message.components) });
      await interaction.followUp({
        embeds: [
          errorEmbed({ description: t("ui.confirm.expired", DEFAULT_LOCALE), footer: false }),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // interacao ja respondida
    }
    return;
  }

  if (!(await assertOwner(interaction, entry.ownerId, entry.locale))) return;

  settle(id, action === "yes");
  await interaction.update({ components: disableComponents(entry.rows) });
}
