import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "../config/constants.js";
import type { PluralKey, TranslationKey } from "./keys.js";

export type { Locale } from "../config/constants.js";
export type { PluralKey, TranslationKey } from "./keys.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.resolve(__dirname, "../../locales");
const translations: Record<string, any> = {};

// Carrega todos os arquivos .json da pasta locales
try {
  const files = fs.readdirSync(localesDir);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const lang = file.replace(".json", "");
      const content = fs.readFileSync(path.join(localesDir, file), "utf-8");
      translations[lang] = JSON.parse(content);
    }
  }
} catch (e) {
  console.warn("Aviso ao carregar locales:", e);
}

export type Replacements = Record<string, string | number>;

/**
 * Normaliza um codigo de idioma livre ("pt-br", "pt_BR", "en", "en-GB", "EN-us")
 * para um `Locale` suportado. Desconhecido ou vazio cai em `DEFAULT_LOCALE`.
 */
export function getLocale(raw: string | null | undefined): Locale {
  if (!raw) return DEFAULT_LOCALE;
  const norm = raw.trim().toLowerCase().replace(/_/g, "-");
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === norm);
  if (exact) return exact;
  const base = norm.split("-")[0];
  if (base === "pt") return "pt-BR";
  if (base === "en") return "en-US";
  return DEFAULT_LOCALE;
}

function lookup(lang: string, keys: string[]): string | undefined {
  let current: any = translations[lang];
  for (const k of keys) {
    if (current && typeof current === "object" && k in current) current = current[k];
    else return undefined;
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(text: string, replacements: Replacements): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(replacements, name) ? String(replacements[name]) : match
  );
}

/** Resolve a chave no idioma, com fallback para pt-BR; `undefined` se nao existir. */
function resolve(key: string, lang: string): string | undefined {
  const keys = key.split(".");
  const selected = translations[lang] ? lang : getLocale(lang);
  return lookup(selected, keys) ?? lookup(DEFAULT_LOCALE, keys);
}

/**
 * Traduz `key` para `lang`, substituindo `{placeholder}` por `replacements`.
 * Chave ausente no idioma cai para pt-BR; ausente em ambos devolve a propria chave.
 */
export function t(
  key: TranslationKey | (string & {}),
  lang: string = DEFAULT_LOCALE,
  replacements: Replacements = {}
): string {
  const text = resolve(key, lang);
  if (text === undefined) return key;
  return interpolate(text, replacements);
}

/** `true` se a chave existe (em pt-BR ou no idioma pedido). */
export function hasKey(key: string, lang: string = DEFAULT_LOCALE): boolean {
  return resolve(key, lang) !== undefined;
}

/**
 * Traducao com plural. Para a base `foo.bar`, procura `foo.bar_zero` (somente
 * quando count == 0), depois `foo.bar_<categoria Intl.PluralRules>` e por fim
 * `foo.bar_other`. `{count}` e preenchido automaticamente.
 */
export function tPlural(
  key: PluralKey | (string & {}),
  count: number,
  lang: string = DEFAULT_LOCALE,
  replacements: Replacements = {}
): string {
  const locale = getLocale(lang);
  const params: Replacements = { count, ...replacements };
  const candidates: string[] = [];
  if (count === 0) candidates.push(`${key}_zero`);
  candidates.push(`${key}_${new Intl.PluralRules(locale).select(count)}`, `${key}_other`);
  for (const candidate of candidates) {
    const text = resolve(candidate, lang);
    if (text !== undefined) return interpolate(text, params);
  }
  return key;
}

/** Atalho: devolve um `t` ja vinculado a um idioma (para `CommandContext`). */
export function translator(lang: string) {
  return (key: TranslationKey | (string & {}), replacements: Replacements = {}) =>
    t(key, lang, replacements);
}
