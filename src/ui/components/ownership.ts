/** Ownership de componentes: so quem abriu a interface pode usa-la. */
import crypto from "node:crypto";
import { MessageFlags, type InteractionReplyOptions } from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { t } from "../../i18n/index.js";
import { errorEmbed } from "../embeds.js";

/** Subconjunto de uma Interaction do discord.js necessario aqui (facilita mocks). */
export interface OwnerCheckable {
  user: { id: string };
  replied?: boolean;
  deferred?: boolean;
  reply(options: InteractionReplyOptions): Promise<unknown>;
  followUp?(options: InteractionReplyOptions): Promise<unknown>;
}

/**
 * Retorna `true` se quem interagiu e o dono. Caso contrario responde de forma
 * ephemeral (so o intruso ve) e retorna `false`; o chamador deve parar.
 */
export async function assertOwner(
  interaction: OwnerCheckable,
  ownerId: string,
  locale: Locale = DEFAULT_LOCALE
): Promise<boolean> {
  if (interaction.user.id === ownerId) return true;
  const payload: InteractionReplyOptions = {
    embeds: [errorEmbed({ description: t("errors.not_owner", locale), footer: false })],
    flags: MessageFlags.Ephemeral,
  };
  try {
    if ((interaction.replied || interaction.deferred) && interaction.followUp) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Interacao ja respondida/expirada: nada a fazer, o acesso continua negado.
  }
  return false;
}

/** Identificador curto e seguro para customId (10 hex, sem ":"). */
export function newComponentId(): string {
  return crypto.randomBytes(5).toString("hex");
}

/** Namespaces de customId dos componentes genericos (roteados globalmente). */
export const PAGINATOR_NS = "pg";
export const PANEL_NS = "pn";
export const CONFIRM_NS = "cf";
