/**
 * Registry de comandos. Resolucao por nome/alias em Map O(1).
 *
 * Extensao para atalhos com sufixo (ex.: `pt`, `ptk=`, `wa`, `hg` do bot antigo): o
 * contrato `CommandDefinition` nao muda; o registro aceita um wrapper local
 * `CommandRegistration = { cmd, matcher? }`. O `matcher` (RegExp ou funcao sobre o token
 * ja em minusculas) so e consultado quando nome/alias exatos nao casam, e na ordem de
 * registro. O token digitado chega ao comando em `ctx.invokedAs`.
 */
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { DEFAULT_LOCALE } from "../config/constants.js";
import { hasKey, t } from "../i18n/index.js";
import type { AnyCommand } from "./contracts.js";

export type CommandMatcher = RegExp | ((token: string) => boolean);

export interface CommandRegistration {
  cmd: AnyCommand;
  matcher?: CommandMatcher;
}

const SLASH_DESCRIPTION_MAX = 100;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function toMatcherFn(matcher: CommandMatcher): (token: string) => boolean {
  if (typeof matcher === "function") return matcher;
  // Sem as flags g/y o `test` nao guarda estado entre chamadas.
  const re = new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, ""));
  return (token) => re.test(token);
}

function isRegistration(input: AnyCommand | CommandRegistration): input is CommandRegistration {
  return typeof input === "object" && input !== null && "cmd" in input;
}

function truncateDescription(text: string): string {
  return text.length <= SLASH_DESCRIPTION_MAX
    ? text
    : `${text.slice(0, SLASH_DESCRIPTION_MAX - 1)}…`;
}

export class CommandRegistry {
  /** nome e aliases -> registro. */
  private readonly byKey = new Map<string, CommandRegistration>();
  /** nome canonico -> registro, na ordem de registro. */
  private readonly byName = new Map<string, CommandRegistration>();
  private readonly matchers: Array<{
    registration: CommandRegistration;
    test: (t: string) => boolean;
  }> = [];

  register(input: AnyCommand | CommandRegistration): void {
    const registration = isRegistration(input) ? input : { cmd: input };
    const { cmd } = registration;
    const name = normalizeKey(cmd.name);
    if (!name || /\s/.test(name)) {
      throw new Error(`nome de comando invalido: "${cmd.name}"`);
    }
    const keys = [name, ...(cmd.aliases ?? []).map(normalizeKey)];
    const seen = new Set<string>();
    for (const key of keys) {
      if (!key || /\s/.test(key)) {
        throw new Error(`alias invalido no comando "${cmd.name}": "${key}"`);
      }
      const owner = this.byKey.get(key);
      if (owner) {
        throw new Error(
          `comando/alias duplicado "${key}": ja registrado por "${owner.cmd.name}" (tentativa: "${cmd.name}")`
        );
      }
      if (seen.has(key)) {
        throw new Error(`alias repetido "${key}" no comando "${cmd.name}"`);
      }
      seen.add(key);
    }
    for (const key of keys) this.byKey.set(key, registration);
    this.byName.set(name, registration);
    if (registration.matcher) {
      this.matchers.push({ registration, test: toMatcherFn(registration.matcher) });
    }
  }

  /** Comando por nome ou alias exato (sem consultar matchers). */
  get(nameOrAlias: string): AnyCommand | undefined {
    return this.byKey.get(normalizeKey(nameOrAlias))?.cmd;
  }

  /** Nome/alias exato (O(1)); se nao casar, tenta os matchers por ordem de registro. */
  resolve(token: string): CommandRegistration | undefined {
    const key = normalizeKey(token);
    if (!key) return undefined;
    const exact = this.byKey.get(key);
    if (exact) return exact;
    for (const { registration, test } of this.matchers) {
      if (test(key)) return registration;
    }
    return undefined;
  }

  list(): AnyCommand[] {
    return [...this.byName.values()].map((r) => r.cmd);
  }

  get size(): number {
    return this.byName.size;
  }

  clear(): void {
    this.byKey.clear();
    this.byName.clear();
    this.matchers.length = 0;
  }

  /**
   * Payload para o registro de slash commands. Preenche nome e descricao (pt-BR, com
   * localizacao en-US) a partir de `descriptionKey` quando o builder do comando nao define.
   */
  buildSlashPayload(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
    const payload: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
    const names = new Set<string>();
    for (const cmd of this.list()) {
      if (!cmd.slash) continue;
      const builder = cmd.slash();
      if (!builder.name) builder.setName(cmd.name);
      if (!builder.description) {
        builder.setDescription(truncateDescription(t(cmd.descriptionKey, DEFAULT_LOCALE)));
        if (!builder.description_localizations && hasKey(cmd.descriptionKey, "en-US")) {
          builder.setDescriptionLocalizations({
            "en-US": truncateDescription(t(cmd.descriptionKey, "en-US")),
          });
        }
      }
      if (names.has(builder.name)) {
        throw new Error(`slash command duplicado: "${builder.name}"`);
      }
      names.add(builder.name);
      payload.push(builder.toJSON());
    }
    return payload;
  }
}

/** Instancia global usada pelo bot; testes criam `new CommandRegistry()`. */
export const registry = new CommandRegistry();

export function registerCommand(input: AnyCommand | CommandRegistration): void {
  registry.register(input);
}

export function getCommand(nameOrAlias: string): AnyCommand | undefined {
  return registry.get(nameOrAlias);
}

export function listCommands(): AnyCommand[] {
  return registry.list();
}

export function buildSlashPayload(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return registry.buildSlashPayload();
}
