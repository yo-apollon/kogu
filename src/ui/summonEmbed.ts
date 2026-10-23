/**
 * Embed de invocacao no formato Mudae: a imagem traz so a arte; toda informacao vai no embed.
 * Funcoes puras: o chamador gera a arte (skin `mudae`) e a anexa como `attachment://<attachmentName>`.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { ENTITY_TIERS, type CardVariant, type EntityTier } from "../config/gacha.js";
import { DEFAULT_LOCALE } from "../config/constants.js";
import { t, type TranslationKey } from "../i18n/index.js";
import { emoji, genderEmoji, variantEmoji } from "./emojis.js";
import { escapeMarkdown, formatNumber, truncate } from "./format.js";
import { STATE_COLORS, VARIANT_PALETTES } from "./tokens.js";

export type SummonUniverse = "ANIME" | "GAME" | "CINEMA" | "MYTHOLOGY" | "ORIGINAL" | "WEAPON";

export interface SummonView {
  name: string;
  /** Serie / franquia. */
  franchise: string;
  gender?: string | null;
  universe: SummonUniverse | string;
  aetherValue: number;
  awakeningKeys?: number;
  claimRank?: number;
  likeRank?: number;
  tier: EntityTier;
  variant: CardVariant;
  /** Nota/alias do dono (negrito + italico). */
  ownerNote?: string;
  /** Frase do dono (entre aspas, negrito). */
  ownerPhrase?: string;
  /** Imagem propria do dono; `customPicIndex` (padrao 1) aparece em "(Custom Pic N)". */
  hasCustomPic?: boolean;
  customPicIndex?: number;
  /** Sem dono => carta livre (cor neutra, sem footer de dono). */
  ownerName?: string;
  ownerAvatarUrl?: string;
  ownerEmbedColor?: number;
  /** Chaves de despertar usadas / limite do pacto do dono (ex.: 40 / 40). */
  ownerKeys?: number;
  /** Posicao do dono, entre colchetes no footer. */
  ownerPosition?: number;
}

export interface SummonEmbedOptions {
  locale?: string;
  /** Nome do anexo da arte. Padrao: card.webp. */
  attachmentName?: string;
  /** Limite configuravel do pacto (padrao 40). */
  pactLimit?: number;
}

export const DEFAULT_PACT_LIMIT = 40;
/** Amarelo padrao do dono (mesmo da paleta HOLO). */
export const DEFAULT_OWNER_COLOR = VARIANT_PALETTES.HOLO.embed;
/** Cor neutra escura da carta livre. */
export const FREE_CARD_COLOR = STATE_COLORS.claimed;

const ROULETTE_KEY: Record<string, TranslationKey> = {
  ANIME: "summon.roulette_anime",
  GAME: "summon.roulette_game",
  CINEMA: "summon.roulette_cinema",
};

/**
 * Regra do poder (+N): floor(eter / 20) + 5 por degrau de tier (COMMON +0 ... MYTHIC +20).
 * Ex.: 380 de Eter, COMMON => +19 (igual ao exemplo do Mudae).
 */
export function powerOf(aetherValue: number, tier: EntityTier): number {
  const base = Math.floor(Math.max(0, Number.isFinite(aetherValue) ? aetherValue : 0) / 20);
  return base + 5 * Math.max(0, ENTITY_TIERS.indexOf(tier));
}

function powerKind(tier: EntityTier, locale: string): string {
  return t(`summon.power_${tier.toLowerCase()}` as TranslationKey, locale);
}

/** Divisor ornamental com o emoji da variante ao centro. */
export function summonDivider(center: string): string {
  return `━━━━━━━•·༺${center}༻·•━━━━━━━`;
}

export function buildSummonEmbed(view: SummonView, opts: SummonEmbedOptions = {}): { embed: EmbedBuilder; attachmentName: string } {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const attachmentName = opts.attachmentName ?? "card.webp";
  const pactLimit = opts.pactLimit ?? DEFAULT_PACT_LIMIT;
  const owned = Boolean(view.ownerName);

  const rouletteKey = ROULETTE_KEY[view.universe] ?? "summon.roulette_dimensional";
  const keys = view.awakeningKeys ?? 0;
  const lines: string[] = [];

  lines.push(`${truncate(view.franchise, 100)} ${genderEmoji(view.gender)}`);

  const stats = [`*${t(rouletteKey, locale)}*`, `**${formatNumber(view.aetherValue, locale)}** ${emoji("aether")}`];
  if (keys > 0) stats.push(`${emoji("key")} (${keys})`);
  lines.push(stats.join("  ·  "));

  if (view.claimRank !== undefined) lines.push(t("summon.pact_rank", locale, { rank: `#${view.claimRank}` }));
  if (view.likeRank !== undefined) lines.push(t("summon.like_rank", locale, { rank: `#${view.likeRank}` }));

  lines.push(`${powerKind(view.tier, locale)} (+${powerOf(view.aetherValue, view.tier)})`);

  if (view.ownerNote) lines.push(`***${escapeMarkdown(truncate(view.ownerNote, 100))}***`);
  if (view.ownerNote || view.ownerPhrase) lines.push(summonDivider(variantEmoji(view.variant)));
  if (view.ownerPhrase) lines.push(`**"${escapeMarkdown(truncate(view.ownerPhrase, 200))}"**`);
  if (view.hasCustomPic) lines.push(t("summon.custom_pic", locale, { n: view.customPicIndex ?? 1 }));

  const embed = new EmbedBuilder()
    .setColor(owned ? (view.ownerEmbedColor ?? DEFAULT_OWNER_COLOR) : FREE_CARD_COLOR)
    .setAuthor({ name: truncate(view.name, 256) })
    .setDescription(lines.join("\n"))
    .setImage(`attachment://${attachmentName}`);

  if (owned) {
    embed.setFooter({
      text: t("summon.belongs_to", locale, {
        owner: truncate(view.ownerName!, 64),
        keys: view.ownerKeys ?? 0,
        limit: pactLimit,
        pos: view.ownerPosition ?? 1,
      }),
      iconURL: view.ownerAvatarUrl,
    });
  } else {
    embed.setFooter({ text: t("summon.free_for_pact", locale) });
  }
  return { embed, attachmentName };
}

export interface SummonButtonOptions {
  /** Inclui o botao da orbe de Eter. */
  orb?: boolean;
  /** Desabilita todos (carta ja reivindicada/expirada). */
  disabled?: boolean;
}

/** Fileira so de emojis (reacoes do Mudae): pacto, like e, opcionalmente, orbe. customIds `sm:<acao>:<offerId>`. */
export function buildSummonButtons(offerId: string, opts: SummonButtonOptions = {}): ActionRowBuilder<ButtonBuilder> {
  const mk = (action: "pact" | "like" | "orb", e: string) =>
    new ButtonBuilder()
      .setCustomId(`sm:${action}:${offerId}`)
      .setEmoji(e)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(opts.disabled === true);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(mk("pact", emoji("pact")), mk("like", emoji("like")));
  if (opts.orb) row.addComponents(mk("orb", emoji("orb")));
  return row;
}
