/**
 * Textos do modulo CATALOG.
 *
 * Chaves que ja existem em locales/*.json (catalog.import_*, catalog.suggest_*...) sao lidas por
 * `t()`. As que ainda nao existem ficam na tabela local abaixo (pt-BR + en-US) e passam a ser
 * lidas do JSON automaticamente quando forem adicionadas la (`hasKey` decide, sem mudar codigo).
 * Estas sao as chaves PROPOSTAS para locales/*.json (namespace `catalog.`).
 */
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { getLocale, hasKey, t } from "../../i18n/index.js";

type Table = Record<string, string>;

const PT: Table = {
  "catalog.import_exists": "ℹ️ **{name}** já está no catálogo (*{franchise}*).",
  "catalog.import_review":
    "🕓 **{name}** (*{franchise}*) foi cadastrado, mas aguarda revisão: {reasons}.\nUm moderador precisa aprová-lo em `/catalog review`.",
  "catalog.import_disabled":
    "🚫 **{name}** está desativado no catálogo e não pode ser importado novamente.",
  "catalog.suggest_limit":
    "⏳ Você já tem **{max}** sugestões pendentes. Aguarde a moderação antes de enviar novas.",
  "catalog.suggest_duplicate": '📋 **"{query}"** já está na fila de moderação.',
  "catalog.review_title": "🛡️ Revisão do catálogo",
  "catalog.review_empty": "✅ A fila de moderação está vazia.",
  "catalog.review_footer": "Fila #{id} • item {position} de {total}",
  "catalog.review_field_reason": "Motivo",
  "catalog.review_field_entity": "Entidade",
  "catalog.review_field_series": "Série",
  "catalog.review_field_gender": "Gênero",
  "catalog.review_field_status": "Status",
  "catalog.review_field_favorites": "Favoritos na fonte",
  "catalog.review_field_other": "Possível duplicata de",
  "catalog.review_field_pending": "Outros motivos pendentes",
  "catalog.review_hint_waive":
    "Aprovar mantém a entidade no catálogo; rejeitar a desativa.",
  "catalog.review_hint_duplicate":
    "Mesclar absorve esta entidade na existente; “não é duplicata” mantém as duas.",
  "catalog.review_hint_report":
    "Aprovar a denúncia desativa a entidade; rejeitar a descarta.",
  "catalog.review_btn_approve": "Aprovar",
  "catalog.review_btn_reject": "Rejeitar",
  "catalog.review_btn_name": "Corrigir nome",
  "catalog.review_btn_merge": "Mesclar duplicata",
  "catalog.review_btn_not_dup": "Não é duplicata",
  "catalog.review_gender_placeholder": "Definir gênero…",
  "catalog.review_name_modal_title": "Corrigir nome",
  "catalog.review_name_modal_label": "Novo nome ({min} a {max} caracteres)",
  "catalog.review_approved": "✅ Item #{id} aprovado.",
  "catalog.review_activated": "✅ **{entity}** foi ativado no catálogo.",
  "catalog.review_rejected": "❌ Item #{id} rejeitado.",
  "catalog.review_disabled": "🚫 **{entity}** foi desativado.",
  "catalog.review_merged": "🔀 **{loser}** foi mesclado em **{winner}**.",
  "catalog.review_not_dup": "↔️ Item #{id}: marcado como não duplicata.",
  "catalog.review_gender_set": "⚧ Gênero de **{entity}** definido como **{gender}**.",
  "catalog.review_name_set": "✏️ Nome atualizado para **{name}**.",
  "catalog.review_invalid_name": "❌ Nome inválido: use de {min} a {max} caracteres.",
  "catalog.review_blocked_gender": "⚠️ Defina o gênero antes de aprovar este item.",
  "catalog.review_blocked_image":
    "⚠️ A entidade não tem imagem ativa: só é possível rejeitar ou aguardar a próxima sincronização.",
  "catalog.review_stale": "ℹ️ Este item já foi processado por outro moderador.",
  "catalog.review_merge_failed": "❌ Não foi possível mesclar: {reason}",
  "catalog.merge_usage":
    "⚠️ Uso: `{prefix}catalog merge <id1> <id2>` — o primeiro ID permanece; o segundo é mesclado nele.",
  "catalog.merge_confirm":
    "🔀 Mesclar **{loser}** (#{loserId}) em **{winner}** (#{winnerId})? Pactos, desejos e curtidas serão movidos e a ação não pode ser desfeita.",
  "catalog.merge_ok":
    "🔀 **{loser}** foi mesclado em **{winner}**. Pactos movidos: {pacts} (conflitos: {conflicts}), desejos: {wishes}.",
  "catalog.merge_not_found": "❌ Entidade #{id} não encontrada.",
  "catalog.merge_failed": "❌ Não foi possível mesclar: {reason}",
  "catalog.usage": "Subcomandos: `review` e `merge`.",
  "catalog.reason.NO_IMAGE": "sem imagem",
  "catalog.reason.UNKNOWN_GENDER": "gênero desconhecido",
  "catalog.reason.LEGACY_GENDER": "gênero herdado a confirmar",
  "catalog.reason.ADULT_CONTENT": "conteúdo adulto",
  "catalog.reason.INVALID_NAME": "nome inválido",
  "catalog.reason.LOW_FAVORITES": "poucos favoritos",
  "catalog.reason.DUPLICATE_SUSPECT": "suspeita de duplicata",
  "catalog.reason.REAL_PERSON": "pessoa real",
  "catalog.reason.UNMATCHED_DISABLED_SERIES": "série desativada sem correspondência",
  "catalog.reason.USER_REPORT": "denúncia de usuário",
  "catalog.reason.TAKEDOWN": "pedido de remoção",
  "catalog.reason.OTHER": "outro",
  "catalog.gender.NONBINARY": "Não binário",
  "catalog.gender.UNKNOWN": "Desconhecido",
  "catalog.gender.ITEM": "Item",
};

const EN: Table = {
  "catalog.import_exists": "ℹ️ **{name}** is already in the catalog (*{franchise}*).",
  "catalog.import_review":
    "🕓 **{name}** (*{franchise}*) was added but is awaiting review: {reasons}.\nA moderator must approve it in `/catalog review`.",
  "catalog.import_disabled": "🚫 **{name}** is disabled in the catalog and cannot be imported again.",
  "catalog.suggest_limit":
    "⏳ You already have **{max}** pending suggestions. Wait for moderation before sending new ones.",
  "catalog.suggest_duplicate": '📋 **"{query}"** is already in the moderation queue.',
  "catalog.review_title": "🛡️ Catalog review",
  "catalog.review_empty": "✅ The moderation queue is empty.",
  "catalog.review_footer": "Queue #{id} • item {position} of {total}",
  "catalog.review_field_reason": "Reason",
  "catalog.review_field_entity": "Entity",
  "catalog.review_field_series": "Series",
  "catalog.review_field_gender": "Gender",
  "catalog.review_field_status": "Status",
  "catalog.review_field_favorites": "Source favorites",
  "catalog.review_field_other": "Possible duplicate of",
  "catalog.review_field_pending": "Other pending reasons",
  "catalog.review_hint_waive": "Approving keeps the entity in the catalog; rejecting disables it.",
  "catalog.review_hint_duplicate":
    "Merge absorbs this entity into the existing one; “not a duplicate” keeps both.",
  "catalog.review_hint_report": "Approving the report disables the entity; rejecting dismisses it.",
  "catalog.review_btn_approve": "Approve",
  "catalog.review_btn_reject": "Reject",
  "catalog.review_btn_name": "Fix name",
  "catalog.review_btn_merge": "Merge duplicate",
  "catalog.review_btn_not_dup": "Not a duplicate",
  "catalog.review_gender_placeholder": "Set gender…",
  "catalog.review_name_modal_title": "Fix name",
  "catalog.review_name_modal_label": "New name ({min} to {max} characters)",
  "catalog.review_approved": "✅ Item #{id} approved.",
  "catalog.review_activated": "✅ **{entity}** was activated in the catalog.",
  "catalog.review_rejected": "❌ Item #{id} rejected.",
  "catalog.review_disabled": "🚫 **{entity}** was disabled.",
  "catalog.review_merged": "🔀 **{loser}** was merged into **{winner}**.",
  "catalog.review_not_dup": "↔️ Item #{id}: marked as not a duplicate.",
  "catalog.review_gender_set": "⚧ Gender of **{entity}** set to **{gender}**.",
  "catalog.review_name_set": "✏️ Name updated to **{name}**.",
  "catalog.review_invalid_name": "❌ Invalid name: use {min} to {max} characters.",
  "catalog.review_blocked_gender": "⚠️ Set the gender before approving this item.",
  "catalog.review_blocked_image":
    "⚠️ The entity has no active image: you can only reject it or wait for the next sync.",
  "catalog.review_stale": "ℹ️ This item was already handled by another moderator.",
  "catalog.review_merge_failed": "❌ Could not merge: {reason}",
  "catalog.merge_usage":
    "⚠️ Usage: `{prefix}catalog merge <id1> <id2>` — the first ID stays; the second is merged into it.",
  "catalog.merge_confirm":
    "🔀 Merge **{loser}** (#{loserId}) into **{winner}** (#{winnerId})? Pacts, wishes and likes will be moved and this cannot be undone.",
  "catalog.merge_ok":
    "🔀 **{loser}** was merged into **{winner}**. Pacts moved: {pacts} (conflicts: {conflicts}), wishes: {wishes}.",
  "catalog.merge_not_found": "❌ Entity #{id} not found.",
  "catalog.merge_failed": "❌ Could not merge: {reason}",
  "catalog.usage": "Subcommands: `review` and `merge`.",
  "catalog.reason.NO_IMAGE": "no image",
  "catalog.reason.UNKNOWN_GENDER": "unknown gender",
  "catalog.reason.LEGACY_GENDER": "legacy gender to confirm",
  "catalog.reason.ADULT_CONTENT": "adult content",
  "catalog.reason.INVALID_NAME": "invalid name",
  "catalog.reason.LOW_FAVORITES": "low favorites",
  "catalog.reason.DUPLICATE_SUSPECT": "duplicate suspect",
  "catalog.reason.REAL_PERSON": "real person",
  "catalog.reason.UNMATCHED_DISABLED_SERIES": "unmatched disabled series",
  "catalog.reason.USER_REPORT": "user report",
  "catalog.reason.TAKEDOWN": "takedown request",
  "catalog.reason.OTHER": "other",
  "catalog.gender.NONBINARY": "Non-binary",
  "catalog.gender.UNKNOWN": "Unknown",
  "catalog.gender.ITEM": "Item",
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

/** Rotulo do motivo de moderacao. */
export function reasonLabel(locale: Locale | string | undefined, reason: string): string {
  return msg(locale, `catalog.reason.${reason}`);
}

/** Rotulo do genero (FEMALE/MALE/NONBINARY/ITEM/UNKNOWN; BOTH do JSON antigo tambem existe). */
export function genderLabel(locale: Locale | string | undefined, gender: string): string {
  return msg(locale, `catalog.gender.${gender}`);
}
