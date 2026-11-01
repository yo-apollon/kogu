/**
 * Bootstrap do bot Kogu (v2).
 *
 * ATENCAO: diferente do bot antigo (SQLite local + Redis opcional), este processo EXIGE
 * `DATABASE_URL` (PostgreSQL) e sobe um KV: Redis real com `REDIS_URL`, ou MemoryStore apenas
 * em development/test. O bot antigo nao e mais iniciado por aqui; para rodar a versao anterior
 * use o historico do git (`git stash` / checkout do commit anterior). Nao ha alias de compatibilidade.
 *
 * Fluxo: env -> KV -> Postgres -> guildConfig -> registry (modulos) -> routers -> health -> shutdown
 * -> login (somente com DISCORD_TOKEN valido; sem token o processo sobe sem gateway e /readyz = 503).
 */
import { ActivityType, Client, Events, GatewayIntentBits, Options, Partials } from "discord.js";
import { getEnv } from "./config/env.js";
import { isRealDiscordToken } from "./core/deploy.js";
import { createCommandPipeline } from "./core/context.js";
import { createInteractionRouter } from "./core/interactionRouter.js";
import { registerGuildSync } from "./core/guildSync.js";
import { createGuildConfigService } from "./core/middleware/guildConfig.js";
import { createPrefixRouter } from "./core/prefixRouter.js";
import { registry } from "./core/registry.js";
import { installProcessHandlers, isShuttingDown, onShutdown, shutdown } from "./core/shutdown.js";
import { startHealthServer } from "./infra/health/server.js";
import { closeKV, getKV } from "./infra/redis/client.js";
import { logger } from "./lib/logger.js";
import { allComponentHandlers, allRegistrations, jobs } from "./modules/index.js";

async function main(): Promise<void> {
  const env = getEnv();
  installProcessHandlers();

  if (!env.DATABASE_URL) {
    logger.fatal(
      "DATABASE_URL ausente: o Kogu v2 exige PostgreSQL (veja .env.example e `npm run db:migrate`)."
    );
    process.exit(1);
  }

  const kv = await getKV();
  // Import dinamico: o cliente do banco le DATABASE_URL ao ser carregado.
  const { db, sql, closeDb } = await import("./infra/db/client.js");

  // KV em memoria nao compartilha nada entre processos: sem camada KV a mudanca feita pela dashboard
  // (config_version) vale em ate 30 s.
  const guildConfigs = createGuildConfigService({ kv, db, kvLayer: kv.kind !== "memory" });
  await guildConfigs.start();

  // Registro global: o /help le os comandos por `listCommands()` do mesmo registry.
  for (const registration of allRegistrations) registry.register(registration);
  logger.info({ commands: registry.size }, "comandos registrados");

  const pipeline = createCommandPipeline({ kv, guildConfigs });
  const routePrefix = createPrefixRouter({ registry, guildConfigs, pipeline });
  const routeInteraction = createInteractionRouter({
    registry,
    guildConfigs,
    pipeline,
    kv,
    handlers: allComponentHandlers,
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    allowedMentions: { parse: [] },
    makeCache: Options.cacheWithLimits({
      MessageManager: 35,
      GuildMemberManager: 100,
      PresenceManager: 0,
      ReactionManager: 10,
      ThreadManager: 10,
      StageInstanceManager: 0,
      GuildScheduledEventManager: 0,
    }),
    sweepers: {
      messages: {
        interval: 300,
        lifetime: 900,
      },
    },
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ tag: ready.user.tag, guilds: ready.guilds.cache.size }, "Kogu online");
    ready.user.setPresence({
      activities: [
        { name: `o Cosmos Dimensional | ${env.DEFAULT_PREFIX}help`, type: ActivityType.Watching },
      ],
      status: "online",
    });
  });
  registerGuildSync(client, db);
  client.on(Events.MessageCreate, (message) => {
    routePrefix(message).catch((err: unknown) => logger.error({ err }, "erro no prefixRouter"));
  });
  client.on(Events.InteractionCreate, (interaction) => {
    routeInteraction(interaction).catch((err: unknown) =>
      logger.error({ err }, "erro no interactionRouter")
    );
  });
  client.on(Events.Error, (err) => logger.error({ err }, "erro do cliente Discord"));
  client.on(Events.Warn, (message) => logger.warn({ message }, "aviso do cliente Discord"));
  client.on(Events.ShardDisconnect, (event, shardId) =>
    logger.warn({ code: event.code, shardId }, "shard desconectado")
  );

  const health = await startHealthServer({
    isDiscordReady: () => client.isReady(),
    checkDb: () => sql`select 1`,
    pingKv: () => kv.ping(),
    isShuttingDown,
    searchCatalog: async ({ q, universe, tier, limit }) => {
      const [{ count: totalActive }] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM entities WHERE status = 'ACTIVE'
      `;
      const pattern = q ? `%${q.toLowerCase()}%` : "%";
      const rows = await sql<
        Array<{
          id: number;
          name: string;
          seriesTitle: string | null;
          universe: string;
          gender: string;
          tier: string;
          baseAether: number;
          popularityRank: number | null;
          imageUrl: string | null;
        }>
      >`
        SELECT
          e.id::int AS id,
          e.name,
          s.title AS "seriesTitle",
          e.universe,
          e.gender,
          e.tier,
          e.base_aether AS "baseAether",
          e.popularity_rank AS "popularityRank",
          img.url AS "imageUrl"
        FROM entities e
        LEFT JOIN entity_series es ON es.entity_id = e.id AND es.is_primary = true
        LEFT JOIN series s ON s.id = es.series_id
        LEFT JOIN entity_images img ON img.entity_id = e.id AND img.is_primary = true
        WHERE e.status = 'ACTIVE'
          AND (${q === ""} OR LOWER(e.name) LIKE ${pattern} OR LOWER(COALESCE(s.title, '')) LIKE ${pattern})
          AND (${universe === ""} OR e.universe::text = ${universe})
          AND (${tier === ""} OR e.tier::text = ${tier})
        ORDER BY e.popularity_rank ASC NULLS LAST, e.base_aether DESC
        LIMIT ${limit}
      `;
      return { totalActive: totalActive ?? 1372, items: rows };
    },
  });

  // Ordem de encerramento: config -> gateway -> KV -> banco -> health (fica ate o fim para /readyz = 503).
  // Varredura das ofertas de invocacao expiradas (desabilita botoes); so roda com o gateway pronto.
  // Registrada antes do client/banco: o stop espera o tick em andamento, que ainda usa os dois.
  onShutdown("summon-sweeper", jobs.startSummonSweeper(client, kv));
  onShutdown("guildConfig", () => guildConfigs.stop());
  onShutdown("discord-client", () => client.destroy());
  onShutdown("kv", () => closeKV());
  onShutdown("postgres", () => closeDb());
  if (health) onShutdown("health", () => health.close());

  if (isRealDiscordToken(env.DISCORD_TOKEN)) {
    await client.login(env.DISCORD_TOKEN);
  } else {
    logger.warn(
      "DISCORD_TOKEN ausente ou invalido: o bot NAO conectara ao Discord (apenas health/infra)."
    );
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "falha ao iniciar o Kogu");
  void shutdown("bootstrap-failure", { code: 1, drainTimeoutMs: 0 });
});
