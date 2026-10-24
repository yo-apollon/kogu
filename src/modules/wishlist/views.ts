/**
 * Apresentacao da Lista de Desejos: embeds, linhas, escolhas de autocomplete e textos.
 *
 * i18n: usa as chaves `wishlist.*` existentes. As chaves que ainda nao existem em locales/*.json ficam em
 * `FALLBACK_TEXT` (pt-BR/en-US) e so valem enquanto a chave nao estiver no JSON: `tr()` prefere sempre
 * o locale quando ele a possui.
 */
import type { EmbedBuilder } from "discord.js";
import type { Locale } from "../../config/constants.js";
import type { CommandContext } from "../../core/contracts.js";
import { hasKey, t } from "../../i18n/index.js";
import { UserError } from "../../lib/errors.js";
import { errorEmbed, infoEmbed, successEmbed } from "../../ui/embeds.js";
import { emoji } from "../../ui/emojis.js";
import { escapeMarkdown, formatNumber, truncate } from "../../ui/format.js";
import { pageIndicator, type PageContent } from "../../ui/components/paginator.js";
import { entityRefValue, WISH_LIMIT, type EntityHit, type WishEntry, type WishResult } from "./service.js";

type Params = Record<string, string | number>;

/** Chaves propostas (ainda ausentes de locales/*.json). */
export const FALLBACK_TEXT: Record<string, Record<Locale, string>> = {
  "wishlist.already_added": {
    "pt-BR": "ℹ️ **{entity}** já está na sua Lista de Desejos.",
    "en-US": "ℹ️ **{entity}** is already on your Wishlist.",
  },
  "wishlist.not_in_list": {
    "pt-BR": '❌ **"{query}"** não está na sua Lista de Desejos.',
    "en-US": '❌ **"{query}"** is not on your Wishlist.',
  },
  "wishlist.starwish_limit_reached": {
    "pt-BR":
      "❌ Você já usou todos os seus Desejos Estelares ({max}/{max}). Remova um para definir outro.",
    "en-US": "❌ You have used all your Starwishes ({max}/{max}). Remove one to set another.",
  },
};

function fill(text: string, params: Params): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Traduz `key`; se a chave nao existir no locale, usa o texto local de `FALLBACK_TEXT`. */
export function tr(locale: Locale, key: string, params: Params = {}): string {
  if (hasKey(key, locale)) return t(key, locale, params);
  const fallback = FALLBACK_TEXT[key];
  return fallback ? fill(fallback[locale], params) : key;
}

/**
 * Se `err` e um `UserError` cuja chave ainda nao esta nos locales, responde com o texto local e
 * devolve `true`; senao devolve `false` (o chamador relanca e o errorBoundary trata).
 */
export async function replyFallbackError(
  ctx: Pick<CommandContext, "reply" | "locale">,
  err: unknown
): Promise<boolean> {
  if (!(err instanceof UserError)) return false;
  if (hasKey(err.key, ctx.locale) || !FALLBACK_TEXT[err.key]) return false;
  await ctx.reply({
    embeds: [
      errorEmbed({
        description: tr(ctx.locale, err.key, err.params),
        locale: ctx.locale,
        footer: false,
      }),
    ],
    ephemeral: true,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Slash
// ---------------------------------------------------------------------------

export const SLASH_TEXT: Record<
  Locale,
  {
    add: string;
    remove: string;
    list: string;
    entityOption: string;
    starwish: string;
  }
> = {
  "pt-BR": {
    add: "Adiciona uma entidade à sua Lista de Desejos.",
    remove: "Remove uma entidade da sua Lista de Desejos.",
    list: "Mostra a sua Lista de Desejos.",
    entityOption: "Nome da entidade (busque e escolha na lista).",
    starwish: "Define um Desejo Estelar.",
  },
  "en-US": {
    add: "Adds an entity to your Wishlist.",
    remove: "Removes an entity from your Wishlist.",
    list: "Shows your Wishlist.",
    entityOption: "Entity name (search and pick from the list).",
    starwish: "Sets a Starwish.",
  },
};

/** Opcao de autocomplete: `Nome · Serie` com valor `id:<entityId>`. */
export function entityChoice(hit: EntityHit): { name: string; value: string } {
  const label = hit.seriesTitle ? `${hit.name} · ${hit.seriesTitle}` : hit.name;
  return { name: truncate(label, 100), value: entityRefValue(hit.id) };
}

// ---------------------------------------------------------------------------
// Embeds
// ---------------------------------------------------------------------------

export interface WishlistViewInput {
  locale: Locale;
  userName: string;
  prefix: string;
  pageSize: number;
}

/** Nome da obra exibido na linha: serie primaria, senao a franquia, senao "Desconhecido". */
export function wishFranchise(entry: WishEntry, locale: Locale): string {
  return entry.seriesTitle ?? entry.franchiseName ?? t("common.unknown", locale);
}

/** Uma pagina da lista (usada como `renderPage` do paginator). */
export function renderWishlistPage(
  entries: readonly WishEntry[],
  page: number,
  totalPages: number,
  total: number,
  view: WishlistViewInput
): PageContent {
  const { locale } = view;
  const offset = (page - 1) * view.pageSize;
  const lines = entries.map((entry, index) =>
    tr(locale, "wishlist.line", {
      rank: offset + index + 1,
      icon: emoji(entry.isStarwish ? "starwish" : "wish"),
      name: escapeMarkdown(entry.name),
      franchise: escapeMarkdown(wishFranchise(entry, locale)),
      aether: formatNumber(entry.baseAether, locale),
    })
  );
  const footer = tr(locale, "wishlist.footer", { prefix: view.prefix });
  return {
    embeds: [
      infoEmbed({
        title: tr(locale, "wishlist.title", {
          user: escapeMarkdown(view.userName),
          count: total,
          max: WISH_LIMIT,
        }),
        description: lines.join("\n"),
        footer: totalPages > 1 ? `${footer} • ${pageIndicator(page, totalPages, locale)}` : footer,
        icon: false,
      }),
    ],
  };
}

export function emptyWishlistEmbed(locale: Locale, prefix: string): EmbedBuilder {
  return infoEmbed({ description: tr(locale, "wishlist.empty", { prefix }), icon: false });
}

/** Resposta de `add` / `toggle` conforme o resultado da operacao. */
export function wishResultEmbed(
  locale: Locale,
  result: WishResult,
  entity: EntityHit
): EmbedBuilder {
  const entityName = escapeMarkdown(entity.name);
  const franchise = escapeMarkdown(entity.seriesTitle ?? t("common.unknown", locale));
  switch (result.status) {
    case "removed":
      return successEmbed(tr(locale, "wishlist.removed", { entity: entityName }));
    case "exists":
      return infoEmbed({
        description: tr(locale, "wishlist.already_added", { entity: entityName }),
        icon: false,
      });
    case "upgraded":
      return successEmbed(tr(locale, "wishlist.starwish_added", { entity: entityName, franchise }));
    case "added":
      return successEmbed(
        tr(locale, result.isStarwish ? "wishlist.starwish_added" : "wishlist.added", {
          entity: entityName,
          franchise,
        })
      );
  }
}

export function removedEmbed(locale: Locale, entityName: string): EmbedBuilder {
  return successEmbed(tr(locale, "wishlist.removed", { entity: escapeMarkdown(entityName) }));
}
