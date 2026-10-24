/**
 * Views do modulo CATALOG: embeds de importacao/sugestoes, painel de revisao e codec dos customIds
 * do namespace `cr`. Funcoes puras (sem banco): recebem dados ja carregados.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type EmbedBuilder,
} from "discord.js";
import type { Locale } from "../../config/constants.js";
import { decodeCustomId, encodeCustomId } from "../../core/customId.js";
import { NAME_MAX_CHARS, NAME_MIN_CHARS } from "../../catalog/quarantine.js";
import { t } from "../../i18n/index.js";
import { emoji } from "../../ui/emojis.js";
import { baseEmbed, errorEmbed, infoEmbed, successEmbed, warnEmbed } from "../../ui/embeds.js";
import { formatNumber, truncate } from "../../ui/format.js";
import { genderLabel, msg, reasonLabel } from "./messages.js";
import { SETTABLE_GENDERS, type QueueItem, type ReviewOutcome } from "./review.js";
import type { ImportOutcome } from "./service.js";

/** Namespace dos componentes do painel `/catalog review`. */
export const CATALOG_REVIEW_NS = "cr";

export type ReviewControl = "prev" | "next" | "ind" | "ok" | "no" | "nm" | "gn" | "nmm";

const CONTROLS: ReadonlySet<string> = new Set<ReviewControl>([
  "prev",
  "next",
  "ind",
  "ok",
  "no",
  "nm",
  "gn",
  "nmm",
]);

export function reviewCustomId(control: ReviewControl, itemId: number): string {
  return encodeCustomId(CATALOG_REVIEW_NS, control, itemId);
}

/** `parts` ja sem o namespace (como chega ao ComponentHandler). null se invalido. */
export function parseReviewParts(parts: readonly string[]): { control: ReviewControl; itemId: number } | null {
  const [control, rawId] = parts;
  if (!control || !CONTROLS.has(control) || !rawId || !/^\d{1,15}$/.test(rawId)) return null;
  return { control: control as ReviewControl, itemId: Number(rawId) };
}

/** Conveniencia para testes: decodifica o customId completo. */
export function parseReviewCustomId(customId: string) {
  const decoded = decodeCustomId(customId);
  if (!decoded || decoded.ns !== CATALOG_REVIEW_NS) return null;
  return parseReviewParts(decoded.parts);
}

/* ------------------------------------------------------------------ */
/* Importacao                                                         */
/* ------------------------------------------------------------------ */

type Found = Exclude<ImportOutcome, { kind: "not_found" }>;

export function importEmbed(outcome: Found, locale: Locale): EmbedBuilder {
  const e = outcome.entity;
  const params = { name: e.name, franchise: e.franchise };
  const thumbnail = e.imageUrl ?? undefined;
  if (outcome.kind === "disabled") {
    return warnEmbed({ description: msg(locale, "catalog.import_disabled", params), thumbnail });
  }
  if (e.status !== "ACTIVE") {
    const reasons =
      e.pendingReasons.length > 0
        ? [...new Set(e.pendingReasons)].map((r) => reasonLabel(locale, r)).join(", ")
        : "—";
    return warnEmbed({
      description: msg(locale, "catalog.import_review", { ...params, reasons }),
      thumbnail,
    });
  }
  if (outcome.kind === "exists") {
    return infoEmbed({ description: msg(locale, "catalog.import_exists", params), thumbnail });
  }
  return successEmbed({
    description: msg(locale, "catalog.import_success", {
      ...params,
      aether: formatNumber(e.aether, locale),
    }),
    thumbnail,
  });
}

/* ------------------------------------------------------------------ */
/* Sugestoes                                                          */
/* ------------------------------------------------------------------ */

export interface SuggestionLine {
  characterName: string;
  userId: string;
}

/** Nome dentro de ``crase``: troca a crase por apostrofo para nao quebrar a formatacao. */
export function safeInlineName(name: string): string {
  return name.replace(/`/g, "'").replace(/\s+/g, " ").trim();
}

export function suggestionListEmbed(input: {
  rows: readonly SuggestionLine[];
  total: number;
  offset: number;
  prefix: string;
  locale: Locale;
  pageLabel?: string;
}): EmbedBuilder {
  const { locale } = input;
  const lines = input.rows.map((row, i) =>
    msg(locale, "catalog.suggest_list_line", {
      rank: input.offset + i + 1,
      name: safeInlineName(row.characterName),
      userId: row.userId,
    })
  );
  const footer = [msg(locale, "catalog.suggest_list_footer", { prefix: input.prefix }), input.pageLabel]
    .filter(Boolean)
    .join(" • ");
  return baseEmbed({
    title: msg(locale, "catalog.suggest_list_title", { count: input.total }),
    description: lines.join("\n"),
    footer,
  });
}

/* ------------------------------------------------------------------ */
/* Painel de revisao                                                  */
/* ------------------------------------------------------------------ */

export interface ReviewView {
  content?: string;
  embeds: EmbedBuilder[];
  components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
}

export interface ReviewViewInput {
  /** null = fila vazia. */
  item: QueueItem | null;
  position: number;
  total: number;
  locale: Locale;
  /** Linha de resultado da acao anterior (vai em `content`). */
  notice?: string;
}

function detailsText(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (key === "autoResolved" || key.startsWith("manual")) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}: ${value}`);
    }
  }
  return truncate(parts.join(", "), 200);
}

export function reviewView(input: ReviewViewInput): ReviewView {
  const { item, locale } = input;
  if (!item) {
    return {
      content: input.notice,
      embeds: [
        successEmbed({
          title: msg(locale, "catalog.review_title"),
          description: msg(locale, "catalog.review_empty"),
          icon: false,
          footer: false,
        }),
      ],
      components: [],
    };
  }

  const entity = item.entity;
  const hint =
    item.kind === "duplicate"
      ? msg(locale, "catalog.review_hint_duplicate")
      : item.kind === "report"
        ? msg(locale, "catalog.review_hint_report")
        : item.kind === "waive"
          ? msg(locale, "catalog.review_hint_waive")
          : "";

  const embed = infoEmbed({
    title: msg(locale, "catalog.review_title"),
    description: [`**${reasonLabel(locale, item.reason)}**`, hint].filter(Boolean).join("\n"),
    icon: false,
    footer: msg(locale, "catalog.review_footer", {
      id: item.id,
      position: input.position,
      total: input.total,
    }),
    thumbnail: entity?.imageUrl ?? undefined,
  });

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (entity) {
    fields.push({
      name: msg(locale, "catalog.review_field_entity"),
      value: truncate(
        `**${entity.name}** (#${entity.id})${entity.nameNative ? `\n${entity.nameNative}` : ""}`,
        1024
      ),
    });
    const seriesText = [entity.franchise, entity.seriesTitle]
      .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
      .join(" / ");
    if (seriesText) {
      fields.push({
        name: msg(locale, "catalog.review_field_series"),
        value: truncate(seriesText, 1024),
        inline: true,
      });
    }
    fields.push(
      {
        name: msg(locale, "catalog.review_field_gender"),
        value: genderLabel(locale, entity.gender),
        inline: true,
      },
      { name: msg(locale, "catalog.review_field_status"), value: entity.status, inline: true },
      {
        name: msg(locale, "catalog.review_field_favorites"),
        value: formatNumber(entity.sourceFavorites, locale),
        inline: true,
      }
    );
  }
  if (item.other) {
    fields.push({
      name: msg(locale, "catalog.review_field_other"),
      value: truncate(`**${item.other.name}** (#${item.other.id}) — ${item.other.status}`, 1024),
    });
  }
  if (item.siblingReasons.length > 0) {
    fields.push({
      name: msg(locale, "catalog.review_field_pending"),
      value: truncate(
        [...new Set(item.siblingReasons)].map((r) => reasonLabel(locale, r)).join(", "),
        1024
      ),
    });
  }
  const details = detailsText(item.details);
  if (details) fields.push({ name: "Info", value: details });
  embed.addFields(fields);

  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(reviewCustomId("prev", item.id))
      .setEmoji(emoji("nav.prev"))
      .setLabel(t("ui.paginator.prev", locale))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(reviewCustomId("ind", item.id))
      .setLabel(`${input.position}/${input.total}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(reviewCustomId("next", item.id))
      .setEmoji(emoji("nav.next"))
      .setLabel(t("ui.paginator.next", locale))
      .setStyle(ButtonStyle.Secondary)
  );

  const duplicate = item.kind === "duplicate";
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(reviewCustomId("ok", item.id))
      .setLabel(msg(locale, duplicate ? "catalog.review_btn_merge" : "catalog.review_btn_approve"))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(reviewCustomId("no", item.id))
      .setLabel(msg(locale, duplicate ? "catalog.review_btn_not_dup" : "catalog.review_btn_reject"))
      .setStyle(duplicate ? ButtonStyle.Primary : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(reviewCustomId("nm", item.id))
      .setLabel(msg(locale, "catalog.review_btn_name"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!entity)
  );

  const components: ReviewView["components"] = [nav, actions];
  if (entity) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(reviewCustomId("gn", item.id))
          .setPlaceholder(
            `${msg(locale, "catalog.review_gender_placeholder")} (${genderLabel(locale, entity.gender)})`
          )
          .addOptions(SETTABLE_GENDERS.map((g) => ({ label: genderLabel(locale, g), value: g })))
      )
    );
  }

  return { content: input.notice, embeds: [embed], components };
}

export function nameModal(itemId: number, currentName: string, locale: Locale): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(reviewCustomId("nmm", itemId))
    .setTitle(msg(locale, "catalog.review_name_modal_title"))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel(
            truncate(
              msg(locale, "catalog.review_name_modal_label", {
                min: NAME_MIN_CHARS,
                max: NAME_MAX_CHARS,
              }),
              45
            )
          )
          .setStyle(TextInputStyle.Short)
          .setMinLength(NAME_MIN_CHARS)
          .setMaxLength(NAME_MAX_CHARS)
          .setValue(Array.from(currentName).slice(0, NAME_MAX_CHARS).join(""))
          .setRequired(true)
      )
    );
}

/** Texto da resposta a uma decisao do painel (vai em `content`). */
export function outcomeNotice(outcome: ReviewOutcome, itemId: number, locale: Locale): string {
  if (!outcome.ok) {
    switch (outcome.code) {
      case "blocked_gender":
        return msg(locale, "catalog.review_blocked_gender");
      case "blocked_image":
        return msg(locale, "catalog.review_blocked_image");
      case "invalid_name":
        return msg(locale, "catalog.review_invalid_name", {
          min: NAME_MIN_CHARS,
          max: NAME_MAX_CHARS,
        });
      case "merge_failed":
        return msg(locale, "catalog.review_merge_failed", { reason: outcome.reason ?? "?" });
      default:
        return msg(locale, "catalog.review_stale");
    }
  }
  const entity = outcome.entityName ?? "";
  const lines: string[] = [];
  switch (outcome.action) {
    case "merged":
      lines.push(
        msg(locale, "catalog.review_merged", {
          loser: outcome.name ?? "",
          winner: outcome.winnerName ?? entity,
        })
      );
      break;
    case "rejected":
      lines.push(
        outcome.disabled
          ? msg(locale, "catalog.review_disabled", { entity })
          : msg(locale, "catalog.review_rejected", { id: itemId })
      );
      break;
    case "dismissed":
      lines.push(msg(locale, "catalog.review_rejected", { id: itemId }));
      break;
    case "not_duplicate":
      lines.push(msg(locale, "catalog.review_not_dup", { id: itemId }));
      break;
    case "gender":
      lines.push(
        msg(locale, "catalog.review_gender_set", {
          entity,
          gender: genderLabel(locale, outcome.gender ?? "UNKNOWN"),
        })
      );
      break;
    case "renamed":
      lines.push(msg(locale, "catalog.review_name_set", { name: outcome.name ?? entity }));
      break;
    default:
      lines.push(
        outcome.disabled
          ? msg(locale, "catalog.review_disabled", { entity })
          : msg(locale, "catalog.review_approved", { id: itemId })
      );
  }
  if (outcome.activated) lines.push(msg(locale, "catalog.review_activated", { entity }));
  return lines.join("\n");
}

/** Resposta de erro simples (ephemeral). */
export function errorPayload(locale: Locale, description: string) {
  return { embeds: [errorEmbed({ description, locale, footer: false })], ephemeral: true as const };
}
