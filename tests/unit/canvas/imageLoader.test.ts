import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageLoader, createSafeImageFetcher, imageCacheKey, type ImageFetcher } from "../../../src/canvas/engine/imageLoader.js";
import { makeSyntheticPortrait } from "../../../src/scripts/testCanvas.js";

const GOOD = "https://s4.anilist.co/file/x.png";
const tmpDirs: string[] = [];

async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "arqon-img-"));
  tmpDirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function response(body: Uint8Array | string, init: ResponseInit & { type?: string } = {}): Response {
  return new Response(body, { status: 200, ...init, headers: { "content-type": init.type ?? "image/png", ...(init.headers as Record<string, string>) } });
}

describe("createSafeImageFetcher (adaptador de safeFetchImage)", () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("baixa imagem valida de host da allowlist", async () => {
    const png = await makeSyntheticPortrait(0);
    const fetchImpl = vi.fn(async () => response(png));
    const f = createSafeImageFetcher({ fetchImpl: fetchImpl as any, lookupImpl: publicLookup });
    expect((await f.fetch(GOOD))?.length).toBe(png.length);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("nao chama a rede para host fora da allowlist nem para http", async () => {
    const fetchImpl = vi.fn(async () => response("x"));
    const f = createSafeImageFetcher({ fetchImpl: fetchImpl as any, lookupImpl: publicLookup });
    expect(await f.fetch("https://evil.example.com/a.png")).toBeNull();
    expect(await f.fetch("http://s4.anilist.co/a.png")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bloqueia host que resolve para IP privado", async () => {
    const fetchImpl = vi.fn(async () => response("x"));
    const f = createSafeImageFetcher({ fetchImpl: fetchImpl as any, lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }] });
    expect(await f.fetch(GOOD)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("content-type invalido, status de erro e corpo acima do limite viram null", async () => {
    const mk = (fetchImpl: unknown, maxBytes?: number) => createSafeImageFetcher({ fetchImpl: fetchImpl as any, lookupImpl: publicLookup, maxBytes });
    expect(await mk(async () => response("<html>", { type: "text/html" })).fetch(GOOD)).toBeNull();
    expect(await mk(async () => response("x", { status: 404 })).fetch(GOOD)).toBeNull();
    expect(await mk(async () => response(new Uint8Array(2048)), 1024).fetch(GOOD)).toBeNull();
  });

  it("erro de rede vira null", async () => {
    const f = createSafeImageFetcher({ fetchImpl: (async () => Promise.reject(new Error("boom"))) as any, lookupImpl: publicLookup });
    expect(await f.fetch(GOOD)).toBeNull();
  });
});
describe("ImageLoader", () => {
  it("cache em memoria: 2a chamada nao busca; cache em disco: nova instancia le do disco", async () => {
    const dir = await tmp();
    const png = await makeSyntheticPortrait(1);
    const fetcher: ImageFetcher = { fetch: vi.fn(async () => png) };

    const a = new ImageLoader({ fetcher, cacheDir: dir });
    expect(await a.getBuffer(GOOD)).toEqual(png);
    expect(await a.getBuffer(GOOD)).toEqual(png);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(a.stats).toMatchObject({ fetches: 1, memoryHits: 1 });

    const onDisk = await fs.readFile(path.join(dir, imageCacheKey(GOOD)));
    expect(onDisk.equals(png)).toBe(true);

    const b = new ImageLoader({ fetcher, cacheDir: dir });
    expect(await b.getBuffer(GOOD)).toEqual(png);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(b.stats.diskHits).toBe(1);
  });

  it("chave em disco e sha1(url)", () => {
    expect(imageCacheKey("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("deduplica downloads simultaneos da mesma URL", async () => {
    const png = await makeSyntheticPortrait(2);
    let calls = 0;
    const fetcher: ImageFetcher = {
      fetch: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 20));
        return png;
      },
    };
    const loader = new ImageLoader({ fetcher, cacheDir: false });
    await Promise.all([loader.getBuffer(GOOD), loader.getBuffer(GOOD), loader.getBuffer(GOOD)]);
    expect(calls).toBe(1);
  });

  it("falha e lembrada (cache negativo) e load devolve null", async () => {
    const fetcher: ImageFetcher = { fetch: vi.fn(async () => null) };
    const loader = new ImageLoader({ fetcher, cacheDir: false });
    expect(await loader.load(GOOD)).toBeNull();
    expect(await loader.load(GOOD)).toBeNull();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    expect(await loader.load(undefined)).toBeNull();
  });

  it("bytes que nao sao imagem => null", async () => {
    const loader = new ImageLoader({ fetcher: { fetch: async () => Buffer.from("isto nao e uma imagem") }, cacheDir: false });
    expect(await loader.load(GOOD)).toBeNull();
  });

  it("decodifica e reaproveita a imagem", async () => {
    const png = await makeSyntheticPortrait(3);
    const loader = new ImageLoader({ fetcher: { fetch: async () => png }, cacheDir: false });
    const img = await loader.load(GOOD);
    expect(img?.width).toBe(600);
    expect(await loader.load(GOOD)).toBe(img);
  });
});
