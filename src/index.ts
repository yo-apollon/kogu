import { Client, GatewayIntentBits, Partials } from "discord.js";
import { initRedisScripts, redis } from "./redis/index.js";
import { handleMessage } from "./handlers/messageHandler.js";
import pino from "pino";
import * as dotenv from "dotenv";

dotenv.config();

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: { colorize: true },
  },
});

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

client.once("ready", () => {
  logger.info(`✨ Arqon Bot dimensional online como: ${client.user?.tag}!`);
  client.user?.setActivity("o Cosmos Dimensional | $help", { type: 3 }); // Watching
});

client.on("messageCreate", async (message) => {
  try {
    await handleMessage(message);
  } catch (error: any) {
    logger.error(error, "Erro ao processar mensagem");
  }
});

async function bootstrap() {
  try {
    logger.info("🌀 Inicializando conexões com Redis e PostgreSQL...");
    await redis.connect().catch(() => {
      logger.warn("Redis não conectado localmente (inicie via docker compose para habilitar locks atômicos).");
    });
    await initRedisScripts().catch(() => null);

    const token = process.env.DISCORD_TOKEN;
    if (!token || token === "your_token_here") {
      logger.warn(
        "⚠️ DISCORD_TOKEN não configurado no arquivo .env. Configure suas credenciais antes de iniciar em produção."
      );
    } else {
      await client.login(token);
    }
  } catch (error) {
    logger.error({ error }, "Falha ao iniciar o Arqon Bot");
  }
}

bootstrap();
