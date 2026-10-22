/** Builders de embed padronizados. Sempre devolvem `EmbedBuilder`. */
import { EmbedBuilder } from "discord.js";
import { DEFAULT_LOCALE, EMBED_FOOTER, type Locale } from "../config/constants.js";
import { t } from "../i18n/index.js";
import { emoji } from "./emojis.js";
import { truncate } from "./format.js";
import { BRAND_COLOR, colorForState, type UiState } from "./tokens.js";

const TITLE_MAX = 256;
const DESCRIPTION_MAX = 4096;
const FOOTER_MAX = 2048;

export interface EmbedOptions {
  title?: string;
  description?: string;
  /** Cor numerica; padrao vem dos tokens (estado ou marca). */
  color?: number;
  /** Texto do rodape; `false` remove. Padrao: `EMBED_FOOTER`. */
  footer?: string | false;
  footerIconUrl?: string;
  /** `true` = agora; numero (ms) ou Date = instante fixo. */
  timestamp?: boolean | number | Date;
  thumbnail?: string;
  image?: string;
  /** Prefixa o titulo com o emoji do estado (padrao: true). */
  icon?: boolean;
}

export type EmbedContent = string | EmbedOptions;

function normalize(content: EmbedContent | undefined): EmbedOptions {
  if (content === undefined) return {};
  return typeof content === "string" ? { description: content } : content;
}

/** Embed base: cor, rodape padrao e timestamp opcional. */
export function baseEmbed(opts: EmbedOptions = {}): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(opts.color ?? BRAND_COLOR);
  if (opts.title) embed.setTitle(truncate(opts.title, TITLE_MAX));
  if (opts.description) embed.setDescription(truncate(opts.description, DESCRIPTION_MAX));
  if (opts.footer !== false) {
    embed.setFooter({
      text: truncate(opts.footer ?? EMBED_FOOTER, FOOTER_MAX),
      iconURL: opts.footerIconUrl,
    });
  }
  if (opts.timestamp) {
    embed.setTimestamp(opts.timestamp === true ? new Date() : opts.timestamp);
  }
  if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
  if (opts.image) embed.setImage(opts.image);
  return embed;
}

function stateEmbed(
  state: UiState,
  icon: string,
  content: EmbedContent | undefined,
  overrides: Partial<EmbedOptions> = {}
): EmbedBuilder {
  const opts = { ...normalize(content), ...overrides };
  const title = opts.title && opts.icon !== false ? `${icon} ${opts.title}` : opts.title;
  // Descricoes nao recebem icone: as mensagens i18n ja trazem o proprio emoji.
  return baseEmbed({ ...opts, title, color: opts.color ?? colorForState(state) });
}

export function successEmbed(content?: EmbedContent): EmbedBuilder {
  return stateEmbed("success", emoji("success"), content);
}

export function warnEmbed(content?: EmbedContent): EmbedBuilder {
  return stateEmbed("warn", emoji("warn"), content);
}

export function infoEmbed(content?: EmbedContent): EmbedBuilder {
  return stateEmbed("info", emoji("info"), content);
}

export interface ErrorEmbedOptions extends EmbedOptions {
  locale?: Locale;
}

/**
 * Embed de erro. Com `errorId`, o rodape mostra `ID do erro: <id>` (ou
 * `Error ID: <id>` em en-US) para o usuario informar ao suporte.
 */
export function errorEmbed(content?: string | ErrorEmbedOptions, errorId?: string): EmbedBuilder {
  const opts: ErrorEmbedOptions =
    typeof content === "string" ? { description: content } : (content ?? {});
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const description = opts.description ?? (opts.title ? undefined : t("errors.unexpected", locale));
  let footer = opts.footer;
  if (errorId) {
    const idLabel = t("errors.error_id", locale, { id: errorId });
    const baseFooter = opts.footer === false ? undefined : (opts.footer ?? EMBED_FOOTER);
    footer = baseFooter ? `${idLabel} • ${baseFooter}` : idLabel;
  }
  return stateEmbed("error", emoji("error"), { ...opts, description, footer });
}
