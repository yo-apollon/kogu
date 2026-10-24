/**
 * Textos do modulo ADMIN. Chaves existentes em locales/*.json (admin.setvip_*, admin.adminreset_*,
 * admin.cleanuser_*, admin.thanos_ok) sao lidas por `t()`; as demais ficam na tabela local abaixo
 * (chaves PROPOSTAS para locales/*.json) e passam a vir do JSON automaticamente quando existirem.
 */
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { getLocale, hasKey, t } from "../../i18n/index.js";

type Table = Record<string, string>;

const PT: Table = {
  "admin.cleanuser_confirm":
    "🧹 Liberar **todos** os **{count}** pactos de <@{userId}> neste servidor? Esta ação não pode ser desfeita.",
  "admin.thanos_confirm":
    "🫰 Dissolver aleatoriamente cerca de **metade** dos pactos sem Selos deste servidor (**{eligible}** elegíveis)? Esta ação não pode ser desfeita.",
  "admin.thanos_nothing": "🫰 Nenhum pacto elegível (sem Selos de Despertar) neste servidor.",
};

const EN: Table = {
  "admin.cleanuser_confirm":
    "🧹 Release **all** **{count}** pacts of <@{userId}> in this server? This cannot be undone.",
  "admin.thanos_confirm":
    "🫰 Randomly dissolve about **half** of this server's pacts without Seals (**{eligible}** eligible)? This cannot be undone.",
  "admin.thanos_nothing": "🫰 No eligible pacts (without Awakening Seals) in this server.",
};

/** Tabelas de fallback, exportadas para o relatorio/teste de chaves faltantes. */
export const FALLBACK_MESSAGES: Readonly<Record<Locale, Readonly<Table>>> = {
  "pt-BR": PT,
  "en-US": EN,
};

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Traduz `key`: JSON de locales se existir, senao a tabela local, senao a propria chave. */
export function msg(
  locale: Locale | string | undefined,
  key: string,
  params: Record<string, string | number> = {}
): string {
  const lang = getLocale(locale ?? DEFAULT_LOCALE);
  if (hasKey(key, lang)) return t(key, lang, params);
  const text = FALLBACK_MESSAGES[lang][key] ?? FALLBACK_MESSAGES[DEFAULT_LOCALE][key];
  return text === undefined ? key : interpolate(text, params);
}
