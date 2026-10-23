import { getEnv } from "../../config/env.js";
import type { KV } from "../../infra/redis/kv.js";
import { createRateLimiter } from "../../lib/http/rateLimiter.js";
import { childLogger } from "../../lib/logger.js";
import type { CatalogSource, SourceId } from "../types.js";

const log = childLogger("catalog.sources");

export type CatalogSources = Partial<Record<SourceId, CatalogSource>>;

export interface DisabledSource {
  source: SourceId;
  reason: string;
}

export interface CreateSourcesResult {
  sources: CatalogSources;
  disabled: DisabledSource[];
}

interface Spec {
  id: SourceId;
  file: string;
  /** Motivo de desativacao por falta de credencial, ou null se ok. */
  missing: () => string | null;
  options: (kv: KV | undefined) => Record<string, unknown>;
}

const SPECS: Spec[] = [
  {
    id: "ANILIST",
    file: "./anilist.js",
    missing: () => null,
    options: (kv) => ({
      rateLimiter: createRateLimiter({ ...(kv ? { kv } : {}), bucket: "catalog:anilist", ratePerMin: 25, burst: 5 }),
    }),
  },
  {
    id: "JIKAN",
    file: "./jikan.js",
    missing: () => null,
    options: (kv) => ({
      rateLimiter: createRateLimiter({ ...(kv ? { kv } : {}), bucket: "catalog:jikan", ratePerMin: 50, burst: 1 }),
    }),
  },
  {
    id: "IGDB",
    file: "./igdb.js",
    missing: () => {
      const e = getEnv();
      return e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET ? null : "defina TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET";
    },
    options: (kv) => ({ ...(kv ? { kv } : {}) }),
  },
  {
    id: "TMDB",
    file: "./tmdb.js",
    missing: () => (getEnv().TMDB_API_KEY ? null : "defina TMDB_API_KEY"),
    options: (kv) => ({ ...(kv ? { kv } : {}) }),
  },
];

function isSource(x: unknown): x is CatalogSource {
  return !!x && typeof (x as CatalogSource).discover === "function" && typeof (x as CatalogSource).fetchCharacters === "function";
}

/** Acha a classe `XxxSource` (ou fabrica `createXxxSource`) exportada pelo modulo do adapter. */
function instantiate(mod: Record<string, unknown>, id: SourceId, options: Record<string, unknown>): CatalogSource {
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "function") continue;
    const proto = (value as { prototype?: Record<string, unknown> }).prototype;
    if (/Source$/.test(name) && proto && typeof proto.discover === "function") {
      return new (value as new (o: Record<string, unknown>) => CatalogSource)(options);
    }
  }
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === "function" && /^create.*Source$/.test(name)) {
      const made = (value as (o: Record<string, unknown>) => unknown)(options);
      if (isSource(made)) return made;
    }
  }
  throw new Error(`adapter ${id} nao exporta classe/fabrica de fonte`);
}

/**
 * Cria as fontes disponiveis. Imports dinamicos: adapter ausente ou sem credenciais e ignorado
 * (aparece em `disabled`), sem derrubar as demais.
 */
export async function createSources(
  opts: { kv?: KV; only?: readonly SourceId[] } = {}
): Promise<CreateSourcesResult> {
  const sources: CatalogSources = {};
  const disabled: DisabledSource[] = [];

  for (const spec of SPECS) {
    if (opts.only && !opts.only.includes(spec.id)) continue;
    const missing = spec.missing();
    if (missing) {
      disabled.push({ source: spec.id, reason: missing });
      continue;
    }
    try {
      const file = spec.file;
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const source = instantiate(mod, spec.id, spec.options(opts.kv));
      const configured = (source as { isConfigured?: () => boolean }).isConfigured;
      if (typeof configured === "function" && !configured.call(source)) {
        disabled.push({ source: spec.id, reason: "credenciais invalidas ou ausentes" });
        continue;
      }
      sources[spec.id] = source;
    } catch (err) {
      disabled.push({ source: spec.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  for (const d of disabled) log.warn({ source: d.source, reason: d.reason }, "fonte do catalogo desativada");
  return { sources, disabled };
}
