/** Views do modulo ADMIN: respostas curtas em embed, sempre sem mencoes que notifiquem. */
import type { EmbedBuilder } from "discord.js";
import type { Locale } from "../../config/constants.js";
import { errorEmbed, successEmbed } from "../../ui/embeds.js";
import { msg } from "./messages.js";

export function setVipOkEmbed(locale: Locale, userId: string, tier: number): EmbedBuilder {
  return successEmbed({ description: msg(locale, "admin.setvip_ok", { userId, tier }), footer: false });
}

export function adminResetOkEmbed(locale: Locale, rolls: number, stacked: number): EmbedBuilder {
  return successEmbed({
    description: msg(locale, "admin.adminreset_ok", { rolls, stacked }),
    footer: false,
  });
}

export function cleanUserOkEmbed(locale: Locale, userId: string, count: number): EmbedBuilder {
  return successEmbed({
    description: msg(locale, "admin.cleanuser_ok", { userId, count }),
    footer: false,
  });
}

export function thanosOkEmbed(locale: Locale, count: number): EmbedBuilder {
  return successEmbed({ description: msg(locale, "admin.thanos_ok", { count }), footer: false });
}

export function cleanUserPrompt(locale: Locale, userId: string, count: number): string {
  return msg(locale, "admin.cleanuser_confirm", { userId, count });
}

export function thanosPrompt(locale: Locale, eligible: number): string {
  return msg(locale, "admin.thanos_confirm", { eligible });
}

export function usageError(locale: Locale, description: string) {
  return { embeds: [errorEmbed({ description, locale, footer: false })], ephemeral: true as const };
}
