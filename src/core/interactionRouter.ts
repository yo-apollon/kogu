/**
 * Roteador de interacoes (evento interactionCreate).
 *
 * - ChatInput   -> registry (por nome) + pipeline de middlewares.
 * - Autocomplete -> `command.autocomplete`.
 * - Botao / select / modal -> ComponentHandler pelo namespace do customId; os namespaces
 *   reservados `pg`, `pn`, `cf` vao para os handlers do design system (src/ui/components).
 * Todo erro passa pelo errorBoundary (`reportError`): o usuario recebe o `errorId`, nunca a stack.
 */
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Interaction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../config/constants.js";
import type { KV } from "../infra/redis/kv.js";
import { childLogger } from "../lib/logger.js";
import { UserError } from "../lib/errors.js";
import { CONFIRM_NS, PAGINATOR_NS, PANEL_NS } from "../ui/components/ownership.js";
import { handleConfirmInteraction } from "../ui/components/confirm.js";
import { handlePaginatorInteraction } from "../ui/components/paginator.js";
import { handlePanelInteraction } from "../ui/components/panel.js";
import type { ComponentHandler } from "./contracts.js";
import {
  createInteractionResponder,
  createSlashInvocation,
  type CommandPipeline,
} from "./context.js";
import { decodeCustomId } from "./customId.js";
import type { GuildConfigProvider } from "./middleware/guildConfig.js";
import { reportError } from "./middleware/errorBoundary.js";
import type { CommandRegistry } from "./registry.js";
import { beginWork, isShuttingDown } from "./shutdown.js";

const log = childLogger("core:interaction");

const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([PAGINATOR_NS, PANEL_NS, CONFIRM_NS]);

type ComponentLike = MessageComponentInteraction | ModalSubmitInteraction;

export interface InteractionRouterDeps {
  registry: CommandRegistry;
  guildConfigs: GuildConfigProvider;
  pipeline: CommandPipeline;
  kv: KV;
  handlers: readonly ComponentHandler[];
  lifecycle?: { isShuttingDown(): boolean; beginWork(): () => void };
}

export function createInteractionRouter(
  deps: InteractionRouterDeps
): (interaction: Interaction) => Promise<void> {
  const lifecycle = deps.lifecycle ?? { isShuttingDown, beginWork };

  const handlers = new Map<string, ComponentHandler>();
  for (const handler of deps.handlers) {
    if (RESERVED_NAMESPACES.has(handler.namespace)) {
      throw new Error(`namespace de componente reservado: "${handler.namespace}"`);
    }
    if (handlers.has(handler.namespace)) {
      throw new Error(`namespace de componente duplicado: "${handler.namespace}"`);
    }
    handlers.set(handler.namespace, handler);
  }

  async function localeFor(guildId: string | null): Promise<Locale> {
    if (!guildId) return DEFAULT_LOCALE;
    try {
      return (await deps.guildConfigs.get(guildId)).locale;
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  async function reportInteractionError(
    err: unknown,
    interaction: ChatInputCommandInteraction | ComponentLike,
    meta: Record<string, unknown>
  ): Promise<void> {
    const responder = createInteractionResponder(interaction as never);
    await reportError(err, {
      reply: (p) => responder.reply(p),
      locale: await localeFor(interaction.guildId),
      meta: { userId: interaction.user.id, guildId: interaction.guildId, ...meta },
    });
  }

  async function handleChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = deps.registry.get(interaction.commandName);
    if (!command || !command.slash) {
      await reportInteractionError(
        new UserError("errors.unknown_command", { prefix: "/" }),
        interaction,
        {
          command: interaction.commandName,
        }
      );
      return;
    }
    if (!interaction.guild) {
      await reportInteractionError(new UserError("errors.guild_only"), interaction, {
        command: command.name,
      });
      return;
    }
    await deps.pipeline(createSlashInvocation(interaction, command, interaction.guild));
  }

  async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = deps.registry.get(interaction.commandName);
    if (!command?.autocomplete) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      log.error({ err, command: command.name }, "erro no autocomplete");
      await interaction.respond([]).catch(() => {});
    }
  }

  async function dispatchBuiltin(interaction: ComponentLike, ns: string): Promise<boolean> {
    switch (ns) {
      case PAGINATOR_NS:
        if (interaction.isButton() || interaction.isModalSubmit()) {
          await handlePaginatorInteraction(deps.kv, interaction);
        }
        return true;
      case PANEL_NS:
        if (interaction.isStringSelectMenu()) await handlePanelInteraction(deps.kv, interaction);
        return true;
      case CONFIRM_NS:
        if (interaction.isButton()) await handleConfirmInteraction(interaction);
        return true;
      default:
        return false;
    }
  }

  async function handleComponent(interaction: ComponentLike): Promise<void> {
    const decoded = decodeCustomId(interaction.customId);
    if (!decoded) {
      log.debug({ customId: interaction.customId.slice(0, 40) }, "customId invalido ignorado");
      return;
    }
    try {
      if (await dispatchBuiltin(interaction, decoded.ns)) return;
      const handler = handlers.get(decoded.ns);
      if (!handler) {
        // Pode pertencer a um collector local; nao responder para nao competir com ele.
        log.debug({ ns: decoded.ns }, "namespace de componente sem handler");
        return;
      }
      await handler.handle(interaction, decoded.parts);
    } catch (err) {
      await reportInteractionError(err, interaction, { namespace: decoded.ns });
    }
  }

  return async (interaction) => {
    // Autocomplete e respondido mesmo durante o shutdown (e barato e nao muda estado).
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
      return;
    }

    if (lifecycle.isShuttingDown()) {
      if (interaction.isRepliable()) {
        await reportInteractionError(new UserError("errors.infra"), interaction as ComponentLike, {
          reason: "shutting_down",
        });
      }
      return;
    }

    const done = lifecycle.beginWork();
    try {
      if (interaction.isChatInputCommand()) {
        await handleChatInput(interaction);
      } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        await handleComponent(interaction);
      }
    } catch (err) {
      log.error({ err }, "falha ao rotear interacao");
    } finally {
      done();
    }
  };
}
