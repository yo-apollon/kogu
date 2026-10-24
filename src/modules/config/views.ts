/**
 * Apresentacao do modulo config: painel `/settings`, listas de series desativadas, confirmacoes e textos.
 *
 * i18n: usa as chaves `config.*` existentes. As que ainda nao existem em locales/*.json ficam em
 * `FALLBACK_TEXT` (pt-BR/en-US); `tr()` prefere sempre o locale quando ele possui a chave.
 */
import type { EmbedBuilder } from "discord.js";
import type { Locale } from "../../config/constants.js";
import type { CommandContext } from "../../core/contracts.js";
import { hasKey, t } from "../../i18n/index.js";
import { UserError } from "../../lib/errors.js";
import { errorEmbed, infoEmbed, successEmbed } from "../../ui/embeds.js";
import { emoji } from "../../ui/emojis.js";
import { escapeMarkdown, truncate } from "../../ui/format.js";
import type { PanelSection } from "../../ui/components/panel.js";
import { pageIndicator, type PageContent } from "../../ui/components/paginator.js";
import {
  SETTING_LIMITS,
  targetRefValue,
  type AppliedSetting,
  type DisabledEntry,
  type DisableTarget,
  type GuildSettings,
} from "./service.js";

type Params = Record<string, string | number>;

/** Chaves propostas (ainda ausentes de locales/*.json). */
export const FALLBACK_TEXT: Record<string, Record<Locale, string>> = {
  "config.disable_series_not_found": {
    "pt-BR": '❌ Nenhuma série ou franquia encontrada para **"{query}"**.',
    "en-US": '❌ No series or franchise found for **"{query}"**.',
  },
  "config.disable_already": {
    "pt-BR": "ℹ️ **{series}** já está desativada.",
    "en-US": "ℹ️ **{series}** is already disabled.",
  },
  "config.disable_server_ok": {
    "pt-BR":
      "🚫 **{series}** foi desativada **para todo o servidor**! Personagens dessa obra não aparecerão nas invocações de ninguém.",
    "en-US":
      "🚫 **{series}** was disabled **for the whole server**! Characters from it will not show up in anyone's rolls.",
  },
  "config.enable_server_ok": {
    "pt-BR": "✅ **{series}** foi reativada para o servidor.",
    "en-US": "✅ **{series}** was re-enabled for the server.",
  },
  "config.disable_server_title": {
    "pt-BR": "🚫 Séries Desativadas no Servidor ({count})",
    "en-US": "🚫 Series Disabled Server-wide ({count})",
  },
  "config.disable_server_empty": {
    "pt-BR": "📋 Nenhuma série está desativada para o servidor inteiro.",
    "en-US": "📋 No series is disabled for the whole server.",
  },
  "config.section_overview": {
    "pt-BR": "📋 Visão geral",
    "en-US": "📋 Overview",
  },
  "config.section_advanced": {
    "pt-BR": "🧪 Avançado",
    "en-US": "🧪 Advanced",
  },
  "config.section_disabled": {
    "pt-BR": "🚫 Séries desativadas",
    "en-US": "🚫 Disabled series",
  },
  "config.settings_advanced_title": {
    "pt-BR": "🧪 Avançado",
    "en-US": "🧪 Advanced",
  },
  "config.settings_advanced_value": {
    "pt-BR":
      "• **Intervalo de rolls:** `{interval} min`\n• **Deslocamento do reset:** `{offset} min`\n• **Pactos por janela:** `{pacts}`\n• **Proteção de Éter:** `{aether}s`\n• **Boost de lançamento:** `{boost}`\n• **Conteúdo adulto:** `{adult}`",
    "en-US":
      "• **Roll interval:** `{interval} min`\n• **Reset offset:** `{offset} min`\n• **Pacts per window:** `{pacts}`\n• **Aether protection:** `{aether}s`\n• **Release boost:** `{boost}`\n• **Adult content:** `{adult}`",
  },
  "help.commands.set": {
    "pt-BR": "Altera uma configuração do servidor (rolls, timer, claim, gamemode, prefix, lang).",
    "en-US": "Changes a server setting (rolls, timer, claim, gamemode, prefix, lang).",
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

export interface SlashText {
  set: string;
  rolls: string;
  timer: string;
  claim: string;
  gamemode: string;
  prefix: string;
  lang: string;
  value: string;
  disableAdd: string;
  disableRemove: string;
  disableList: string;
  series: string;
  server: string;
}

const L = SETTING_LIMITS;

export const SLASH_TEXT: Record<Locale, SlashText> = {
  "pt-BR": {
    set: "Altera uma configuração do servidor.",
    rolls: `Invocações base por hora (${L.rolls.min} a ${L.rolls.max}).`,
    timer: `Recarga do Pacto, em minutos (${L.timer.min} a ${L.timer.max}).`,
    claim: `Janela para firmar o Pacto, em segundos (${L.claim.min} a ${L.claim.max}).`,
    gamemode: "Modo de jogo: 1 = catálogo completo, 2 = mais populares.",
    prefix: `Prefixo dos comandos de texto (até ${L.prefix.max} caracteres).`,
    lang: "Idioma do servidor.",
    value: "Novo valor.",
    disableAdd: "Desativa uma série ou franquia nas invocações.",
    disableRemove: "Reativa uma série ou franquia.",
    disableList: "Lista as séries desativadas.",
    series: "Série ou franquia (busque e escolha na lista).",
    server: "Aplicar ao servidor inteiro (somente Administradores).",
  },
  "en-US": {
    set: "Changes a server setting.",
    rolls: `Base rolls per hour (${L.rolls.min} to ${L.rolls.max}).`,
    timer: `Pact cooldown, in minutes (${L.timer.min} to ${L.timer.max}).`,
    claim: `Window to sign the Pact, in seconds (${L.claim.min} to ${L.claim.max}).`,
    gamemode: "Game mode: 1 = full catalog, 2 = most popular only.",
    prefix: `Text command prefix (up to ${L.prefix.max} characters).`,
    lang: "Server language.",
    value: "New value.",
    disableAdd: "Disables a series or franchise in rolls.",
    disableRemove: "Re-enables a series or franchise.",
    disableList: "Lists the disabled series.",
    series: "Series or franchise (search and pick from the list).",
    server: "Apply to the whole server (Administrators only).",
  },
};

/** Opcao de autocomplete de serie/franquia: valor `s:<id>` ou `f:<id>`. */
export function targetChoice(target: Pick<DisableTarget, "kind" | "id" | "name">): {
  name: string;
  value: string;
} {
  const icon = emoji(target.kind === "series" ? "scroll" : "catalog");
  return { name: truncate(`${icon} ${target.name}`, 100), value: targetRefValue(target) };
}

// ---------------------------------------------------------------------------
// Confirmacoes
// ---------------------------------------------------------------------------

/** Resposta de `$setrolls` & cia. Para `lang`, `locale` deve ser o idioma NOVO. */
export function settingAppliedEmbed(locale: Locale, applied: AppliedSetting): EmbedBuilder {
  const { key, value } = applied;
  switch (key) {
    case "rolls":
      return successEmbed(tr(locale, "config.setrolls_ok", { value: String(value) }));
    case "timer":
      return successEmbed(tr(locale, "config.settimer_ok", { value: String(value) }));
    case "claim":
      return successEmbed(tr(locale, "config.setclaim_ok", { value: String(value) }));
    case "gamemode":
      return successEmbed(tr(locale, "config.gamemode_ok", { value: String(value) }));
    case "prefix":
      return successEmbed(tr(locale, "config.prefix_ok", { value: String(value) }));
    case "lang":
      return successEmbed(tr(locale, "config.lang_ok", { lang: String(value) }));
  }
}

export function disableOkEmbed(locale: Locale, target: DisableTarget, serverWide: boolean): EmbedBuilder {
  return successEmbed(
    tr(locale, serverWide ? "config.disable_server_ok" : "config.disable_ok", {
      series: escapeMarkdown(target.name),
    })
  );
}

export function disableAlreadyEmbed(locale: Locale, target: DisableTarget): EmbedBuilder {
  return infoEmbed({
    description: tr(locale, "config.disable_already", { series: escapeMarkdown(target.name) }),
    icon: false,
  });
}

export function enableOkEmbed(locale: Locale, name: string, serverWide: boolean): EmbedBuilder {
  return successEmbed(
    tr(locale, serverWide ? "config.enable_server_ok" : "config.enable_ok", {
      series: escapeMarkdown(name),
    })
  );
}

// ---------------------------------------------------------------------------
// Lista de series desativadas
// ---------------------------------------------------------------------------

export interface DisabledViewInput {
  locale: Locale;
  prefix: string;
  serverWide: boolean;
  pageSize: number;
}

function disabledLine(entry: DisableTarget, rank: number): string {
  const icon = emoji(entry.kind === "series" ? "scroll" : "catalog");
  return `${rank}. ${icon} **${escapeMarkdown(entry.name)}**`;
}

export function emptyDisabledEmbed(locale: Locale, prefix: string, serverWide: boolean): EmbedBuilder {
  return infoEmbed({
    description: tr(locale, serverWide ? "config.disable_server_empty" : "config.disable_empty", {
      prefix,
    }),
    icon: false,
  });
}

/** Uma pagina da lista (usada como `renderPage` do paginator). */
export function renderDisabledPage(
  entries: readonly DisabledEntry[],
  page: number,
  totalPages: number,
  total: number,
  view: DisabledViewInput
): PageContent {
  const { locale } = view;
  const offset = (page - 1) * view.pageSize;
  const footer = tr(locale, "config.disable_footer", { prefix: view.prefix });
  return {
    embeds: [
      infoEmbed({
        title: tr(locale, view.serverWide ? "config.disable_server_title" : "config.disable_title", {
          count: total,
        }),
        description: entries.map((entry, index) => disabledLine(entry, offset + index + 1)).join("\n"),
        footer: totalPages > 1 ? `${footer} • ${pageIndicator(page, totalPages, locale)}` : footer,
        icon: false,
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Painel /settings
// ---------------------------------------------------------------------------

type Field = { name: string; value: string; inline: boolean };

function yesNo(locale: Locale, value: boolean): string {
  return t(value ? "common.yes" : "common.no", locale);
}

export function rollsField(locale: Locale, s: GuildSettings, inline = false): Field {
  return {
    name: tr(locale, "config.settings_rolls_title"),
    value: tr(locale, "config.settings_rolls_value", {
      prefix: s.prefix,
      rolls: s.baseRolls,
      mode: s.gamemode,
    }),
    inline,
  };
}

export function timersField(locale: Locale, s: GuildSettings, inline = false): Field {
  return {
    name: tr(locale, "config.settings_timers_title"),
    value: tr(locale, "config.settings_timers_value", {
      claim: s.claimWindowSeconds,
      cooldown: s.claimCooldownMinutes,
      snipe: s.snipeProtectionSeconds,
    }),
    inline,
  };
}

export function localeField(locale: Locale, s: GuildSettings, inline = false): Field {
  return {
    name: tr(locale, "config.settings_locale_title"),
    value: tr(locale, "config.settings_locale_value", { lang: s.locale, limit: s.pactLimit }),
    inline,
  };
}

export function advancedField(locale: Locale, s: GuildSettings, inline = false): Field {
  return {
    name: tr(locale, "config.settings_advanced_title"),
    value: tr(locale, "config.settings_advanced_value", {
      interval: s.rollIntervalMin,
      offset: s.resetOffsetMin,
      pacts: s.pactsPerWindow,
      aether: s.aetherSnipeProtectionSeconds,
      boost: yesNo(locale, s.releaseBoostEnabled),
      adult: yesNo(locale, s.allowAdult),
    }),
    inline,
  };
}

function settingsEmbed(locale: Locale, guildName: string, s: GuildSettings): EmbedBuilder {
  return infoEmbed({
    title: tr(locale, "config.settings_title", { guild: escapeMarkdown(guildName) }),
    footer: tr(locale, "config.settings_footer", { prefix: s.prefix }),
    icon: false,
  });
}

/** Maximo de series listadas na secao "desativadas" do painel (o restante vai em `$dl --server`). */
const PANEL_DISABLED_LIMIT = 20;

export interface SettingsPanelDeps {
  locale: Locale;
  guildName: string;
  /** Le a config atual a cada troca de secao (sempre fresca). */
  load(): Promise<GuildSettings>;
  loadServerDisabled(): Promise<DisabledEntry[]>;
}

/** Secoes do select menu: visao geral (tudo), uma por grupo e as series desativadas do servidor. */
export function buildSettingsSections(deps: SettingsPanelDeps): PanelSection[] {
  const { locale, guildName } = deps;
  const group = (
    id: string,
    label: string,
    fields: (s: GuildSettings) => Field[]
  ): PanelSection => ({
    id,
    label,
    async render() {
      const s = await deps.load();
      return { embeds: [settingsEmbed(locale, guildName, s).addFields(fields(s))] };
    },
  });

  return [
    group("overview", tr(locale, "config.section_overview"), (s) => [
      rollsField(locale, s, true),
      timersField(locale, s, true),
      localeField(locale, s),
      advancedField(locale, s),
    ]),
    group("rolls", tr(locale, "config.settings_rolls_title"), (s) => [rollsField(locale, s)]),
    group("timers", tr(locale, "config.settings_timers_title"), (s) => [timersField(locale, s)]),
    group("locale", tr(locale, "config.settings_locale_title"), (s) => [localeField(locale, s)]),
    group("advanced", tr(locale, "config.section_advanced"), (s) => [advancedField(locale, s)]),
    {
      id: "disabled",
      label: tr(locale, "config.section_disabled"),
      async render() {
        const [s, entries] = await Promise.all([deps.load(), deps.loadServerDisabled()]);
        const embed = settingsEmbed(locale, guildName, s);
        if (entries.length === 0) {
          embed.setDescription(tr(locale, "config.disable_server_empty", { prefix: s.prefix }));
        } else {
          const shown = entries.slice(0, PANEL_DISABLED_LIMIT);
          const lines = shown.map((entry, index) => disabledLine(entry, index + 1));
          if (entries.length > shown.length) lines.push(`… +${entries.length - shown.length}`);
          embed.addFields({
            name: tr(locale, "config.disable_server_title", { count: entries.length }),
            value: lines.join("\n"),
            inline: false,
          });
        }
        return { embeds: [embed] };
      },
    },
  ];
}
