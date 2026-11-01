/**
 * Roteador de comandos por prefixo (evento messageCreate).
 *
 * Ignora bots, webhooks, mensagens de sistema e DMs. O prefixo vem do `guildConfig` (cache).
 * Resolve nome/alias em O(1) e, se falhar, tenta os `matcher`s de atalho (ver registry.ts).
 * Token desconhecido e ignorado em silencio (mensagens normais comecam com `$` as vezes).
 */
import type { Message } from "discord.js";
import { childLogger } from "../lib/logger.js";
import { createPrefixInvocation, type CommandPipeline } from "./context.js";
import type { GuildConfigProvider } from "./middleware/guildConfig.js";
import type { CommandRegistry } from "./registry.js";
import { beginWork, isShuttingDown } from "./shutdown.js";

const log = childLogger("core:prefix");

export interface ParsedPrefixInput {
  /** Primeiro token, em minusculas. */
  name: string;
  /** Demais tokens, como digitados. */
  tokens: string[];
}

/** Extrai nome e argumentos de `content`; `null` se nao comecar com o prefixo ou estiver vazio. */
export function parsePrefixInput(content: string, prefix: string): ParsedPrefixInput | null {
  if (!prefix || !content.startsWith(prefix)) return null;
  const rest = content.slice(prefix.length).trim();
  if (!rest) return null;
  const [first, ...tokens] = rest.split(/\s+/);
  if (!first) return null;
  return { name: first.toLowerCase(), tokens };
}

export interface PrefixRouterDeps {
  registry: CommandRegistry;
  guildConfigs: GuildConfigProvider;
  pipeline: CommandPipeline;
  /** Controle de shutdown injetavel (padrao: o do processo). */
  lifecycle?: { isShuttingDown(): boolean; beginWork(): () => void };
}

export function createPrefixRouter(deps: PrefixRouterDeps): (message: Message) => Promise<void> {
  const lifecycle = deps.lifecycle ?? { isShuttingDown, beginWork };

  return async (message) => {
    if (message.author.bot || message.system || message.webhookId) return;
    if (!message.guild) return;
    if (!message.content || message.content.length === 0) return;
    if (lifecycle.isShuttingDown()) return;

    const done = lifecycle.beginWork();
    try {
      const guildConfig = await deps.guildConfigs.get(message.guild.id);
      const parsed = parsePrefixInput(message.content, guildConfig.prefix);
      if (!parsed) return;

      const registration = deps.registry.resolve(parsed.name);
      if (!registration) return;

      const invocation = createPrefixInvocation(
        message as Message<true>,
        registration.cmd,
        parsed.tokens,
        parsed.name,
        guildConfig
      );
      await deps.pipeline(invocation);
    } catch (err) {
      // O pipeline nunca rejeita; chegar aqui significa falha ao carregar a config (banco/KV fora).
      log.error({ err, guildId: message.guild.id }, "falha ao rotear mensagem");
    } finally {
      done();
    }
  };
}
