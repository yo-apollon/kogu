import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Piscina } from "piscina";
import type { CardVariant, EntityTier } from "../../config/gacha.js";
import type { UniverseKey } from "../skins/types.js";
import { getCardCache } from "./cache.js";
import { canvasWarn, planCard, renderCard, type RenderCardInput } from "./renderer.js";
import type { WorkerResult } from "./worker.js";

/**
 * Pool de render (piscina) com fallback in-process.
 *
 * Como o worker e resolvido:
 *  - Producao (node dist/...): este modulo e `.js`, entao o worker e `./worker.js` ao lado dele
 *    (dist/canvas/engine/worker.js). Modo `auto` => pool ligado.
 *  - Dev (tsx): este modulo e `.ts`. `auto` => render in-process (sem worker), porque carregar TS
 *    em worker_threads depende do loader do tsx. `CANVAS_POOL=on` forca o pool apontando para
 *    `./worker.ts` (funciona herdando o execArgv do tsx); se o worker nao subir, cai in-process.
 *  - `CANVAS_POOL=off` desliga sempre.
 */
export type CanvasPoolMode = "on" | "off" | "auto";

const TASK_TIMEOUT_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 3;

let pool: Piscina | null = null;
let disabled = false;
let failures = 0;

function isTsRuntime(): boolean {
  return path.extname(fileURLToPath(import.meta.url)) === ".ts";
}

export function canvasPoolMode(): { mode: CanvasPoolMode; enabled: boolean } {
  const raw = (process.env.CANVAS_POOL ?? "auto").toLowerCase();
  const mode: CanvasPoolMode = raw === "on" || raw === "off" ? raw : "auto";
  const enabled = !disabled && (mode === "on" || (mode === "auto" && !isTsRuntime()));
  return { mode, enabled };
}

export function canvasPoolThreads(): number {
  return Math.max(1, Math.min(4, os.cpus().length - 1));
}

function getPool(): Piscina | null {
  if (!canvasPoolMode().enabled) return null;
  if (pool) return pool;
  try {
    const ext = isTsRuntime() ? ".ts" : ".js";
    const filename = fileURLToPath(new URL(`./worker${ext}`, import.meta.url));
    pool = new Piscina({
      filename,
      minThreads: 1,
      maxThreads: canvasPoolThreads(),
      idleTimeout: 60_000,
      maxQueue: 1024,
    });
    pool.on("error", (err: unknown) => canvasWarn("worker de canvas reportou erro", { err: String(err) }));
    return pool;
  } catch (err) {
    disabled = true;
    canvasWarn("pool de canvas indisponivel; render in-process", { err: String(err) });
    return null;
  }
}

/**
 * Renderiza a carta (WebP) no pool. Consulta o cache de carta pronta na thread principal e, se o worker
 * falhar (nao subiu, estourou o timeout, fila cheia), renderiza in-process para nunca deixar o usuario sem carta.
 */
export async function renderCardInPool(input: RenderCardInput): Promise<Buffer> {
  const cache = getCardCache();
  const plan = planCard(input);
  const hit = cache.get(plan.key);
  if (hit) return hit;

  const p = getPool();
  if (!p) return renderCard(input, { cache });

  try {
    const out = (await p.run(input, { signal: AbortSignal.timeout(TASK_TIMEOUT_MS) })) as WorkerResult;
    failures = 0;
    const buf = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength);
    if (out.complete) cache.set(plan.key, buf);
    return buf;
  } catch (err) {
    failures++;
    fallbacks++;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      disabled = true;
      void pool?.destroy().catch(() => {});
      pool = null;
      canvasWarn("pool de canvas desligado apos falhas seguidas; render in-process", { err: String(err) });
    } else {
      canvasWarn("falha no worker de canvas; render in-process nesta carta", { err: String(err) });
    }
    return renderCard(input, { cache });
  }
}

export interface CanvasPoolStats {
  mode: CanvasPoolMode;
  enabled: boolean;
  threads: number;
  completed: number;
  fallbacks: number;
}

let fallbacks = 0;

export function canvasPoolStats(): CanvasPoolStats {
  const { mode, enabled } = canvasPoolMode();
  return { mode, enabled, threads: pool?.threads.length ?? 0, completed: pool?.completed ?? 0, fallbacks };
}

/** Encerra o pool (shutdown do bot / fim de scripts). */
export async function shutdownCanvasPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.destroy();
}

/* ------------------------------------------------------------------ */
/* Compat com o renderer legado                                        */
/* ------------------------------------------------------------------ */

/** Mesmas opcoes de `renderCharacterCard` (src/canvas/cardRenderer.ts) + campos novos opcionais. */
export interface CardRenderOptions {
  name: string;
  franchise: string;
  universe: string;
  imageUrl?: string;
  variant: CardVariant;
  awakeningKeys?: number;
  aetherValue: number;
  popularityRank?: number;
  atk?: number;
  def?: number;
  spd?: number;
  ownerName?: string;
  isWish?: boolean;
  // novos (opcionais)
  entityId?: string;
  imageKey?: string;
  tier?: EntityTier;
  locale?: string;
  preferredSkinId?: string;
}

const UNIVERSES: readonly UniverseKey[] = ["ANIME", "GAME", "CINEMA", "MYTHOLOGY", "ORIGINAL", "WEAPON"];

function toUniverse(raw: string): UniverseKey {
  const up = raw.toUpperCase();
  return (UNIVERSES as readonly string[]).includes(up) ? (up as UniverseKey) : "ORIGINAL";
}

/**
 * Substituto direto de `renderCharacterCard`. ATENCAO: devolve WebP (o legado devolvia PNG);
 * anexe como `card.webp`.
 */
export async function renderCharacterCard(options: CardRenderOptions): Promise<Buffer> {
  const { universe, isWish: _isWish, ...rest } = options;
  return renderCardInPool({ ...rest, universe: toUniverse(universe) });
}
