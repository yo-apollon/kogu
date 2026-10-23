/**
 * Registra os slash commands no Discord.
 *
 *   npm run deploy:commands            # DEV_GUILD_ID definido -> guilda; senao global
 *   npm run deploy:commands -- --clear # remove os comandos do mesmo escopo
 */
import { getEnv, requireEnv } from "../config/env.js";
import { CommandRegistry } from "../core/registry.js";
import { deployCommands } from "../core/deploy.js";
import { allCommands } from "../modules/index.js";

async function main(): Promise<void> {
  const clear = process.argv.includes("--clear");
  const env = getEnv();

  const registry = new CommandRegistry();
  for (const command of allCommands) registry.register(command);

  const result = await deployCommands({
    token: requireEnv("DISCORD_TOKEN"),
    clientId: requireEnv("DISCORD_CLIENT_ID"),
    guildId: env.DEV_GUILD_ID,
    commands: registry.buildSlashPayload(),
    clear,
  });

  const where = result.scope === "guild" ? `guilda ${result.guildId}` : "global";
  console.log(
    result.cleared
      ? `Slash commands removidos (${where}).`
      : `${result.count} slash command(s) registrado(s) (${where}).`
  );
}

main().catch((err: unknown) => {
  console.error("Falha ao registrar slash commands:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
