/**
 * Views do Panteao: embeds e textos puros (sem I/O). O chamador monta o paginador, renderiza a arte
 * e envia.
 */
import type { EmbedBuilder } from "discord.js";
import type { RenderCardInput } from "../../canvas/index.js";
import { t } from "../../i18n/index.js";
import { baseEmbed } from "../../ui/embeds.js";
import { emoji, variantEmoji } from "../../ui/emojis.js";
import { escapeMarkdown, formatNumber, truncate } from "../../ui/format.js";
import { BRAND_COLOR } from "../../ui/tokens.js";
import type { SummonView } from "../../ui/summonEmbed.js";
import { calculateAetherValue, pactAetherValue } from "../summon/variants.js";
import type { PantheonDisplay, PantheonQuery } from "./flags.js";
import type { EntityHit, EntityInfo, OwnPactChoice, PantheonPage, PantheonRow } from "./service.js";

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
  return {
    name: info.name,
    franchise: info.seriesTitle ?? t("catalog.default_universe", opts.locale),
    gender: info.gender,
    universe: info.universe,
    aetherValue: infoAetherValue(info),
    awakeningKeys: pact?.awakeningKeys ?? 0,
    claimRank: info.claimRank ?? info.popularityRank ?? undefined,
    likeRank: info.likeRank ?? undefined,
    tier: info.tier,
    variant: pact?.variant ?? "STANDARD",
    ownerNote: pact?.note ?? pact?.alias ?? undefined,
    hasCustomPic: pact?.hasCustomImage ?? false,
    ownerName: pact ? pact.ownerName || t("summon.unknown_owner", opts.locale) : undefined,
    ownerAvatarUrl: pact ? opts.ownerAvatarUrl : undefined,
    ownerEmbedColor: parseHexColor(pact?.ownerEmbedColor),
    ownerKeys: pact?.awakeningKeys,
    ownerPosition: pact?.position,
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
  const label = hit.series ? `${hit.name} · ${hit.series}` : hit.name;
  return { name: truncate(label, 100), value: `id:${hit.id}` };
}

export function pactChoice(pact: OwnPactChoice): AutocompleteChoice {
  const label = pact.series ? `${pact.name} · ${pact.series}` : pact.name;
  return { name: truncate(label, 100), value: `pact:${pact.pactId}` };
}
