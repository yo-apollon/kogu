import type {
  APIEmbed,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  Message,
  MessageCreateOptions,
  PermissionResolvable,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandBuilder,
  User,
} from "discord.js";
import type { z } from "zod";
import type { Locale } from "../config/constants.js";

export type CommandCategory =
  | "summon"
  | "collection"
  | "economy"
  | "wishlist"
  | "config"
  | "catalog"
  | "admin"
  | "help";

/** Configuracao do servidor ja resolvida pelo middleware guildConfig. */
export interface GuildConfig {
  id: string;
  prefix: string;
  locale: Locale;
  baseRolls: number;
  rollIntervalMin: number;
  resetOffsetMin: number;
  claimIntervalMin: number;
  claimWindowSeconds: number;
  snipeProtectionLevel: number;
  snipeProtectionSeconds: number;
  pactLimit: number;
  releaseBoostEnabled: boolean;
  allowAdult: boolean;
}

export type ReplyPayload = string | (Omit<MessageCreateOptions, "reply"> & InteractionReplyOptions);

/**
 * Contexto unificado: o mesmo `execute` atende comando por prefixo (Message)
 * e slash (ChatInputCommandInteraction).
 */
export interface CommandContext<A = Record<string, unknown>> {
  readonly source: "prefix" | "slash";
  readonly message?: Message;
  readonly interaction?: ChatInputCommandInteraction;
  readonly user: User;
  readonly member: GuildMember | null;
  readonly guild: Guild;
  readonly guildConfig: GuildConfig;
  readonly locale: Locale;
  /** Nome exato usado pelo usuario (util para atalhos como `wa`, `hg`). */
  readonly invokedAs: string;
  /** Argumentos ja validados pelo schema zod do comando. */
  readonly args: A;
  /** Texto bruto apos o nome do comando (prefixo) ou vazio (slash). */
  readonly rawArgs: string[];

  /** Adia a resposta (slash) ou mostra "digitando" (prefixo). */
  defer(opts?: { ephemeral?: boolean }): Promise<void>;
  reply(payload: ReplyPayload): Promise<Message>;
  followUp(payload: ReplyPayload): Promise<Message>;
  /** Traduz uma chave i18n no idioma do servidor. */
  t(key: string, params?: Record<string, string | number>): string;
}

export interface CommandDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  /** Chave i18n de `description` usada em /help e no slash. */
  descriptionKey: string;
  /** Schema zod aplicado sobre os argumentos extraidos. */
  args?: S;
  /** Converte tokens de prefixo em objeto bruto antes do schema. */
  parseArgs?: (tokens: string[], ctx: { invokedAs: string; message: Message }) => unknown;
  /** Builder de slash; sem ele o comando existe apenas por prefixo. */
  slash?: () => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  /** Converte opcoes do slash em objeto bruto antes do schema. */
  slashArgs?: (interaction: ChatInputCommandInteraction) => unknown;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
  cooldownMs?: number;
  /** Permissoes de Discord exigidas do membro. */
  permissions?: PermissionResolvable;
  /** Restringe a IDs de OWNER_IDS. */
  ownerOnly?: boolean;
  execute(ctx: CommandContext<z.infer<S>>): Promise<void>;
}

export type AnyCommand = CommandDefinition<any>;

/** Manipulador de componente (botao/select/modal) roteado por prefixo de customId. */
export interface ComponentHandler {
  /** Namespace do customId, ex.: "sm" para `sm:pact:<offerId>`. */
  namespace: string;
  handle(interaction: import("discord.js").MessageComponentInteraction | import("discord.js").ModalSubmitInteraction, parts: string[]): Promise<void>;
}

export type EmbedLike = APIEmbed;
