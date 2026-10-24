/**
 * Camada de apresentacao do modulo summon.
 *
 * - `tr`: traducao com fallback textual local para chaves i18n que ainda nao existem nos locales
 *   (lista em FALLBACK_TEXT; assim que a chave entrar em locales/*.json, o locale passa a valer).
 * - Montagem da mensagem de invocacao (embed estilo Mudae + botoes) e dos estados finais dos botoes.
 * - Consultas auxiliares pequenas (wishers, extras do pacto, cor do membro, idioma da guild).
 *   Sao leituras por indice; qualquer falha deve ser tratada como opcional pelo chamador.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { and, count, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "../../config/constants.js";
import { getLocale, hasKey, t, type Replacements } from "../../i18n/index.js";
import { db } from "../../infra/db/client.js";
import { entities, guildMembers, guilds, pacts, wishes } from "../../infra/db/schema/index.js";
import type { UserError } from "../../lib/errors.js";
import { discordRelative, discordTime } from "../../lib/time.js";
import { emoji } from "../../ui/emojis.js";
import { truncate } from "../../ui/format.js";
import { buildSummonButtons, type SummonView } from "../../ui/summonEmbed.js";
import type { SummonResult } from "./service.js";

// ---------------------------------------------------------------------------
// i18n com fallback
// ---------------------------------------------------------------------------

/**
 * Chaves usadas por este modulo que NAO existem em locales/*.json (propostas ao orquestrador).
 * `tr` usa o locale quando a chave existir; senao, este texto.
 */
export const FALLBACK_TEXT: Record<Locale, Record<string, string>> = {
  "pt-BR": {
    "summon.offer_protected":
      "🛡️ Esta carta está protegida por mais **{seconds}s**: só quem a invocou pode reivindicá-la agora.",
    "summon.rolls_reset_at": "🕒 Suas invocações voltam às {time} ({when}).",
    "summon.pact_ready_at": "🕒 Seu próximo Pacto fica disponível às {time} ({when}).",
    "summon.like_already": "⭐ Você já favoritou **{entity}**.",
    "summon.roll_opt_type": "Tipo de carta",
    "summon.roll_opt_gender": "Gênero",
    "summon.roll_opt_universe": "Universo",
    "catalog.type.CHARACTER": "Personagem",
    "catalog.type.WEAPON": "Arma",
    "catalog.type.COMPANION": "Companheiro",
    "catalog.type.DOMAIN": "Domínio",
  },
  "en-US": {
    "summon.offer_protected":
      "🛡️ This card is protected for **{seconds}s** more: only the summoner can claim it right now.",
    "summon.rolls_reset_at": "🕒 Your summons come back at {time} ({when}).",
    "summon.pact_ready_at": "🕒 Your next Pact becomes available at {time} ({when}).",
    "summon.like_already": "⭐ You already favorited **{entity}**.",
    "summon.roll_opt_type": "Card type",
    "summon.roll_opt_gender": "Gender",
    "summon.roll_opt_universe": "Universe",
    "catalog.type.CHARACTER": "Character",
    "catalog.type.WEAPON": "Weapon",
    "catalog.type.COMPANION": "Companion",
    "catalog.type.DOMAIN": "Domain",
  },
};

function interpolate(text: string, params: Replacements): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Traduz `key`; se ela nao existir nos locales, usa FALLBACK_TEXT; sem nenhum, devolve a chave. */
export function tr(key: string, locale: Locale | string, params: Replacements = {}): string {
  if (hasKey(key, locale)) return t(key, locale, params);
  const lang = (SUPPORTED_LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : DEFAULT_LOCALE;
  const text = FALLBACK_TEXT[lang][key] ?? FALLBACK_TEXT[DEFAULT_LOCALE][key];
  return text === undefined ? key : interpolate(text, params);
}

/** Instante exato para mensagens: hora local do leitor (`<t:..:t>`) e relativo (`<t:..:R>`). */
export function exactTime(ms: number): { time: string; when: string } {
  return { time: discordTime(ms, "t"), when: discordRelative(ms) };
}

function numberParam(params: UserError["params"], key: string): number | null {
  const value = params[key];
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Texto de um `UserError` do modulo. Alem da mensagem i18n, acrescenta o horario EXATO do
 * proximo reset quando o erro o informa (rolls esgotados e pacto sem cargas).
 */
export function describeUserError(err: UserError, locale: Locale | string): string {
  const { usage: _usage, ...params } = err.params;
  let text = tr(err.key, locale, params);
  if (err.key === "summon.rolls_exhausted") {
    const at = numberParam(err.params, "nextWindowStart");
    if (at !== null) text += `\n${tr("summon.rolls_reset_at", locale, exactTime(at))}`;
  } else if (err.key === "summon.pact_no_charges") {
    const at = numberParam(err.params, "nextAt");
    if (at !== null) text += `\n${tr("summon.pact_ready_at", locale, exactTime(at))}`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// View da invocacao
// ---------------------------------------------------------------------------

/** Dados do dono (carta que ja tem pacto) vindos de fora do RolledEntity. */
export interface OwnerExtras {
  avatarUrl?: string;
  embedColor?: number;
  note?: string | null;
  customImage?: string | null;
  /** Posicao do pacto na colecao do dono (ordem de pacto). */
  position?: number;
}

/** Converte `#RRGGBB` em numero; invalido = undefined. */
export function parseHexColor(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  return m ? parseInt(m[1], 16) : undefined;
}

/** `SummonResult` -> `SummonView` do embed estilo Mudae (funcao pura). */
export function buildOfferView(
  result: SummonResult,
  locale: Locale | string,
  owner: OwnerExtras = {}
): SummonView {
  const { entity, variant, aetherValue, awakeningKeys } = result;
  const view: SummonView = {
    name: entity.name,
    franchise: entity.seriesTitle ?? t("catalog.default_universe", locale),
    gender: entity.gender,
    universe: entity.universe,
    aetherValue,
    awakeningKeys,
    claimRank: entity.claimRank ?? undefined,
    likeRank: entity.likeRank ?? undefined,
    tier: entity.tier,
    variant,
  };
  const pact = entity.pact;
  if (pact) {
    view.ownerName = pact.ownerName ?? t("summon.unknown_owner", locale);
    view.ownerAvatarUrl = owner.avatarUrl;
    view.ownerEmbedColor = owner.embedColor;
    view.ownerKeys = awakeningKeys;
    view.ownerPosition = owner.position;
    if (owner.note) view.ownerNote = owner.note;
    if (owner.customImage) {
      view.hasCustomPic = true;
      view.customPicIndex = 1;
    }
  }
  return view;
}

/**
 * Botoes da oferta. Carta com dono (orbe): so like + orbe, porque o pacto nao e possivel.
 * Reaproveita `buildSummonButtons` (customIds `sm:<acao>:<offerId>`).
 */
export function summonOfferRow(offerId: number, hasOrb: boolean): ActionRowBuilder<ButtonBuilder> {
  const row = buildSummonButtons(String(offerId), { orb: hasOrb });
  if (!hasOrb) return row;
  const keep = row.components.filter((button) => {
    const id = (button.data as { custom_id?: string }).custom_id ?? "";
    return !id.startsWith("sm:pact:");
  });
  return new ActionRowBuilder<ButtonBuilder>().addComponents(keep);
}

// ---------------------------------------------------------------------------
// Estados finais dos botoes
// ---------------------------------------------------------------------------

const LABEL_MAX = 80;

function finalRow(
  customId: string,
  icon: string,
  label: string,
  style: ButtonStyle
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setEmoji(icon)
      .setLabel(truncate(label, LABEL_MAX))
      .setStyle(style)
      .setDisabled(true)
  );
}

/** Pacto firmado: um unico botao desabilitado com o nome do dono. */
export function claimedRow(offerId: number, owner: string, locale: Locale | string) {
  return finalRow(
    `sm:done:${offerId}`,
    emoji("pact"),
    tr("summon.pact_done_label", locale, { user: owner }),
    ButtonStyle.Success
  );
}

/** Orbe absorvido: botao desabilitado "+N Eter absorvido por X". */
export function orbDoneRow(offerId: number, owner: string, amount: number, locale: Locale | string) {
  return finalRow(
    `sm:orbdone:${offerId}`,
    emoji("orb"),
    tr("summon.orb_done_label", locale, { amount, user: owner }),
    ButtonStyle.Secondary
  );
}

/** Oferta expirada sem reivindicacao. */
export function expiredRow(offerId: number, locale: Locale | string) {
  return finalRow(
    `sm:expired:${offerId}`,
    emoji("expired"),
    tr("summon.rift_expired", locale),
    ButtonStyle.Secondary
  );
}

// ---------------------------------------------------------------------------
// Consultas auxiliares
// ---------------------------------------------------------------------------

/** Maximo de pessoas mencionadas por invocacao (limite do Discord: 100 em `allowedMentions.users`). */
export const MAX_WISHER_MENTIONS = 20;

/** Quem tem a entidade na wishlist deste servidor (starwish primeiro), exceto quem rolou. */
export async function findWishers(
  guildId: string,
  entityId: number,
  exceptUserId: string,
  limit: number = MAX_WISHER_MENTIONS
): Promise<string[]> {
  const rows = await db
    .select({ userId: wishes.userId })
    .from(wishes)
    .where(
      and(
        eq(wishes.guildId, guildId),
        eq(wishes.entityId, entityId),
        ne(wishes.userId, exceptUserId)
      )
    )
    .orderBy(desc(wishes.isStarwish), wishes.createdAt)
    .limit(limit);
  return rows.map((r) => r.userId);
}

export interface PactExtras {
  note: string | null;
  customImage: string | null;
  /** Cor do pacto, ou a do membro dono quando o pacto nao define. */
  embedColor: number | undefined;
  /** 1-based, por ordem de pacto (id) dentro da colecao do dono. */
  position: number;
}

/** Nota, imagem propria, cor e posicao de um pacto existente. */
export async function loadPactExtras(pact: {
  id: number;
  guildId: string;
  userId: string;
}): Promise<PactExtras | null> {
  const [row] = await db
    .select({
      note: pacts.note,
      customImage: pacts.customImage,
      pactColor: pacts.embedColor,
      memberColor: guildMembers.embedColor,
    })
    .from(pacts)
    .leftJoin(
      guildMembers,
      and(eq(guildMembers.guildId, pacts.guildId), eq(guildMembers.userId, pacts.userId))
    )
    .where(eq(pacts.id, pact.id))
    .limit(1);
  if (!row) return null;
  const position = await loadPactPosition(pact);
  return {
    note: row.note,
    customImage: row.customImage,
    embedColor: parseHexColor(row.pactColor) ?? parseHexColor(row.memberColor),
    position,
  };
}

/** Posicao (1-based) do pacto entre os pactos do dono no servidor, por ordem de criacao. */
export async function loadPactPosition(pact: {
  id: number;
  guildId: string;
  userId: string;
}): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(pacts)
    .where(
      and(eq(pacts.guildId, pact.guildId), eq(pacts.userId, pact.userId), lte(pacts.id, pact.id))
    );
  return Math.max(1, row?.n ?? 1);
}

/** Cor de embed do membro (`guild_members.embed_color`). */
export async function loadMemberColor(guildId: string, userId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ color: guildMembers.embedColor })
    .from(guildMembers)
    .where(and(eq(guildMembers.guildId, guildId), eq(guildMembers.userId, userId)))
    .limit(1);
  return parseHexColor(row?.color);
}

export async function loadEntityName(entityId: number): Promise<string | undefined> {
  const [row] = await db
    .select({ name: entities.name })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  return row?.name;
}

const LOCALE_TTL_MS = 30_000;
const localeCache = new Map<string, { at: number; locale: Locale }>();

export function clearGuildLocaleCache(): void {
  localeCache.clear();
}

/** Idioma configurado na guild (cache de 30 s). Falha de banco = idioma padrao. */
export async function guildLocale(guildId: string | null, now: number = Date.now()): Promise<Locale> {
  if (!guildId) return DEFAULT_LOCALE;
  const hit = localeCache.get(guildId);
  if (hit && now - hit.at < LOCALE_TTL_MS) return hit.locale;
  try {
    const [row] = await db
      .select({ language: guilds.language })
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .limit(1);
    const locale = getLocale(row?.language);
    localeCache.set(guildId, { at: now, locale });
    return locale;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Idiomas de varias guilds numa consulta so (sweeper). Guild ausente = idioma padrao. */
export async function guildLocales(guildIds: readonly string[]): Promise<Map<string, Locale>> {
  const out = new Map<string, Locale>();
  if (guildIds.length === 0) return out;
  try {
    const rows = await db
      .select({ id: guilds.id, language: guilds.language })
      .from(guilds)
      .where(inArray(guilds.id, [...guildIds]));
    for (const r of rows) out.set(r.id, getLocale(r.language));
  } catch {
    // sem idioma: o chamador cai no padrao
  }
  return out;
}
