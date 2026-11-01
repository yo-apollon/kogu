/**
 * Textos do modulo HELP. Chaves existentes (help.title, help.footer, help.category.*,
 * help.commands.*...) sao lidas por `t()`; as demais ficam na tabela local abaixo (chaves PROPOSTAS
 * para locales/*.json) e passam a vir do JSON automaticamente quando existirem.
 *
 * Tambem cobre comandos cujo `descriptionKey` ainda nao esta nos locales
 * (`help.commands.ping`, `help.commands.catalog`).
 */
import { TMDB_ATTRIBUTION } from "../../catalog/sources/tmdb.js";
import { DEFAULT_LOCALE, type Locale } from "../../config/constants.js";
import { getLocale, hasKey, t } from "../../i18n/index.js";

type Table = Record<string, string>;

const PT: Table = {
  "help.overview_label": "Visão geral",
  "help.commands_count": "{count} comandos",
  "help.owner_only": "restrito ao dono do bot",
  "help.credits": "Kogu Multiverse Gacha & RPG",
  "help.commands.ping": "Mostra a latência do bot.",
  "help.commands.catalog": "Moderação do catálogo (revisão e merge).",
  "help.commands.tuto": "Tutorial interativo de iniciação com bônus de Éter, Rolls e Pacto Extra ($fc).",
  "help.commands.skiptuto": "Conclui o tutorial instantaneamente e resgata o pacote de iniciante.",
  "help.commands.freeclaim": "Usa sua carga de Pacto Extra ($fc) para zerar o cooldown de Pacto.",
  "help.commands.rt": "Zera o cooldown de Pacto usando a Relíquia de Esmeralda (20h).",
  "help.commands.ktower": "Exibe a Torre de Éter (12 andares de bônus passivos).",
  "help.commands.build": "Constrói um andar na Torre de Éter.",
  "help.commands.destroy": "Demole a Torre de Éter e reembolsa 100% do Éter investido.",
  "help.commands.kl": "Abre uma Caixa Astral (Lootbox) em busca de rolls, chaves e bônus.",
  "help.commands.givekakera": "Transfere Éter para outro jogador do servidor.",
  "help.commands.infokeys": "Exibe os marcos de poder e bônus dos Selos de Despertar.",
  "help.commands.arena": "Inicia um duelo RPG na Arena Dimensional com sua carta mais forte.",
  "help.commands.slot": "Gira o Oráculo de Familiares (Pokéslot) para capturar criaturas e ganhar Éter.",
  "help.commands.blacktea": "Inicia uma rodada rápida do Jogo de Palavras (Blacktea) valendo Éter.",
  "help.commands.quiz": "Inicia um Quiz de personagens do catálogo valendo Éter.",
  "help.commands.invite": "Exibe o link de convite oficial do Kogu, Termos de Uso e Privacidade.",
};

const EN: Table = {
  "help.overview_label": "Overview",
  "help.commands_count": "{count} commands",
  "help.owner_only": "bot owner only",
  "help.credits": "Kogu Multiverse Gacha & RPG",
  "help.commands.ping": "Shows the bot latency.",
  "help.commands.catalog": "Catalog moderation (review and merge).",
  "help.commands.tuto": "Interactive starter tutorial with Aether, Rolls and Free Claim ($fc) rewards.",
  "help.commands.skiptuto": "Instantly completes the tutorial and claims the starter pack.",
  "help.commands.freeclaim": "Uses your Free Claim ($fc) charge to reset your Pact cooldown.",
  "help.commands.rt": "Resets your Pact cooldown using the Emerald Relic (20h).",
  "help.commands.ktower": "Shows the Aether Tower (12 floors of passive perks).",
  "help.commands.build": "Builds a floor in the Aether Tower.",
  "help.commands.destroy": "Destroys the Aether Tower and refunds 100% of invested Aether.",
  "help.commands.kl": "Opens an Astral Lootbox for rolls, keys and bonuses.",
  "help.commands.givekakera": "Transfers Aether to another player in the server.",
  "help.commands.infokeys": "Shows power milestones and bonuses for Awakening Seals.",
  "help.commands.arena": "Starts an RPG duel in the Dimensional Arena with your strongest card.",
  "help.commands.slot": "Spins the Familiar Slot Machine (Pokéslot) to capture creatures and win Aether.",
  "help.commands.blacktea": "Starts a quick round of the Blacktea word game for Aether.",
  "help.commands.quiz": "Starts a catalog character Quiz for Aether.",
  "help.commands.invite": "Shows Kogu's official invite link, Terms of Service and Privacy Policy.",
};

export const FALLBACK_MESSAGES: Readonly<Record<Locale, Readonly<Table>>> = {
  "pt-BR": PT,
  "en-US": EN,
};

/** Atribuicao exigida pelo TMDB. O texto em pt-BR e o exportado pelo adapter; en-US usa o oficial. */
export const TMDB_ATTRIBUTION_EN =
  "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export function tmdbAttribution(locale: Locale | string | undefined): string {
  return getLocale(locale) === "en-US" ? TMDB_ATTRIBUTION_EN : TMDB_ATTRIBUTION;
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/** Traduz `key`: JSON de locales se existir, senao a tabela local, senao `undefined`. */
export function lookup(
  locale: Locale | string | undefined,
  key: string,
  params: Record<string, string | number> = {}
): string | undefined {
  const lang = getLocale(locale ?? DEFAULT_LOCALE);
  if (hasKey(key, lang)) return t(key, lang, params);
  const text = FALLBACK_MESSAGES[lang][key] ?? FALLBACK_MESSAGES[DEFAULT_LOCALE][key];
  return text === undefined ? undefined : interpolate(text, params);
}

/** Como `lookup`, mas devolve a propria chave quando nao existe em lugar nenhum. */
export function msg(
  locale: Locale | string | undefined,
  key: string,
  params: Record<string, string | number> = {}
): string {
  return lookup(locale, key, params) ?? key;
}
