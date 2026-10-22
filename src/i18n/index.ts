import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

export function t(
  key: string,
  lang: string = "pt-BR",
  replacements: Record<string, string | number> = {}
): string {
  const selectedLang = translations[lang] || translations["pt-BR"] || translations["en-US"] || {};
  const keys = key.split(".");
  let current: any = selectedLang;

  for (const k of keys) {
    if (current && typeof current === "object" && k in current) {
      current = current[k];
    } else {
      // Fallback para pt-BR
      let fallback = translations["pt-BR"];
      for (const fk of keys) {
        if (fallback && typeof fallback === "object" && fk in fallback) {
          fallback = fallback[fk];
        } else {
          return key;
        }
      }
      current = fallback;
      break;
    }
  }

  if (typeof current !== "string") return key;

  let text = current;
  for (const [placeholder, value] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`{${placeholder}}`, "g"), String(value));
  }

  return text;
}
