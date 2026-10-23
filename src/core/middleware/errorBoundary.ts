/**
 * Primeiro middleware da cadeia: captura tudo.
 * - `UserError`  -> resposta i18n (efemera no slash), sem log de erro.
 * - qualquer outro -> loga com `errorId` e responde `errorEmbed` com o id. Nunca vaza stack/mensagem interna.
 */
import { MessageFlags } from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { t } from "../../i18n/index.js";
import { InfraError, isUserError, newErrorId, UserError } from "../../lib/errors.js";
import { childLogger } from "../../lib/logger.js";
import { errorEmbed } from "../../ui/embeds.js";
import type { ReplyPayload } from "../contracts.js";
import type { Invocation, Middleware } from "../context.js";

const log = childLogger("core:error");

/** Onde e como responder a um erro (comando, componente, modal). */
export interface ErrorTarget {
  reply(payload: ReplyPayload): Promise<unknown>;
  locale: Locale;
  /** Contexto extra para o log (comando, usuario, guilda, namespace...). */
  meta?: Record<string, unknown>;
}

/** Mensagem do `UserError` ja traduzida; anexa a linha de uso quando houver `params.usage`. */
export function renderUserError(err: UserError, locale: Locale): string {
  const { usage, ...params } = err.params;
  let text = t(err.key, locale, params);
  if (usage !== undefined) text += `\n${t("common.usage", locale, { usage: String(usage) })}`;
  return text;
}

/** Trata `err` respondendo ao usuario. Retorna o `errorId` quando o erro era inesperado. */
export async function reportError(err: unknown, target: ErrorTarget): Promise<string | undefined> {
  let payload: ReplyPayload;
  let errorId: string | undefined;

  if (isUserError(err)) {
    payload = {
      embeds: [
        errorEmbed({
          description: renderUserError(err, target.locale),
          locale: target.locale,
          footer: false,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    } as unknown as ReplyPayload;
  } else {
    errorId = err instanceof InfraError ? err.errorId : newErrorId();
    log.error({ err, errorId, ...target.meta }, "erro nao tratado");
    const key = err instanceof InfraError ? "errors.infra" : "errors.unexpected";
    payload = {
      embeds: [errorEmbed({ description: t(key, target.locale), locale: target.locale }, errorId)],
      flags: MessageFlags.Ephemeral,
    } as unknown as ReplyPayload;
  }

  try {
    await target.reply(payload);
  } catch (replyErr) {
    // Interacao expirada, mensagem apagada, sem permissao de envio...
    log.warn({ err: replyErr, errorId, ...target.meta }, "falha ao responder o erro ao usuario");
  }
  return errorId;
}

export function errorBoundary(): Middleware {
  return async (inv: Invocation, next) => {
    try {
      await next();
    } catch (err) {
      await reportError(err, {
        reply: (p) => inv.responder.reply(p),
        locale: inv.locale ?? DEFAULT_LOCALE,
        meta: {
          command: inv.command.name,
          source: inv.source,
          userId: inv.user.id,
          guildId: inv.guild.id,
        },
      });
    }
  };
}
