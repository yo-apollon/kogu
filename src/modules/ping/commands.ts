/**
 * Comando de exemplo: `ping` (prefixo e slash). Mostra a latencia da mensagem/interacao e do gateway.
 *
 * TODO(i18n): os textos abaixo ficam locais porque `help.commands.ping` e as mensagens de pong
 * ainda nao existem em locales/*.json; mova-os quando o modulo `help` (F10) cuidar dos locales.
 */
import { SlashCommandBuilder } from "discord.js";
import type { Locale } from "../../config/constants.js";
import type { AnyCommand, CommandContext } from "../../core/contracts.js";
import { infoEmbed } from "../../ui/embeds.js";

const TEXT: Record<
  Locale,
  { title: string; message: string; gateway: string; description: string }
> = {
  "pt-BR": {
    title: "🏓 Pong!",
    message: "Latência da mensagem: **{ms} ms**",
    gateway: "Latência do gateway: **{ms} ms**",
    description: "Mostra a latência do bot.",
  },
  "en-US": {
    title: "🏓 Pong!",
    message: "Message latency: **{ms} ms**",
    gateway: "Gateway latency: **{ms} ms**",
    description: "Shows the bot latency.",
  },
};

function fill(template: string, ms: number): string {
  return template.replace("{ms}", String(ms));
}

export function measureLatency(
  ctx: CommandContext,
  now: number = Date.now()
): { message: number; gateway: number } {
  const createdAt = ctx.message?.createdTimestamp ?? ctx.interaction?.createdTimestamp ?? now;
  const client = ctx.message?.client ?? ctx.interaction?.client;
  const gateway = client?.ws.ping ?? -1;
  return { message: Math.max(0, now - createdAt), gateway: Math.max(0, Math.round(gateway)) };
}

export const pingCommand: AnyCommand = {
  name: "ping",
  category: "help",
  descriptionKey: "help.commands.ping",
  cooldownMs: 3_000,
  slash: () =>
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription(TEXT["pt-BR"].description)
      .setDescriptionLocalizations({ "en-US": TEXT["en-US"].description }),
  async execute(ctx) {
    const text = TEXT[ctx.locale];
    const latency = measureLatency(ctx);
    await ctx.reply({
      embeds: [
        infoEmbed({
          title: text.title,
          description: [
            fill(text.message, latency.message),
            fill(text.gateway, latency.gateway),
          ].join("\n"),
          icon: false,
        }),
      ],
    });
  },
};

export const pingCommands: AnyCommand[] = [pingCommand];
