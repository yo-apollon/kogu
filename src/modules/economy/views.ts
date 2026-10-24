/**
 * Views do modulo ECONOMY: embeds e componentes puros (sem banco, Redis ou rede).
 * Os comandos (`commands.ts`) buscam os dados e entregam a estes construtores.
 *
 * i18n: usa as chaves existentes de `locales/*.json`. Chaves que ainda nao existem tem texto de
 * reserva em `FALLBACK` (via `tl`) e passam a valer automaticamente quando forem criadas nos
 * locales. Lista completa no relatorio da fase F10/economy.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type EmbedBuilder } from "discord.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { encodeCustomId } from "../../core/customId.js";
import { getLocale, hasKey, t, tPlural, type Replacements } from "../../i18n/index.js";
import { discordRelative, discordTime } from "../../lib/time.js";
import { baseEmbed, infoEmbed, successEmbed } from "../../ui/embeds.js";
import { emoji, relicEmoji } from "../../ui/emojis.js";
import { escapeMarkdown, formatAether, formatNumber } from "../../ui/format.js";
import { pageIndicator, type AnyRow, type PageContent } from "../../ui/components/paginator.js";
import type { PanelSection } from "../../ui/components/panel.js";
import { BRAND_COLOR, colorForVariant } from "../../ui/tokens.js";
import type { Timers } from "../summon/service.js";
import type { MemberSnapshot, PantheonSummary, RankRow, TopMode } from "./extra.js";
import {
  isMaxLevel,
  RELIC_KEYS,
  relicBar,
  relicDescription,
  relicLabel,
  relicUpgradeCost,
  type RelicKey,
  type RelicLevels,
} from "./relics.js";
import type { DailyResult } from "./service.js";

/** Namespace dos customIds deste modulo: `ec:rl:<relic>:<ownerId>` e `ec:top:<mode>:<ownerId>`. */
export const ECONOMY_NS = "ec";
export const TOP_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// i18n com texto de reserva
// ---------------------------------------------------------------------------

/**
 * Textos das chaves que ainda nao existem em locales/*.json (nao editamos locales nesta fase).
 * Quando a chave for criada nos locales, `tl` passa a usa-la sem mudar nenhum chamador.
 */
export const FALLBACK: Record<Locale, Record<string, string>> = {
  "pt-BR": {
    "economy.timers_pact_charges": "Cargas: **{left}/{max}**",
    "economy.timers_daily_title": "🎁 Bônus Diário",
    "economy.timers_daily_ready": "✅ **Disponível agora!** Use `{prefix}daily`.",
    "economy.timers_daily_wait": "⏳ Próximo resgate {when}.",
    "economy.daily_next": "⏳ Próximo resgate {when}.",
    "economy.profile_shards": "Fragmentos Astrais: **{count}**",
    "economy.profile_section_overview": "Visão geral",
    "economy.profile_section_relics": "Relíquias",
    "economy.top_pacts_title": "🏛️ Ranking de Pactos do Servidor",
    "economy.top_pacts_line": "**#{rank}** <@{userId}> — **{value}**",
    "economy.top_mode_aether": "Éter",
    "economy.top_mode_pacts": "Pactos",
    "economy.slash_user_option": "Jogador a consultar (padrão: você).",
    "economy.slash_relic_option": "Relíquia a evoluir (vazio: abre o altar).",
    "economy.slash_top_mode_option": "Critério do ranking (padrão: Éter).",
  },
  "en-US": {
    "economy.timers_pact_charges": "Charges: **{left}/{max}**",
    "economy.timers_daily_title": "🎁 Daily Bonus",
    "economy.timers_daily_ready": "✅ **Available now!** Use `{prefix}daily`.",
    "economy.timers_daily_wait": "⏳ Next claim {when}.",
    "economy.daily_next": "⏳ Next claim {when}.",
    "economy.profile_shards": "Astral Shards: **{count}**",
    "economy.profile_section_overview": "Overview",
    "economy.profile_section_relics": "Relics",
    "economy.top_pacts_title": "🏛️ Server Pact Ranking",
    "economy.top_pacts_line": "**#{rank}** <@{userId}> — **{value}**",
    "economy.top_mode_aether": "Aether",
    "economy.top_mode_pacts": "Pacts",
    "economy.slash_user_option": "Player to look up (default: you).",
    "economy.slash_relic_option": "Relic to upgrade (empty: opens the altar).",
    "economy.slash_top_mode_option": "Ranking criterion (default: Aether).",
  },
};

function fill(text: string, params: Replacements): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** `t()` que usa `FALLBACK` quando a chave ainda nao existe nos locales. */
export function tl(
  key: string,
  locale: string = DEFAULT_LOCALE,
  params: Replacements = {}
): string {
  if (hasKey(key, locale)) return t(key, locale, params);
  const text = FALLBACK[getLocale(locale)][key] ?? FALLBACK[DEFAULT_LOCALE][key];
  return text === undefined ? key : fill(text, params);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Horario exato do reset: relativo (`<t:..:R>`) e hora absoluta no fuso de quem le (`<t:..:t>`). */
export function resetLabel(at: number): string {
  return `${discordRelative(at)} · ${discordTime(at, "t")}`;
}

/** Cor `#RRGGBB` (ou `RRGGBB`) para numero; invalida cai na cor da marca. */
export function parseEmbedColor(raw: string | null | undefined): number {
  if (!raw) return BRAND_COLOR;
  const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim());
  return match ? parseInt(match[1]!, 16) : BRAND_COLOR;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Timers ($tu, $mu, $ru, $ku, /timers)
// ---------------------------------------------------------------------------

export interface TimersViewInput {
  timers: Timers;
  locale: Locale;
  prefix: string;
  userName: string;
}

export function timersEmbed({
  timers: tm,
  locale,
  prefix,
  userName,
}: TimersViewInput): EmbedBuilder {
  const rollsWhen = resetLabel(tm.rolls.nextResetAt);
  const pactWhen = resetLabel(tm.pacts.nextResetAt);

  const pactLines = [
    tm.pacts.ready
      ? t("economy.timers_pact_ready", locale)
      : t("economy.timers_pact_wait", locale, { when: pactWhen }),
    tl("economy.timers_pact_charges", locale, { left: tm.pacts.remaining, max: tm.pacts.limit }),
  ];

  const dailyValue =
    tm.daily.available || tm.daily.nextAt === null
      ? tl("economy.timers_daily_ready", locale, { prefix })
      : tl("economy.timers_daily_wait", locale, { when: resetLabel(tm.daily.nextAt) });

  return infoEmbed({
    title: t("economy.timers_title", locale, { user: escapeMarkdown(userName) }),
    description: t("economy.balance", locale, { value: formatAether(tm.balance, { locale }) }),
    footer: t("economy.timers_footer", locale, { prefix }),
    icon: false,
  }).addFields(
    { name: t("economy.timers_pact_title", locale), value: pactLines.join("\n"), inline: false },
    {
      name: t("economy.timers_rolls_title", locale),
      value: t("economy.timers_rolls_value", locale, {
        left: tm.rolls.remaining,
        max: tm.rolls.limit,
        when: rollsWhen,
      }),
      inline: true,
    },
    {
      name: t("economy.timers_stacked_title", locale),
      value: t("economy.timers_stacked_value", locale, { count: tm.stacked }),
      inline: true,
    },
    { name: tl("economy.timers_daily_title", locale), value: dailyValue, inline: true }
  );
}

export interface QuickTimerInput {
  timers: Timers;
  locale: Locale;
  userName: string;
}

/** `$mu`: pode firmar Pacto agora? */
export function pactUpText({ timers: tm, locale, userName }: QuickTimerInput): string {
  const user = escapeMarkdown(userName);
  return tm.pacts.ready
    ? t("economy.pact_ready", locale, { user })
    : t("economy.pact_wait", locale, { user, when: resetLabel(tm.pacts.nextResetAt) });
}

/** `$ru`: rolls restantes, reset exato e empilhados. */
export function rollsUpText({ timers: tm, locale, userName }: QuickTimerInput): string {
  return t("economy.rolls_status", locale, {
    user: escapeMarkdown(userName),
    left: tm.rolls.remaining,
    max: tm.rolls.limit,
    when: resetLabel(tm.rolls.nextResetAt),
    stacked: tm.stacked,
  });
}

/** `$ku`: o orbe de Eter e absorvido por oferta, sem recarga propria; sempre pronto. */
export function orbUpText({
  locale,
  userName,
}: Pick<QuickTimerInput, "locale" | "userName">): string {
  return t("economy.orb_status", locale, { user: escapeMarkdown(userName) });
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export function dailyEmbed(input: {
  result: DailyResult;
  baseRolls: number;
  locale: Locale;
}): EmbedBuilder {
  const { result, baseRolls, locale } = input;
  const body = t("economy.daily_body", locale, {
    aether: formatNumber(result.reward, locale),
    rolls: result.stackedAdded,
    base: baseRolls,
    balance: formatNumber(result.balance, locale),
  });
  return successEmbed({
    title: t("economy.daily_title", locale),
    description: `${body}\n\n${tl("economy.daily_next", locale, { when: resetLabel(result.nextAt) })}`,
    icon: false,
  });
}

// ---------------------------------------------------------------------------
// Relíquias
// ---------------------------------------------------------------------------

/** Uma linha por reliquia: nome, barra de nivel, comando e efeito. */
export function relicLines(levels: RelicLevels, locale: Locale, prefix: string): string[] {
  return RELIC_KEYS.map((key) =>
    t("economy.relics_line", locale, {
      name: relicLabel(key, locale),
      bar: relicBar(levels[key]),
      level: levels[key],
      prefix,
      key,
      desc: relicDescription(key, locale),
    })
  );
}

export interface RelicsViewInput {
  userName: string;
  balance: number;
  levels: RelicLevels;
  locale: Locale;
  prefix: string;
  /** false = somente leitura (perfil de outro jogador): sem a introducao de como evoluir. */
  interactive?: boolean;
}

export function relicsEmbed(input: RelicsViewInput): EmbedBuilder {
  const { userName, balance, levels, locale, prefix } = input;
  const lines = relicLines(levels, locale, prefix).join("\n\n");
  const intro =
    input.interactive === false
      ? ""
      : `${t("economy.relics_intro", locale, { balance: formatNumber(balance, locale), prefix })}\n\n`;
  return baseEmbed({
    title: t("economy.relics_title", locale, { user: escapeMarkdown(userName) }),
    description: intro + lines,
    color: colorForVariant("HOLO"),
  });
}

/** customId do botao de evolucao: `ec:rl:<relic>:<ownerId>`. */
export function relicButtonId(key: RelicKey, ownerId: string): string {
  return encodeCustomId(ECONOMY_NS, "rl", key, ownerId);
}

/**
 * Botoes de evolucao (3 por linha). Mostram o custo atual; no nivel maximo ficam desligados.
 * Sem saldo o botao continua clicavel: a resposta explica quanto falta e sugere o `daily`.
 */
export function relicButtons(input: {
  levels: RelicLevels;
  balance: number;
  ownerId: string;
  locale: Locale;
}): AnyRow[] {
  const { levels, balance, ownerId, locale } = input;
  const buttons = RELIC_KEYS.map((key) => {
    const cost = relicUpgradeCost(key, levels[key], levels.ruby);
    const max = isMaxLevel(levels[key]);
    return new ButtonBuilder()
      .setCustomId(relicButtonId(key, ownerId))
      .setEmoji(relicEmoji(key))
      .setLabel(max || cost === null ? "MAX" : `${formatNumber(cost, locale)} ${emoji("aether")}`)
      .setStyle(
        !max && cost !== null && balance >= cost ? ButtonStyle.Success : ButtonStyle.Secondary
      )
      .setDisabled(max);
  });
  return chunk(buttons, 3).map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(row));
}

export function relicUpgradedEmbed(input: {
  key: RelicKey;
  toLevel: number;
  balance: number;
  locale: Locale;
}): EmbedBuilder {
  const { key, toLevel, balance, locale } = input;
  return successEmbed({
    description: t("economy.relic_upgraded", locale, {
      name: relicLabel(key, locale),
      level: toLevel,
      effect: relicDescription(key, locale),
      balance: formatNumber(balance, locale),
    }),
  });
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export interface ProfileViewInput {
  /** Nome exibido do jogador consultado. */
  userName: string;
  avatarUrl: string;
  member: MemberSnapshot;
  pantheon: PantheonSummary;
  locale: Locale;
  prefix: string;
}

export function profileOverviewEmbed(v: ProfileViewInput): EmbedBuilder {
  const { member, pantheon, locale, prefix } = v;
  const economy = [
    t("collection.profile_economy_value", locale, {
      balance: formatNumber(member.balance, locale),
      total: formatNumber(pantheon.worth, locale),
    }),
    tl("economy.profile_shards", locale, { count: formatNumber(member.astralShards, locale) }),
  ].join("\n");

  const leader = pantheon.leader
    ? `**${escapeMarkdown(pantheon.leader.name)}**${
        pantheon.leader.franchise ? ` (*${escapeMarkdown(pantheon.leader.franchise)}*)` : ""
      } — ${formatAether(pantheon.leader.aether, { locale })}`
    : t("collection.profile_leader_none", locale);

  const relics = RELIC_KEYS.map(
    (key) => `${relicEmoji(key)} ${t(`relics.${key}`, locale, { lvl: member.relics[key] })}`
  ).join(" • ");

  return baseEmbed({
    title: t("collection.profile_title", locale, { user: escapeMarkdown(v.userName) }),
    color: parseEmbedColor(member.embedColor),
    thumbnail: pantheon.leader?.imageUrl ?? v.avatarUrl,
    footer: t("collection.profile_footer", locale, { prefix }),
  }).addFields(
    { name: t("collection.profile_economy_title", locale), value: economy, inline: true },
    {
      name: t("collection.profile_pantheon_title", locale),
      value: t("collection.profile_pantheon_value", locale, {
        count: pantheon.count,
        keys: pantheon.awakeningKeys,
        soulmates: pantheon.soulmates,
      }),
      inline: true,
    },
    { name: t("collection.profile_leader_title", locale), value: leader, inline: false },
    { name: t("collection.profile_relics_title", locale), value: relics, inline: false }
  );
}

export function profileRelicsEmbed(v: ProfileViewInput): EmbedBuilder {
  return relicsEmbed({
    userName: v.userName,
    balance: v.member.balance,
    levels: v.member.relics,
    locale: v.locale,
    prefix: v.prefix,
    interactive: false,
  }).setColor(parseEmbedColor(v.member.embedColor));
}

/** Secoes do painel de perfil (select): Visao geral / Reliquias. */
export function profileSections(v: ProfileViewInput): PanelSection[] {
  return [
    {
      id: "overview",
      label: tl("economy.profile_section_overview", v.locale),
      emoji: emoji("leader"),
      render: (): PageContent => ({ embeds: [profileOverviewEmbed(v)] }),
    },
    {
      id: "relics",
      label: tl("economy.profile_section_relics", v.locale),
      emoji: emoji("relic.gold"),
      render: (): PageContent => ({ embeds: [profileRelicsEmbed(v)] }),
    },
  ];
}

// ---------------------------------------------------------------------------
// Ranking ($top, /top)
// ---------------------------------------------------------------------------

const TOP_MODE_ALIASES: Readonly<Record<string, TopMode>> = {
  aether: "aether",
  eter: "aether",
  éter: "aether",
  ether: "aether",
  e: "aether",
  pacts: "pacts",
  pact: "pacts",
  pactos: "pacts",
  pacto: "pacts",
  p: "pacts",
};

/** Normaliza a entrada do usuario para um `TopMode`; `undefined` se nao reconhecer. */
export function parseTopMode(raw: string | null | undefined): TopMode | undefined {
  if (!raw) return undefined;
  return TOP_MODE_ALIASES[raw.trim().toLowerCase()];
}

export function topEmbed(input: {
  mode: TopMode;
  rows: readonly RankRow[];
  page: number;
  totalPages: number;
  locale: Locale;
}): EmbedBuilder {
  const { mode, rows, page, totalPages, locale } = input;
  const lines = rows.map((row) =>
    mode === "pacts"
      ? tl("economy.top_pacts_line", locale, {
          rank: row.rank,
          userId: row.userId,
          value: tPlural("common.pacts", row.value, locale),
        })
      : t("economy.top_server_line", locale, {
          rank: row.rank,
          userId: row.userId,
          value: formatNumber(row.value, locale),
        })
  );
  return baseEmbed({
    title:
      mode === "pacts"
        ? tl("economy.top_pacts_title", locale)
        : t("economy.top_server_title", locale),
    description: lines.length > 0 ? lines.join("\n") : t("economy.top_server_empty", locale),
    color: colorForVariant("HOLO"),
    footer: pageIndicator(page, totalPages, locale),
  });
}

/** customId do botao de criterio: `ec:top:<mode>:<ownerId>`. */
export function topModeButtonId(mode: TopMode, ownerId: string): string {
  return encodeCustomId(ECONOMY_NS, "top", mode, ownerId);
}

/** Linha com os dois criterios; o atual fica destacado e desligado. */
export function topModeRow(input: { mode: TopMode; ownerId: string; locale: Locale }): AnyRow {
  const { mode, ownerId, locale } = input;
  const button = (target: TopMode, label: string, icon: string) =>
    new ButtonBuilder()
      .setCustomId(topModeButtonId(target, ownerId))
      .setEmoji(icon)
      .setLabel(label)
      .setStyle(mode === target ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(mode === target);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    button("aether", tl("economy.top_mode_aether", locale), emoji("aether")),
    button("pacts", tl("economy.top_mode_pacts", locale), emoji("pact"))
  );
}
