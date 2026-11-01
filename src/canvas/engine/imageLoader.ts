import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadImage, type Image } from "@napi-rs/canvas";
import { LRUCache } from "lru-cache";
import { safeFetchImage, type SafeFetchImageOptions } from "../../lib/http/safeFetch.js";

/**
 * Dependencia de rede injetada (testes e ferramentas passam fetchers locais).
 * Contrato: devolver Buffer ou null (nunca lancar).
 */
export interface ImageFetcher {
  fetch(url: string): Promise<Buffer | null>;
}

/**
 * Fetcher padrao: `safeFetchImage` (https + allowlist de hosts, bloqueio de IP privado, limite de 8 MB,
 * timeout, redirects revalidados). Qualquer falha vira null e a skin desenha o fallback.
 */
export function createSafeImageFetcher(opts: SafeFetchImageOptions = {}): ImageFetcher {
  return {
    async fetch(url: string): Promise<Buffer | null> {
      try {
        return (await safeFetchImage(url, opts)).buffer;
      } catch {
        return null;
      }
    },
  };
}
export interface ImageLoaderOptions {
  fetcher?: ImageFetcher;
  /** Pasta do cache em disco; `false` desliga. Padrao: ARQON_IMAGE_CACHE_DIR ou <cwd>/.cache/img. */
  cacheDir?: string | false;
  /** Teto do cache de bytes em memoria. Padrao 100 MB. */
  memoryMaxBytes?: number;
  /** Quantas imagens decodificadas manter. Padrao 32. */
  decodedMax?: number;
  /** Tempo para nao tentar de novo uma URL que falhou (ms). Padrao 60 s. */
  negativeTtlMs?: number;
}

export interface ImageLoaderStats {
  memoryHits: number;
  diskHits: number;
  fetches: number;
  failures: number;
}

export function imageCacheKey(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex");
}

/**
 * Carrega retratos antes do desenho (o `draw()` das skins nunca faz I/O).
 * Ordem: LRU de bytes (memoria) -> disco `.cache/img/<sha1(url)>` -> fetcher.
 */
export class ImageLoader {
  readonly stats: ImageLoaderStats = { memoryHits: 0, diskHits: 0, fetches: 0, failures: 0 };
  private readonly fetcher: ImageFetcher;
  private readonly dir: string | null;
  private readonly bytes: LRUCache<string, Buffer>;
  private readonly decoded: LRUCache<string, Image>;
  private readonly failedUntil = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Buffer | null>>();
  private readonly negativeTtlMs: number;

  constructor(opts: ImageLoaderOptions = {}) {
    this.fetcher = opts.fetcher ?? createSafeImageFetcher({ allowAnyPublicHost: true });
    this.dir = opts.cacheDir === false ? null : path.resolve(opts.cacheDir ?? process.env.KOGU_IMAGE_CACHE_DIR ?? process.env.ARQON_IMAGE_CACHE_DIR ?? path.join(process.cwd(), ".cache", "img"));
    this.negativeTtlMs = opts.negativeTtlMs ?? 60_000;
    this.bytes = new LRUCache<string, Buffer>({
      maxSize:
        opts.memoryMaxBytes ??
        (process.env.IMAGE_LOADER_MAX_BYTES
          ? Number(process.env.IMAGE_LOADER_MAX_BYTES)
          : 35 * 1024 * 1024),
      sizeCalculation: (b) => Math.max(1, b.length),
    });
    this.decoded = new LRUCache<string, Image>({ max: opts.decodedMax ?? 32 });
  }

  /** Bytes da imagem (memoria, disco ou rede). null se indisponivel. */
  async getBuffer(url: string): Promise<Buffer | null> {
    const key = imageCacheKey(url);
    const mem = this.bytes.get(key);
    if (mem) {
      this.stats.memoryHits++;
      return mem;
    }
    const failed = this.failedUntil.get(key);
    if (failed && failed > Date.now()) return null;

    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.fill(url, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async fill(url: string, key: string): Promise<Buffer | null> {
    if (this.dir) {
      try {
        const buf = await fs.readFile(path.join(this.dir, key));
        if (buf.length > 0) {
          this.stats.diskHits++;
          this.bytes.set(key, buf);
          return buf;
        }
      } catch {
        // miss
      }
    }
    this.stats.fetches++;
    const buf = await this.fetcher.fetch(url);
    if (!buf || buf.length === 0) {
      this.stats.failures++;
      this.failedUntil.set(key, Date.now() + this.negativeTtlMs);
      return null;
    }
    this.bytes.set(key, buf);
    if (this.dir) await this.writeDisk(key, buf);
    return buf;
  }

  private async writeDisk(key: string, buf: Buffer): Promise<void> {
    if (!this.dir) return;
    try {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = path.join(this.dir, `${key}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`);
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, path.join(this.dir, key));
    } catch {
      // cache em disco e otimizacao; ignorar falhas
    }
  }

  /** Imagem decodificada pronta para drawImage, ou null (a skin desenha o fallback). */
  async load(url: string | undefined): Promise<Image | null> {
    if (!url) return null;
    const key = imageCacheKey(url);
    const hit = this.decoded.get(key);
    if (hit) return hit;
    const buf = await this.getBuffer(url);
    if (!buf) return null;
    try {
      const img = await loadImage(buf);
      this.decoded.set(key, img);
      return img;
    } catch {
      this.failedUntil.set(key, Date.now() + this.negativeTtlMs);
      return null;
    }
  }

  clear(): void {
    this.bytes.clear();
    this.decoded.clear();
    this.failedUntil.clear();
  }
}

let shared: ImageLoader | null = null;

/** Instancia compartilhada do processo/worker. */
export function getImageLoader(): ImageLoader {
  shared ??= new ImageLoader();
  return shared;
}

export function setImageLoader(loader: ImageLoader | null): void {
  shared = loader;
}
