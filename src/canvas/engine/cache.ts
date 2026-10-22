import crypto from "node:crypto";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { LRUCache } from "lru-cache";
import { mulberry32 } from "../effects/noise.js";
import type { AssetBag } from "../skins/types.js";
import { COLORS, rgba } from "../theme/tokens.js";
import { fontsReady } from "./fonts.js";

/* ------------------------------------------------------------------ */
/* Cache de carta pronta                                               */
/* ------------------------------------------------------------------ */

export interface CardCacheStats {
  hits: number;
  misses: number;
}

/** LRU de WebP prontos (padrao 150 MB). A chave inclui skin@versao, entidade, variante, tier, chaves, eter, dono e locale. */
export class CardCache {
  readonly stats: CardCacheStats = { hits: 0, misses: 0 };
  private readonly lru: LRUCache<string, Buffer>;

  constructor(maxBytes = 150 * 1024 * 1024) {
    this.lru = new LRUCache<string, Buffer>({ maxSize: maxBytes, sizeCalculation: (b) => Math.max(1, b.length) });
  }

  get(key: string): Buffer | undefined {
    const hit = this.lru.get(key);
    if (hit) this.stats.hits++;
    else this.stats.misses++;
    return hit;
  }

  set(key: string, value: Buffer): void {
    this.lru.set(key, value);
  }

  clear(): void {
    this.lru.clear();
  }

  get size(): number {
    return this.lru.size;
  }
}

/** sha1 estavel de partes ordenadas. `undefined` vira vazio. */
export function hashParts(parts: ReadonlyArray<string | number | undefined>): string {
  const h = crypto.createHash("sha1");
  for (const p of parts) {
    h.update(String(p ?? ""));
    h.update("\u0001");
  }
  return h.digest("hex");
}

let sharedCardCache: CardCache | null = null;

export function getCardCache(): CardCache {
  sharedCardCache ??= new CardCache();
  return sharedCardCache;
}

/* ------------------------------------------------------------------ */
/* Assets (texturas procedurais, geradas uma vez por processo)         */
/* ------------------------------------------------------------------ */

class MapAssetBag implements AssetBag {
  constructor(private readonly images: Map<string, Image>) {}
  get fontsReady(): boolean {
    return fontsReady();
  }
  get(name: string): Image | undefined {
    return this.images.get(name);
  }
}

async function toImage(canvas: Canvas): Promise<Image> {
  return loadImage(await canvas.encode("png"));
}

/**
 * Texturas neutras (tile): `grain`, `scanlines`, `halftone`.
 * Sao geradas em codigo para o pacote nao depender de binarios; arquivos em assets/ podem
 * substituir qualquer uma sem mudar as skins (basta chamar registerAsset).
 */
async function buildDefaultAssets(): Promise<Map<string, Image>> {
  const out = new Map<string, Image>();

  const grain = createCanvas(128, 128);
  {
    const g = grain.getContext("2d");
    const rand = mulberry32(0x6a09e667);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = rgba(rand() < 0.5 ? COLORS.white : COLORS.black, 0.25 + rand() * 0.5);
      g.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 1, 1);
    }
  }
  out.set("grain", await toImage(grain));

  const scan = createCanvas(4, 4);
  {
    const g = scan.getContext("2d");
    g.fillStyle = rgba(COLORS.black, 0.55);
    g.fillRect(0, 0, 4, 1);
  }
  out.set("scanlines", await toImage(scan));

  const dots = createCanvas(10, 10);
  {
    const g = dots.getContext("2d");
    g.fillStyle = rgba(COLORS.white, 0.9);
    g.beginPath();
    g.arc(5, 5, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  out.set("halftone", await toImage(dots));

  return out;
}

let assetPromise: Promise<AssetBag> | null = null;
const overrides = new Map<string, Image>();

/** Carrega (uma vez) as texturas. Nunca chamado dentro de draw(). */
export function loadAssetBag(): Promise<AssetBag> {
  assetPromise ??= buildDefaultAssets().then((m) => {
    for (const [k, v] of overrides) m.set(k, v);
    return new MapAssetBag(m);
  });
  return assetPromise;
}

/** Permite injetar/substituir um asset antes do primeiro loadAssetBag (ex.: moldura em PNG). */
export function registerAsset(name: string, image: Image): void {
  overrides.set(name, image);
}
