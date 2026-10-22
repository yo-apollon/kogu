import { Message, EmbedBuilder } from "discord.js";
import { db } from "../database/index.js";
import { guildProfiles, guilds } from "../database/schema.js";
import { eq, and } from "drizzle-orm";

export async function handleTimersCommand(message: Message, guildData: any, commandName: string = "tu") {
  const guildId = message.guildId!;
  const userId = message.author.id;

  const profile = await db.query.guildProfiles.findFirst({
    where: and(eq(guildProfiles.guildId, guildId), eq(guildProfiles.userId, userId)),
  });

  const baseRolls = guildData?.baseRolls || 10;
  const rollsLeft = profile ? profile.rollsRemaining : baseRolls;
  const pactsLeft = profile ? profile.pactsAvailable : 1;
  const stackedRolls = profile ? profile.stackedRolls : 0;

  // Calcula tempo para o próximo reset de hora
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  const diffMinutes = Math.max(1, Math.round((nextHour.getTime() - now.getTime()) / 60000));

  // 1. $mu (Marry Up / Pact Up) — Resposta direta rápida igual ao Mudae
  if (commandName === "mu" || commandName === "marryup") {
    if (pactsLeft > 0) {
      return message.reply(`✅ **${message.author.username}**, você **pode firmar um Pacto agora**!`);
    } else {
      return message.reply(`⏳ **${message.author.username}**, seu Pacto ainda está recarregando (Reset em **${diffMinutes}m**).`);
    }
  }

  // 2. $ru (Rolls Up) / $rollsleft — Resposta direta de rolls igual ao Mudae
  if (commandName === "ru" || commandName === "rollsup" || commandName === "rollsleft") {
    return message.reply(
      `🎲 **${message.author.username}**, você tem **${rollsLeft}/${baseRolls}** invocações restantes (Reset em **${diffMinutes}m**) + **${stackedRolls}** extras empilhadas.`
    );
  }

  // 3. $ku (Kakera Up / Éter Up) — Resposta direta de Éter igual ao Mudae
  if (commandName === "ku" || commandName === "kakeraup") {
    return message.reply(
      `💠 **${message.author.username}**, a absorção de Orbes de Éter está **ativa e pronta** para ser coletada!`
    );
  }

  // 4. $tu / $timers (Painel Completo)
  const embed = new EmbedBuilder()
    .setTitle(`⏳ Painel Dimensional de Temporizadores (${message.author.username})`)
    .setColor("#00FFA3")
    .addFields(
      {
        name: "📜 Cargas de Pacto ($mu)",
        value: pactsLeft > 0 ? "✅ **Disponível para firmar Pacto agora!**" : `⏳ Recarrega em breve (Reset em **${diffMinutes}m**)...`,
        inline: false,
      },
      {
        name: "🌌 Invocações da Hora ($ru)",
        value: `**${rollsLeft}/${baseRolls}** disponíveis (Reset em **${diffMinutes}m**)`,
        inline: true,
      },
      {
        name: "📦 Rolls Empilhados ($us)",
        value: `**${stackedRolls}** extras disponíveis`,
        inline: true,
      },
      {
        name: "💠 Orbes de Éter ($ku)",
        value: "✅ Pronto para absorver",
        inline: true,
      }
    )
    .setFooter({ text: "Dica: Use $daily para acumular rolls extras ou $adminreset para testes!" });

  return message.reply({ embeds: [embed] });
}

