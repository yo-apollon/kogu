/**
 * Script para enviar uma prévia de carta rara diretamente para um canal do Discord.
 * Uso: npx tsx src/scripts/sendPreview.ts [channelId]
 */
import "dotenv/config";
import { AttachmentBuilder, Client, GatewayIntentBits } from "discord.js";
import { renderCard } from "../canvas/index.js";
import { buildSummonButtons, buildSummonEmbed } from "../ui/summonEmbed.js";

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN ausente no .env");

  const channelId = process.argv[2] || "1560812296131837952";

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Canal ${channelId} não encontrado ou não aceita mensagens.`);
  }

  console.log(`Renderizando carta mítica/rara para #${(channel as any).name}...`);

  const art = await renderCard({
    entityId: "19",
    name: "Satoru Gojou",
    franchise: "JUJUTSU KAISEN",
    universe: "ANIME",
    tier: "MYTHIC",
    variant: "STANDARD",
    awakeningKeys: 0,
    aetherValue: 1015,
    popularityRank: 1,
    atk: 95,
    def: 92,
    spd: 99,
    imageUrl: "https://s4.anilist.co/file/anilistcdn/character/large/b127691-9zqh1xpIubn7.png",
    locale: "pt-BR",
  });

  const { embed, attachmentName } = buildSummonEmbed(
    {
      name: "Satoru Gojou",
      franchise: "JUJUTSU KAISEN",
      universe: "ANIME",
      gender: "MALE",
      tier: "MYTHIC",
      variant: "STANDARD",
      aetherValue: 1015,
      claimRank: 1,
      likeRank: 1,
      cardColor: 0x3b82f6, // Azul Infinity / Olhos Seis
    },
    { locale: "pt-BR", attachmentName: "card.webp" }
  );

  const buttons = buildSummonButtons("preview-gojo");

  const msg = await (channel as any).send({
    embeds: [embed],
    files: art ? [new AttachmentBuilder(art, { name: attachmentName })] : [],
    components: [buttons],
  });

  console.log(`✅ Prévia enviada com sucesso! Mensagem ID: ${msg.id}`);
  await client.destroy();
}

main().catch((err) => {
  console.error("❌ Erro ao enviar prévia:", err);
  process.exit(1);
});
