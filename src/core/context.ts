/**
 * Contexto unificado de comando (prefixo e slash), respondedores e `Invocation`.
 *
 * - `Responder`: reply/defer/followUp com a mesma semantica nas duas origens.
 * - `parseCommandArgs`: aplica o schema zod do comando; falha vira `UserError` i18n
 *   (`errors.missing_argument` / `errors.invalid_argument`) com o parametro `usage`.
 * - `Invocation`: o que os middlewares enxergam; o `CommandContext` e construido sob demanda
 *   (depois que o `guildConfig` foi resolvido).
 */
import {
  MessageFlags,
  MessageFlagsBitField,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type User,
} from "discord.js";
import type { ZodIssue } from "zod";
import { DEFAULT_LOCALE, type Locale } from "../config/constants.js";
import { translator } from "../i18n/index.js";
import { UserError } from "../lib/errors.js";
import type { KV } from "../infra/redis/kv.js";
import type { AnyCommand, CommandContext, GuildConfig, ReplyPayload } from "./contracts.js";
import { cooldownMiddleware } from "./middleware/cooldown.js";
import { errorBoundary } from "./middleware/errorBoundary.js";
import { guildConfigMiddleware, type GuildConfigProvider } from "./middleware/guildConfig.js";
import { permissionsMiddleware } from "./middleware/permissions.js";

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

export interface Responder {
  defer(opts?: { ephemeral?: boolean }): Promise<void>;
  reply(payload: ReplyPayload): Promise<Message>;
  followUp(payload: ReplyPayload): Promise<Message>;
}

type LooseOptions = Record<string, any>;

function toOptions(payload: ReplyPayload): LooseOptions {
  return typeof payload === "string" ? { content: payload } : { ...payload };
}

/** Remove o bit Ephemeral de `flags` (mensagens de canal nao podem ser efemeras). */
function withoutEphemeral(options: LooseOptions): LooseOptions {
  const out = { ...options };
  delete out.ephemeral;
  delete out.fetchReply;
  if (out.flags !== undefined) {
    const bits = Number(MessageFlagsBitField.resolve(out.flags)) & ~Number(MessageFlags.Ephemeral);
    if (bits === 0) delete out.flags;
    else out.flags = bits;
  }
  return out;
}

/** Converte `ephemeral: true` em flag; slash/componentes aceitam. */
function withEphemeralFlag(options: LooseOptions): LooseOptions {
  const out = { ...options };
  if (out.ephemeral) {
    const base = out.flags !== undefined ? Number(MessageFlagsBitField.resolve(out.flags)) : 0;
    out.flags = base | Number(MessageFlags.Ephemeral);
  }
  delete out.ephemeral;
  return out;
}

/** Nunca menciona ninguem por padrao; o chamador pode sobrescrever explicitamente. */
function safeMentions(options: LooseOptions, replyingToMessage: boolean): LooseOptions {
  const out = { ...options };
  if (out.allowedMentions) {
    out.allowedMentions = replyingToMessage
      ? { repliedUser: false, ...out.allowedMentions }
      : out.allowedMentions;
  } else {
    out.allowedMentions = replyingToMessage ? { parse: [], repliedUser: false } : { parse: [] };
  }
  return out;
}

const DISCORD_UNKNOWN_MESSAGE = 10008;
const DISCORD_INVALID_FORM_BODY = 50035;

function discordCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

export function createPrefixResponder(message: Message): Responder {
  const send = (options: LooseOptions): Promise<Message> => {
    const channel = message.channel as unknown as { send?: (o: unknown) => Promise<Message> };
    if (typeof channel.send !== "function") {
      return Promise.reject(new Error("canal sem suporte a envio de mensagens"));
    }
    return channel.send(options);
  };

  return {
    async defer() {
      try {
        const channel = message.channel as unknown as { sendTyping?: () => Promise<void> };
        await channel.sendTyping?.();
      } catch {
        // Indicador "digitando" e cosmetico.
      }
    },
    async reply(payload) {
      const options = safeMentions(withoutEphemeral(toOptions(payload)), true);
      try {
        return await message.reply(options as Parameters<Message["reply"]>[0]);
      } catch (err) {
        // Mensagem original apagada: responde no canal em vez de falhar.
        const code = discordCode(err);
        if (code === DISCORD_UNKNOWN_MESSAGE || code === DISCORD_INVALID_FORM_BODY) {
          return send(safeMentions(options, false));
        }
        throw err;
      }
    },
    async followUp(payload) {
      return send(safeMentions(withoutEphemeral(toOptions(payload)), false));
    },
  };
}

/** Subconjunto de interacao respondivel (slash, componente ou modal). */
type RepliableInteraction = Interaction & {
  deferred: boolean;
  replied: boolean;
  reply(options: any): Promise<any>;
  editReply(options: any): Promise<any>;
  followUp(options: any): Promise<any>;
  deferReply(options?: any): Promise<any>;
};

/**
 * Slash: primeiro `reply` vira `editReply` se ja houve `defer`; depois disso `followUp`.
 * Componentes/modais: `reply` sem resposta previa, senao `followUp` (nunca edita a mensagem original).
 */
export function createInteractionResponder(interaction: RepliableInteraction): Responder {
  const editsDeferred = interaction.isChatInputCommand();
  return {
    async defer(opts) {
      if (interaction.deferred || interaction.replied) return;
      await interaction.deferReply(opts?.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    },
    async reply(payload) {
      const options = safeMentions(withEphemeralFlag(toOptions(payload)), false);
      if (interaction.replied) return interaction.followUp(options);
      if (interaction.deferred) {
        if (editsDeferred) {
          const editable = withoutEphemeral(options);
          return interaction.editReply(editable);
        }
        return interaction.followUp(options);
      }
      return interaction.reply({ ...options, fetchReply: true, withResponse: true });
    },
    async followUp(payload) {
      const options = safeMentions(withEphemeralFlag(toOptions(payload)), false);
      if (!interaction.deferred && !interaction.replied) {
        return interaction.reply({ ...options, fetchReply: true, withResponse: true });
      }
      return interaction.followUp(options);
    },
  };
}

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function valueAt(raw: unknown, path: ReadonlyArray<string | number>): unknown {
  let current: unknown = raw;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function argName(issue: ZodIssue): string {
  const [first, ...rest] = issue.path;
  if (first === undefined) return "args";
  if (typeof first === "number") return `#${first + 1}`;
  return [first, ...rest].join(".");
}

/**
 * Valida `raw` contra o schema do comando. Sem schema devolve `raw` (ou `{}`).
 * `usage` e a linha de uso exibida ao usuario junto do erro.
 */
export function parseCommandArgs(
  command: AnyCommand,
  raw: unknown,
  usageBase: string
): Record<string, unknown> {
  if (!command.args) return (raw ?? {}) as Record<string, unknown>;
  const result = command.args.safeParse(raw);
  if (result.success) return result.data as Record<string, unknown>;

  const issue = result.error.issues[0];
  if (!issue) throw new UserError("errors.invalid_argument", { arg: "args", usage: usageBase });
  const arg = argName(issue);
  const missing = isEmptyValue(valueAt(raw, issue.path));
  const usage = arg === "args" ? usageBase : `${usageBase} <${arg}>`;
  throw new UserError(missing ? "errors.missing_argument" : "errors.invalid_argument", {
    arg,
    usage,
  });
}

// ---------------------------------------------------------------------------
// Contextos
// ---------------------------------------------------------------------------

interface ContextBase {
  source: "prefix" | "slash";
  message?: Message;
  interaction?: ChatInputCommandInteraction;
  user: User;
  member: GuildMember | null;
  guild: Guild;
  guildConfig: GuildConfig;
  invokedAs: string;
  args: unknown;
  rawArgs: string[];
  responder: Responder;
}

function buildContext(base: ContextBase): CommandContext {
  const locale: Locale = base.guildConfig.locale ?? DEFAULT_LOCALE;
  const t = translator(locale);
  return {
    source: base.source,
    message: base.message,
    interaction: base.interaction,
    user: base.user,
    member: base.member,
    guild: base.guild,
    guildConfig: base.guildConfig,
    locale,
    invokedAs: base.invokedAs,
    args: base.args as Record<string, unknown>,
    rawArgs: base.rawArgs,
    defer: (opts) => base.responder.defer(opts),
    reply: (payload) => base.responder.reply(payload),
    followUp: (payload) => base.responder.followUp(payload),
    t: (key, params) => t(key, params),
  };
}

/**
 * Contexto de comando por prefixo. Lanca `UserError` se os argumentos forem invalidos.
 * `invokedAs` e o token digitado (relevante para aliases e atalhos com sufixo).
 */
export function createPrefixContext(
  message: Message<true>,
  command: AnyCommand,
  tokens: string[],
  guildConfig: GuildConfig,
  invokedAs: string = command.name,
  responder: Responder = createPrefixResponder(message)
): CommandContext {
  // Sem `parseArgs`, o schema (se houver) recebe os tokens crus.
  const raw = command.parseArgs
    ? command.parseArgs(tokens, { invokedAs, message })
    : command.args
      ? tokens
      : {};
  const args = parseCommandArgs(command, raw, `${guildConfig.prefix}${command.name}`);
  return buildContext({
    source: "prefix",
    message,
    user: message.author,
    member: message.member,
    guild: message.guild,
    guildConfig,
    invokedAs,
    args,
    rawArgs: tokens,
    responder,
  });
}

export function createSlashContext(
  interaction: ChatInputCommandInteraction,
  command: AnyCommand,
  guildConfig: GuildConfig,
  responder: Responder = createInteractionResponder(interaction as unknown as RepliableInteraction)
): CommandContext {
  if (!interaction.guild) throw new UserError("errors.guild_only");
  const raw = command.slashArgs
    ? command.slashArgs(interaction)
    : Object.fromEntries(interaction.options.data.map((o) => [o.name, o.value]));
  const args = parseCommandArgs(command, raw, `/${command.name}`);
  return buildContext({
    source: "slash",
    interaction,
    user: interaction.user,
    member: interaction.inCachedGuild() ? interaction.member : null,
    guild: interaction.guild,
    guildConfig,
    invokedAs: interaction.commandName,
    args,
    rawArgs: [],
    responder,
  });
}

// ---------------------------------------------------------------------------
// Invocation + pipeline
// ---------------------------------------------------------------------------

/** O que os middlewares veem. `guildConfig` e preenchido pelo middleware (ou pelo roteador de prefixo). */
export interface Invocation {
  readonly source: "prefix" | "slash";
  readonly command: AnyCommand;
  readonly invokedAs: string;
  readonly user: User;
  readonly member: GuildMember | null;
  readonly guild: Guild;
  readonly responder: Responder;
  guildConfig?: GuildConfig;
  readonly locale: Locale;
  /** Constroi (e memoriza) o contexto; valida argumentos. Exige `guildConfig`. */
  buildContext(): CommandContext;
}

export type Middleware = (inv: Invocation, next: () => Promise<void>) => Promise<void>;

export function runMiddleware(
  chain: readonly Middleware[],
  inv: Invocation,
  terminal: () => Promise<void>
): Promise<void> {
  const dispatch = (index: number): Promise<void> => {
    const mw = chain[index];
    if (!mw) return terminal();
    return mw(inv, () => dispatch(index + 1));
  };
  return dispatch(0);
}

abstract class BaseInvocation implements Invocation {
  guildConfig?: GuildConfig;
  private context?: CommandContext;

  constructor(
    readonly source: "prefix" | "slash",
    readonly command: AnyCommand,
    readonly invokedAs: string,
    readonly user: User,
    readonly member: GuildMember | null,
    readonly guild: Guild,
    readonly responder: Responder
  ) {}

  get locale(): Locale {
    return this.guildConfig?.locale ?? DEFAULT_LOCALE;
  }

  protected abstract create(guildConfig: GuildConfig): CommandContext;

  buildContext(): CommandContext {
    if (this.context) return this.context;
    if (!this.guildConfig) throw new Error("guildConfig ainda nao resolvido");
    this.context = this.create(this.guildConfig);
    return this.context;
  }
}

class PrefixInvocation extends BaseInvocation {
  constructor(
    private readonly message: Message<true>,
    command: AnyCommand,
    private readonly tokens: string[],
    invokedAs: string,
    guildConfig?: GuildConfig
  ) {
    super(
      "prefix",
      command,
      invokedAs,
      message.author,
      message.member,
      message.guild,
      createPrefixResponder(message)
    );
    this.guildConfig = guildConfig;
  }

  protected create(guildConfig: GuildConfig): CommandContext {
    return createPrefixContext(
      this.message,
      this.command,
      this.tokens,
      guildConfig,
      this.invokedAs,
      this.responder
    );
  }
}

class SlashInvocation extends BaseInvocation {
  constructor(
    private readonly interaction: ChatInputCommandInteraction,
    command: AnyCommand,
    guild: Guild
  ) {
    super(
      "slash",
      command,
      interaction.commandName,
      interaction.user,
      interaction.inCachedGuild() ? interaction.member : null,
      guild,
      createInteractionResponder(interaction as unknown as RepliableInteraction)
    );
  }

  protected create(guildConfig: GuildConfig): CommandContext {
    return createSlashContext(this.interaction, this.command, guildConfig, this.responder);
  }
}

export function createPrefixInvocation(
  message: Message<true>,
  command: AnyCommand,
  tokens: string[],
  invokedAs: string,
  guildConfig?: GuildConfig
): Invocation {
  return new PrefixInvocation(message, command, tokens, invokedAs, guildConfig);
}

export function createSlashInvocation(
  interaction: ChatInputCommandInteraction,
  command: AnyCommand,
  guild: Guild
): Invocation {
  return new SlashInvocation(interaction, command, guild);
}

export type CommandPipeline = (inv: Invocation) => Promise<void>;

export interface PipelineDeps {
  kv: KV;
  guildConfigs: GuildConfigProvider;
}

/**
 * Cadeia padrao: errorBoundary -> guildConfig -> permissions -> cooldown -> execute.
 * Nunca rejeita: o errorBoundary responde ao usuario e registra o erro.
 */
export function createCommandPipeline(deps: PipelineDeps): CommandPipeline {
  const chain: Middleware[] = [
    errorBoundary(),
    guildConfigMiddleware(deps.guildConfigs),
    permissionsMiddleware(),
    cooldownMiddleware(deps.kv),
  ];
  return (inv) =>
    runMiddleware(chain, inv, async () => {
      await inv.command.execute(inv.buildContext());
    });
}
