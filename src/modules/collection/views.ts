/**
 * Views do Panteao: embeds e textos puros (sem I/O). O chamador monta o paginador, renderiza a arte
 * e envia.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from "discord.js";
import type { RenderCardInput } from "../../canvas/index.js";
import { EDITION_LABEL, type EntityEdition } from "../../config/gacha.js";
import { encodeCustomId } from "../../core/customId.js";
import { t } from "../../i18n/index.js";
import { baseEmbed } from "../../ui/embeds.js";
import { emoji, variantEmoji } from "../../ui/emojis.js";
import { escapeMarkdown, formatNumber, truncate } from "../../ui/format.js";
import { BRAND_COLOR, resolveCardEmbedColor } from "../../ui/tokens.js";
import type { SummonView } from "../../ui/summonEmbed.js";
import { calculateAetherValue, pactAetherValue } from "../summon/variants.js";
import type { PantheonDisplay, PantheonQuery } from "./flags.js";
import type { EditionVariant, EntityHit, EntityInfo, OwnPactChoice, PantheonPage, PantheonRow } from "./service.js";

export const COLLECTION_NAMESPACE = "col";

/** Nome seguro para markdown, com limite de tamanho. */
export function safeText(value: string, max = 60): string {
  return escapeMarkdown(truncate(value, max));
}

// ---------------------------------------------------------------------------
// Panteao
// ---------------------------------------------------------------------------

export function pantheonLine(
  row: PantheonRow,
  position: number,
  display: PantheonDisplay,
  locale: string
): string {
  const parts: string[] = [
    `**${position}.**`,
    variantEmoji(row.variant),
    `**${safeText(row.name)}**`,
  ];
  // Edicoes repetem o nome: o rotulo curto da edicao (Basica/Epica/Mitica) distingue as cartas.
  if (row.edition && row.edition in EDITION_LABEL) {
    parts.push(`*[${t(EDITION_LABEL[row.edition as EntityEdition], locale)}]*`);
  }
  if (row.awakeningKeys > 0) parts.push(`\`★${row.awakeningKeys}\``);
  const nick = row.alias ?? row.alias2;
  if (nick && !display.compact) parts.push(`*(${safeText(nick, 30)})*`);
  if (!display.compact && row.seriesTitle) {
    parts.push(`— \`${truncate(row.seriesTitle.replace(/`/g, "'"), 40)}\``);
  }
  const aether = display.baseAether ? row.baseAether : row.value;
  parts.push(`(${emoji("aether")} ${formatNumber(aether, locale)})`);
  if (display.claimRank && row.claimRank !== null) parts.push(`${emoji("rank")} #${row.claimRank}`);
  if (display.likeRank && row.likeRank !== null) parts.push(`${emoji("like")} #${row.likeRank}`);
  return parts.join(" ");
}

export interface PantheonEmbedInput {
  userName: string;
  rows: readonly PantheonRow[];
  /** Pagina atual (base 1) e total de paginas. */
  page: number;
  totalPages: number;
  pageSize: number;
  query: PantheonQuery;
  /** Total/soma/lider vindos de `listPantheon`. */
  summary: Pick<PantheonPage, "total" | "totalAether" | "leaderName">;
  filtered: boolean;
  locale: string;
}

export function buildPantheonEmbed(input: PantheonEmbedInput): EmbedBuilder {
  const { rows, summary, locale } = input;
  const title = t("collection.pantheon_title", locale, {
    user: truncate(input.userName, 40),
    count: summary.total,
  });

  let description: string;
  if (rows.length === 0) {
    description = t(input.filtered ? "collection.pantheon_empty_filter" : "pantheon.empty", locale);
  } else {
    const offset = (input.page - 1) * input.pageSize;
    const header: string[] = [];
    if (summary.leaderName) {
      header.push(t("pantheon.champion", locale, { name: safeText(summary.leaderName) }));
    }
    header.push(
      t("pantheon.total_aether", locale, { value: formatNumber(summary.totalAether, locale) })
    );
    const lines = rows.map((row, i) =>
      pantheonLine(row, offset + i + 1, input.query.display, locale)
    );
    description = `${header.join("\n")}\n\n${lines.join("\n")}`;
  }

  return baseEmbed({
    title,
    description,
    color: BRAND_COLOR,
    footer: t("ui.paginator.page", locale, { page: input.page, total: input.totalPages }),
  });
}

// ---------------------------------------------------------------------------
// $info
// ---------------------------------------------------------------------------

/** "#5865F2" ou "5865f2" -> 0x5865f2; invalido -> undefined. */
export function parseHexColor(hex: string | null | undefined): number | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1], 16) : undefined;
}

/** Valor mostrado: do pacto (nunca abaixo do registrado) ou o Eter base da carta livre. */
export function infoAetherValue(info: EntityInfo): number {
  const pact = info.pact;
  if (!pact) return calculateAetherValue(info.baseAether, "STANDARD", 0);
  return pactAetherValue(info.baseAether, pact.variant, pact.awakeningKeys, pact.aetherAtBind);
}

export function buildInfoView(
  info: EntityInfo,
  opts: { locale: string; ownerAvatarUrl?: string }
): SummonView {
  const pact = info.pact;
  const franchise = info.seriesTitle ?? t("catalog.default_universe", opts.locale);
  const ownerEmbedColor = parseHexColor(pact?.ownerEmbedColor);
  return {
    name: info.name,
    franchise,
    gender: info.gender,
    universe: info.universe,
    aetherValue: infoAetherValue(info),
    awakeningKeys: pact?.awakeningKeys ?? 0,
    claimRank: info.claimRank ?? info.popularityRank ?? undefined,
    likeRank: info.likeRank ?? undefined,
    tier: info.tier,
    edition: info.edition ?? null,
    variant: pact?.variant ?? "STANDARD",
    alias: pact?.alias ?? undefined,
    ownerNote: pact?.note ?? pact?.alias ?? undefined,
    hasCustomPic: pact?.hasCustomImage ?? false,
    ownerName: pact ? pact.ownerName || t("summon.unknown_owner", opts.locale) : undefined,
    ownerAvatarUrl: pact ? opts.ownerAvatarUrl : undefined,
    ownerEmbedColor,
    ownerKeys: pact?.awakeningKeys,
    ownerPosition: pact?.position,
    cardColor: resolveCardEmbedColor({
      name: info.name,
      franchise,
      tier: info.tier,
      edition: info.edition,
      variant: pact?.variant ?? "STANDARD",
      ownerEmbedColor,
    }),
  };
}

/** Entrada do renderer de cartas (skin mudae: so a arte; as informacoes vao no embed). */
export function cardRenderInput(info: EntityInfo, locale: string): RenderCardInput {
  const pact = info.pact;
  return {
    entityId: String(info.id),
    name: info.name,
    franchise: info.seriesTitle ?? t("catalog.default_universe", locale),
    universe: info.universe,
    tier: info.tier,
    variant: pact?.variant ?? "STANDARD",
    awakeningKeys: pact?.awakeningKeys ?? 0,
    aetherValue: infoAetherValue(info),
    popularityRank: info.popularityRank ?? undefined,
    atk: info.baseAtk,
    def: info.baseDef,
    spd: info.baseSpd,
    ownerName: pact?.ownerName ?? undefined,
    locale,
    imageUrl: pact?.customImage ?? info.imageUrl ?? undefined,
    entityType: info.type,
    slug: info.slug,
    description: info.description ?? undefined,
    trustImage: Boolean(pact?.customImage),
    skinId: "mudae",
  };
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface AutocompleteChoice {
  name: string;
  value: string;
}

/** Choice de entidade: o valor `id:<n>` evita ambiguidade com nomes digitados. */
export function entityChoice(hit: EntityHit): AutocompleteChoice {
  const base = hit.series ? `${hit.name} · ${hit.series}` : hit.name;
  // Edicoes repetem o nome: o tier (neutro de idioma) distingue as opcoes do autocomplete.
  const label = hit.edition ? `${base} · ${hit.tier}` : base;
  return { name: truncate(label, 100), value: `id:${hit.id}` };
}

export function pactChoice(pact: OwnPactChoice): AutocompleteChoice {
  const label = pact.series ? `${pact.name} · ${pact.series}` : pact.name;
  return { name: truncate(label, 100), value: `pact:${pact.pactId}` };
}

// ---------------------------------------------------------------------------
// Botões de Variações e Edições do $im / $info
// ---------------------------------------------------------------------------

export interface BuildInfoActionRowsOptions {
  entityId: number;
  editions: EditionVariant[];
  currentEditionIndex: number;
  images: Array<{ id: number; url: string; isPrimary: boolean }>;
  currentImageIndex: number;
  userId: string;
  locale: string;
}

export function buildInfoActionRows(opts: BuildInfoActionRowsOptions): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const { entityId, editions, currentEditionIndex, images, currentImageIndex, userId, locale } = opts;

  // 1. Linha de Edições da Carta (Básica, Épica, Mítica, etc.)
  if (editions.length > 1) {
    const edButtons: ButtonBuilder[] = [];

    if (editions.length <= 4) {
      // Botões diretos para cada versão sem setas duplicadas (evita DiscordAPIError 50035)
      for (let i = 0; i < editions.length; i++) {
        const ed = editions[i]!;
        const isCurrent = ed.id === entityId || i === currentEditionIndex;
        let shortLabel = t(EDITION_LABEL[ed.edition], locale);
        if (ed.edition === "BASIC") shortLabel = "🔹 Básica";
        else if (ed.edition === "EPIC") shortLabel = "⭐ Épica";
        else if (ed.edition === "MYTHIC") shortLabel = "👑 Mítica";

        if (ed.owned) shortLabel += " ✅";

        edButtons.push(
          new ButtonBuilder()
            .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_ed", ed.id, 0, userId))
            .setLabel(shortLabel)
            .setStyle(isCurrent ? ButtonStyle.Primary : ed.owned ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(isCurrent)
        );
      }
    } else {
      const prevEdIdx = currentEditionIndex > 0 ? currentEditionIndex - 1 : editions.length - 1;
      const nextEdIdx = currentEditionIndex < editions.length - 1 ? currentEditionIndex + 1 : 0;
      const curEd = editions[currentEditionIndex]!;

      edButtons.push(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_ed", editions[prevEdIdx]!.id, 0, userId))
          .setLabel("◀ Anterior")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_cnt", curEd.id, 0, userId))
          .setLabel(`🃏 Versão ${currentEditionIndex + 1}/${editions.length}${curEd.owned ? " ✅" : ""}`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_ed", editions[nextEdIdx]!.id, 0, userId))
          .setLabel("Próxima ▶")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(edButtons));
  }

  // 2. Linha de Artes/Fotos Alternativas da Carta
  if (images.length > 1) {
    const prevImg = currentImageIndex > 0 ? currentImageIndex - 1 : images.length - 1;
    const nextImg = currentImageIndex < images.length - 1 ? currentImageIndex + 1 : 0;

    const imgRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_img", entityId, prevImg, userId))
        .setLabel("◀ Foto")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_cnt", entityId, currentImageIndex, userId))
        .setLabel(`🖼️ Foto #${currentImageIndex + 1}/${images.length}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(COLLECTION_NAMESPACE, "im_img", entityId, nextImg, userId))
        .setLabel("Foto ▶")
        .setStyle(ButtonStyle.Secondary)
    );

    rows.push(imgRow);
  }

  return rows;
}
