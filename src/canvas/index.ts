/** API publica do modulo de arte. O bot usa estas funcoes; o restante e detalhe de implementacao. */
export { renderCard, drawCard, planCard, WEBP_QUALITY } from "./engine/renderer.js";
export type { RenderCardInput, RenderOptions, CardPlan } from "./engine/renderer.js";
export { renderCardInPool, renderCharacterCard, shutdownCanvasPool, canvasPoolMode } from "./engine/pool.js";
export type { CardRenderOptions } from "./engine/pool.js";
export { registerFonts, FONT_FAMILIES } from "./engine/fonts.js";
export { ImageLoader, createSafeImageFetcher, getImageLoader, setImageLoader } from "./engine/imageLoader.js";
export type { ImageFetcher } from "./engine/imageLoader.js";
export { CardCache, getCardCache } from "./engine/cache.js";
export { registerSkin, getSkin, listSkins, selectSkin } from "./skins/registry.js";
export { resolveTheme } from "./theme/tokens.js";
export type { CardSkin, CardLayer, CardRenderContext, ThemeTokens, SkinMatchContext, UniverseKey } from "./skins/types.js";
