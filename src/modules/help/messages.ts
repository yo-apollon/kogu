/**
 * Textos do modulo HELP. Chaves existentes (help.title, help.footer, help.category.*,
 * help.commands.*...) sao lidas por `t()`; as demais ficam na tabela local abaixo (chaves PROPOSTAS
 * para locales/*.json) e passam a vir do JSON automaticamente quando existirem.
 *
 * Tambem cobre comandos cujo `descriptionKey` ainda nao esta nos locales
 * (`help.commands.ping`, `help.commands.catalog`).
 */
import { TMDB_ATTRIBUTION } from "../../catalog/sources/tmdb.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { getLocale, hasKey, t } from "../../i18n/index.js";

type Table = Record<string, string>;

const PT: Table = {
  "help.overview_label": "Visão geral",
  "help.commands_count": "{count} comandos",
  "help.owner_only": "restrito ao dono do bot",
  "help.credits": "Dados: AniList, IGDB e TMDB.",
  "help.commands.ping": "Mostra a latência do bot.",
  "help.commands.catalog": "Moderação do catálogo (revisão e merge).",
};

const EN: Table = {
  "help.overview_label": "Overview",
  "help.commands_count": "{count} commands",
  "help.owner_only": "bot owner only",
  "help.credits": "Data: AniList, IGDB and TMDB.",
  "help.commands.ping": "Shows the bot latency.",
  "help.commands.catalog": "Catalog moderation (review and merge).",
};

export const FALLBACK_MESSAGES: Readonly<Record<Locale, Readonly<Table>>> = {
  "pt-BR": PT,
  "en-US": EN,
};

/** Atribuicao exigida pelo TMDB. O texto em pt-BR e o exportado pelo adapter; en-US usa o oficial. */
export const TMDB_ATTRIBUTION_EN =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export function tmdbAttribution(locale: Locale | string | undefined): string {
  return getLocale(locale) === "en-US" ? TMDB_ATTRIBUTION_EN : TMDB_ATTRIBUTION;
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Traduz `key`: JSON de locales se existir, senao a tabela local, senao `undefined`. */
export function lookup(
  locale: Locale | string | undefined,
  key: string,
  params: Record<string, string | number> = {}
): string | undefined {
  const lang = getLocale(locale ?? DEFAULT_LOCALE);
  if (hasKey(key, lang)) return t(key, lang, params);
  const text = FALLBACK_MESSAGES[lang][key] ?? FALLBACK_MESSAGES[DEFAULT_LOCALE][key];
  return text === undefined ? undefined : interpolate(text, params);
}

/** Como `lookup`, mas devolve a propria chave quando nao existe em lugar nenhum. */
export function msg(
  locale: Locale | string | undefined,
  key: string,
  params: Record<string, string | number> = {}
): string {
  return lookup(locale, key, params) ?? key;
}
