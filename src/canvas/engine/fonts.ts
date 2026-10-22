import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts } from "@napi-rs/canvas";

/** Familias nomeadas usadas pelas skins. */
export const FONT_FAMILIES = ["Inter", "Cinzel", "Noto Sans JP"] as const;

/** Arquivos em assets/fonts (todos OFL, licencas ao lado). */
const FONT_FILES: ReadonlyArray<{ family: (typeof FONT_FAMILIES)[number]; file: string }> = [
  { family: "Inter", file: "Inter-Regular.woff2" },
  { family: "Inter", file: "Inter-SemiBold.woff2" },
  { family: "Inter", file: "Inter-Bold.woff2" },
  { family: "Cinzel", file: "Cinzel-Variable.ttf" },
  { family: "Noto Sans JP", file: "NotoSansJP-Regular.otf" },
  { family: "Noto Sans JP", file: "NotoSansJP-Bold.otf" },
];

export interface FontsStatus {
  ok: boolean;
  dir: string;
  registered: string[];
  missing: string[];
}

let status: FontsStatus | null = null;

/**
 * Resolve assets/fonts. src/canvas/engine e dist/canvas/engine ficam na mesma profundidade,
 * entao `../../../assets` serve em dev (tsx) e em producao. ARQON_ASSETS_DIR sobrescreve.
 */
export function resolveAssetsDir(): string {
  const override = process.env.ARQON_ASSETS_DIR;
  if (override) return path.resolve(override);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../assets");
}

/**
 * Registra as fontes empacotadas. Idempotente: so toca o disco na primeira chamada por processo/thread.
 * Fonte ausente nao quebra: o status lista `missing` e o texto cai para fontes de sistema (sans-serif/serif).
 */
export function registerFonts(): FontsStatus {
  if (status) return status;
  const dir = path.join(resolveAssetsDir(), "fonts");
  const registered: string[] = [];
  const missing: string[] = [];
  for (const { family, file } of FONT_FILES) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      missing.push(file);
      continue;
    }
    const key = GlobalFonts.registerFromPath(full, family);
    if (key) registered.push(file);
    else missing.push(file);
  }
  status = { ok: missing.length === 0, dir, registered, missing };
  return status;
}

export function fontsReady(): boolean {
  return status?.ok ?? false;
}

/** So para testes. */
export function _resetFontsStatus(): void {
  status = null;
}
