/**
 * Registro de slash commands via REST.
 * - `guildId` presente (DEV_GUILD_ID) -> comandos de guilda (instantaneos, ideal para dev).
 * - ausente -> comandos globais (propagacao de ate ~1 h).
 * - `clear` envia lista vazia no mesmo escopo (remove os comandos).
 */
import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("core:deploy");

/** Formato real de um token de bot (3 segmentos base64url); rejeita placeholders do .env.example. */
const TOKEN_RE = /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/;

export function isRealDiscordToken(token: string | undefined | null): token is string {
  return typeof token === "string" && TOKEN_RE.test(token.trim());
}

export interface DeployOptions {
  token: string;
  clientId: string;
  guildId?: string;
  commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];
  clear?: boolean;
  /** Injetavel em testes. */
  rest?: { put(route: `/${string}`, options: { body: unknown }): Promise<unknown> };
}

export interface DeployResult {
  scope: "guild" | "global";
  guildId?: string;
  count: number;
  cleared: boolean;
}

export async function deployCommands(options: DeployOptions): Promise<DeployResult> {
  const rest = options.rest ?? new REST({ version: "10" }).setToken(options.token);
  const body = options.clear ? [] : options.commands;
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);

  await rest.put(route, { body });

  const result: DeployResult = {
    scope: options.guildId ? "guild" : "global",
    guildId: options.guildId,
    count: body.length,
    cleared: Boolean(options.clear),
  };
  log.info(result, options.clear ? "slash commands removidos" : "slash commands registrados");
  return result;
}
