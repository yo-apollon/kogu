/**
 * Servico do modulo HELP: agrupa os comandos do registry por categoria. Puro (sem Discord, sem
 * banco): recebe a lista de comandos por parametro; em runtime o comando passa `listCommands()` de
 * core/registry.ts, que so esta completo depois que todos os modulos foram registrados.
 */
import type { Locale } from "../../config/constants.js";
import type { AnyCommand, CommandCategory } from "../../core/contracts.js";
import { lookup } from "./messages.js";

/** Ordem de exibicao; categorias fora da lista vao depois, em ordem alfabetica. */
export const CATEGORY_ORDER: readonly CommandCategory[] = [
  "summon",
  "collection",
  "economy",
  "wishlist",
  "config",
  "catalog",
  "admin",
  "help",
];

/** Aliases mostrados por comando (mais que isto vira ruido). */
export const MAX_ALIASES_SHOWN = 3;

export interface HelpEntry {
  name: string;
  aliases: string[];
  /** Ex.: `$import ($add, $importar)`. Vai entre crases em `help.command_line`. */
  usage: string;
  description: string;
  ownerOnly: boolean;
  /** Existe versao slash. */
  slash: boolean;
}

export interface HelpGroup {
  category: CommandCategory;
  /** `help.category.<categoria>` (ja com emoji). */
  title: string;
  entries: HelpEntry[];
}

/** Descricao pelo `descriptionKey` (locales ou fallback local); vazia se nao houver. */
export function describeCommand(cmd: AnyCommand, locale: Locale | string): string {
  return lookup(locale, cmd.descriptionKey) ?? "";
}

export function toEntry(cmd: AnyCommand, locale: Locale | string, prefix: string): HelpEntry {
  const aliases = [...(cmd.aliases ?? [])];
  const shown = aliases.slice(0, MAX_ALIASES_SHOWN).map((a) => `${prefix}${a}`);
  const hidden = aliases.length - shown.length;
  const extra = shown.length > 0 ? ` (${shown.join(", ")}${hidden > 0 ? ", …" : ""})` : "";
  return {
    name: cmd.name,
    aliases,
    usage: `${prefix}${cmd.name}${extra}`,
    description: describeCommand(cmd, locale),
    ownerOnly: cmd.ownerOnly === true,
    slash: typeof cmd.slash === "function",
  };
}

/** Agrupa por categoria mantendo a ordem de registro dentro de cada grupo; omite categorias vazias. */
export function buildHelpGroups(
  commands: readonly AnyCommand[],
  locale: Locale | string,
  prefix: string
): HelpGroup[] {
  const byCategory = new Map<CommandCategory, AnyCommand[]>();
  for (const cmd of commands) {
    const list = byCategory.get(cmd.category);
    if (list) list.push(cmd);
    else byCategory.set(cmd.category, [cmd]);
  }
  const known = CATEGORY_ORDER.filter((c) => byCategory.has(c));
  const unknown = [...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
  return [...known, ...unknown].map((category) => ({
    category,
    title: lookup(locale, `help.category.${category}`) ?? category,
    entries: (byCategory.get(category) ?? []).map((cmd) => toEntry(cmd, locale, prefix)),
  }));
}
