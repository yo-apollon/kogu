import { registerFonts } from "./fonts.js";
import { WEBP_QUALITY, drawCard, type RenderCardInput } from "./renderer.js";

/**
 * Tarefa do pool (piscina). Cada thread registra as fontes uma vez, mantem seu proprio ImageLoader
 * (LRU de bytes + cache em disco compartilhado) e o AssetBag, e devolve o WebP.
 * O cache de carta pronta fica na thread principal (pool.ts), nao aqui.
 */
registerFonts();

export interface WorkerResult {
  data: Uint8Array;
  /** false => nao cachear (camada falhou ou retrato pedido nao carregou). */
  complete: boolean;
}

export default async function renderTask(input: RenderCardInput): Promise<WorkerResult> {
  const { canvas, complete } = await drawCard(input);
  const data = await canvas.encode("webp", WEBP_QUALITY);
  return { data, complete };
}
