/**
 * Validadores e limites das configuracoes do servidor editaveis ($setrolls, $settimer, $setclaim,
 * $gamemode, $prefix, $lang e o painel da dashboard). PURO: copiado para a dashboard, entao nao
 * importa discord.js, redis nem i18n.
 */
import { z } from "zod";
import type { guilds } from "../infra/db/schema/guilds.js";

export const SETTING_KEYS = ["rolls", "timer", "claim", "gamemode", "prefix", "lang"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Idiomas suportados (espelha `SUPPORTED_LOCALES` de config/constants.ts). */
export const SETTING_LOCALES = ["pt-BR", "en-US"] as const;
export type SettingLocale = (typeof SETTING_LOCALES)[number];

/** Faixas aceitas (as do bot antigo, com `rolls` a partir de 1). */
export const SETTING_LIMITS = {
  rolls: { min: 1, max: 50 },
  /** Recarga do Pacto, em minutos (`claim_cooldown_minutes`). */
  timer: { min: 30, max: 360 },
  /** Janela para firmar o Pacto, em segundos (`claim_window_seconds`). */
  claim: { min: 10, max: 120 },
  gamemode: { min: 1, max: 2 },
  prefix: { min: 1, max: 5 },
} as const;

/** Numero inteiro dentro da faixa; aceita numero ou texto "15". Negativos/decimais/vazio falham. */
export function intInRange(min: number, max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" && /^\s*\d{1,9}\s*$/.test(v) ? Number(v) : v),
    z.number().int().min(min).max(max)
  );
}

export const LANG_ALIASES: ReadonlyMap<string, SettingLocale> = new Map<string, SettingLocale>([
  ["pt-br", "pt-BR"],
  ["pt_br", "pt-BR"],
  ["ptbr", "pt-BR"],
  ["pt", "pt-BR"],
  ["en", "en-US"],
  ["en-us", "en-US"],
  ["en_us", "en-US"],
  ["enus", "en-US"],
]);

export const settingSchemas = {
  rolls: intInRange(SETTING_LIMITS.rolls.min, SETTING_LIMITS.rolls.max),
  timer: intInRange(SETTING_LIMITS.timer.min, SETTING_LIMITS.timer.max),
  claim: intInRange(SETTING_LIMITS.claim.min, SETTING_LIMITS.claim.max),
  gamemode: intInRange(SETTING_LIMITS.gamemode.min, SETTING_LIMITS.gamemode.max),
  prefix: z
    .string()
    .min(SETTING_LIMITS.prefix.min)
    .max(SETTING_LIMITS.prefix.max)
    // Sem espacos nem crase (a confirmacao exibe o prefixo dentro de codigo inline).
    .regex(/^[^\s`]+$/u),
  lang: z
    .string()
    .transform((v) => LANG_ALIASES.get(v.trim().toLowerCase()))
    .pipe(z.enum(SETTING_LOCALES)),
} as const;

export type SettingValues = { [K in SettingKey]: z.output<(typeof settingSchemas)[K]> };

/** Faixa numerica de cada configuracao (`lang` nao tem faixa). */
export function limitsOf(key: SettingKey): { min: number; max: number } {
  if (key === "lang") return { min: 0, max: 0 };
  return SETTING_LIMITS[key];
}

/** Colunas de `guilds` alteradas por cada configuracao. */
export function patchFor(
  key: SettingKey,
  value: SettingValues[SettingKey]
): Partial<typeof guilds.$inferInsert> {
  switch (key) {
    case "rolls":
      return { baseRolls: value as number };
    case "timer":
      return { claimCooldownMinutes: value as number };
    case "claim":
      return { claimWindowSeconds: value as number };
    case "gamemode":
      return { gamemode: value as number };
    case "prefix":
      return { prefix: value as string };
    case "lang":
      return { language: value as SettingLocale };
  }
}

/** Mudar a recarga do Pacto muda a escala da janela de pactos: zerar as janelas dos membros. */
export const RESETS_WINDOWS: ReadonlySet<SettingKey> = new Set(["timer"]);