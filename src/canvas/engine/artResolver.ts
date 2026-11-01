import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { indexOverrides, resolveCardArt, type ArtOverride, type CardArt } from "../../catalog/artQuality.js";
import type { RenderCardInput } from "./renderer.js";

/** data/art/overrides.json fica na raiz do projeto, tanto em src/canvas/engine quanto em dist/canvas/engine. */
const DEFAULT_PATH = fileURLToPath(new URL("../../../data/art/overrides.json", import.meta.url));

let cached: { path: string; map: Map<string, ArtOverride> } | null = null;

function isOverride(v: unknown): v is ArtOverride {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.slug === "string" &&
    typeof o.url === "string" &&
    (o.kind === "CHARACTER" || o.kind === "ITEM") &&
    typeof o.source === "string"
  );
}

/** Le os overrides uma vez por processo (arquivo ausente ou invalido = nenhum override). */
export function loadArtOverrides(path: string = process.env.ART_OVERRIDES_PATH || DEFAULT_PATH): Map<string, ArtOverride> {
  if (cached && cached.path === path) return cached.map;
  let list: ArtOverride[] = [];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) list = parsed.filter(isOverride);
  } catch {
    list = [];
  }
  cached = { path, map: indexOverrides(list) };
  return cached.map;
}

/** Para testes: descarta o cache de overrides. */
export function resetArtOverridesCache(): void {
  cached = null;
}

/** Arte final de uma entrada de render (IMAGE confiavel ou EMBLEM). */
export function resolveInputArt(input: RenderCardInput, overrides = loadArtOverrides()): CardArt {
  return resolveCardArt(
    {
      type: input.entityType,
      universe: input.universe,
      imageUrl: input.imageUrl,
      name: input.name,
      slug: input.slug,
      description: input.description,
      trustImage: input.trustImage,
    },
    overrides
  );
}
