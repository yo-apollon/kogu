import { createCanvas, type Canvas, type Image } from "@napi-rs/canvas";
import { DEFAULT_LOCALE } from "../../config/constants.js";
import type { CardVariant, EntityTier } from "../../config/gacha.js";
import type { CardArt } from "../../catalog/artQuality.js";
import { hashSeed } from "../effects/noise.js";
import { getSkin, selectSkin } from "../skins/registry.js";
import type { AssetBag, CardRenderContext, CardSkin, UniverseKey } from "../skins/types.js";
import { resolveTheme } from "../theme/tokens.js";
import { CardCache, getCardCache, hashParts, loadAssetBag } from "./cache.js";
import { resolveInputArt } from "./artResolver.js";
import { registerFonts } from "./fonts.js";
import { getImageLoader, type ImageLoader } from "./imageLoader.js";

export const WEBP_QUALITY = 88;

/** Entrada serializavel (structured clone): pode ir para o worker sem alteracao. */
export interface RenderCardInput {
  /** Id estavel da entidade (entra na chave de cache e na semente). Padrao: name. */
  entityId?: string;
  name: string;
  franchise: string;
  universe: UniverseKey;
  tier?: EntityTier;
  variant: CardVariant;
  awakeningKeys?: number;
  aetherValue: number;
  popularityRank?: number;
  atk?: number;
  def?: number;
  spd?: number;
  ownerName?: string;
  locale?: string;
  /** URL do retrato; baixada FORA do draw() pelo ImageLoader. */
  imageUrl?: string;
  /** Chave estavel da imagem (ex.: id da imagem primaria); padrao: imageUrl. */
  imageKey?: string;
  /** Tipo da entidade (entity_type). Itens (WEAPON/COMPANION/DOMAIN) so mostram imagem via override; senao, emblema. */
  entityType?: string;
  /** Slug da entidade (chave dos overrides em data/art/overrides.json). */
  slug?: string;
  /** Descricao (ajuda a escolher o emblema de item). */
  description?: string;
  /** true = imagem escolhida pelo dono (custom_image_url): sempre desenhada, sem classificar. */
  trustImage?: boolean;
  /** Skin cosmetica escolhida pelo dono. */
  preferredSkinId?: string;
  /** Forca uma skin (ferramentas/testes), ignorando match(). */
  skinId?: string;
  /** Relogio para eventos de skin. Padrao: agora. */
  now?: Date;
}

export interface RenderOptions {
  loader?: ImageLoader;
  /** Cache de carta pronta; `false` desliga (medicao/golden). Padrao: cache compartilhado. */
  cache?: CardCache | false;
  assets?: AssetBag;
}

export interface CardPlan {
  skin: CardSkin;
  key: string;
  seed: number;
  /** Arte resolvida: imagem confiavel ou emblema original. */
  art: CardArt;
}

function warn(message: string, extra?: Record<string, unknown>): void {
  // import dinamico: o logger valida o ambiente no import, e o canvas nao deve depender disso para desenhar.
  void import("../../lib/logger.js")
    .then(({ childLogger }) => childLogger("canvas").warn(extra ?? {}, message))
    .catch(() => {});
}
export { warn as canvasWarn };

/** Escolhe a skin e calcula a chave de cache (barato; roda na thread principal antes do worker). */
export function planCard(input: RenderCardInput): CardPlan {
  const tier = input.tier ?? "COMMON";
  const now = input.now ?? new Date();
  const forced = input.skinId ? getSkin(input.skinId) : undefined;
  const skin =
    forced ??
    selectSkin({ universe: input.universe, tier, variant: input.variant, preferredSkinId: input.preferredSkinId, now });
  const art = resolveInputArt(input);
  // a chave inclui o modo/emblema: trocar a regra de arte (ou um override) invalida a carta pronta
  const imageKey =
    art.mode === "EMBLEM"
      ? `emblem:${art.emblem}`
      : art.url !== (input.imageUrl ?? "")
        ? `override:${art.url}`
        : (input.imageKey ?? input.imageUrl ?? "");
  const entity = input.entityId ?? input.name;
  const key = hashParts([
    `${skin.id}@${skin.version}`,
    entity,
    imageKey,
    input.variant,
    tier,
    input.awakeningKeys ?? 0,
    input.aetherValue,
    input.ownerName,
    input.locale ?? DEFAULT_LOCALE,
    // campos que tambem mudam o desenho
    input.name,
    input.franchise,
    input.universe,
    input.popularityRank,
    input.atk,
    input.def,
    input.spd,
  ]);
  return { skin, key, seed: hashSeed(`${entity}|${input.variant}`), art };
}

export interface DrawnCard {
  canvas: Canvas;
  plan: CardPlan;
  /** false se alguma camada falhou ou o retrato pedido nao carregou: nao deve ser cacheada. */
  complete: boolean;
}

/** Desenha a carta num canvas (sem encode). Faz todo o I/O (retrato, assets) antes das camadas. */
export async function drawCard(input: RenderCardInput, opts: RenderOptions = {}): Promise<DrawnCard> {
  registerFonts();
  const plan = planCard(input);
  const { skin } = plan;
  const tier = input.tier ?? "COMMON";

  const [portrait, assets] = await Promise.all([
    plan.art.mode === "IMAGE" && plan.art.url
      ? (opts.loader ?? getImageLoader()).load(plan.art.url)
      : Promise.resolve<Image | null>(null),
    opts.assets ?? loadAssetBag(),
  ]);

  const ctx: CardRenderContext = {
    name: input.name,
    franchise: input.franchise,
    universe: input.universe,
    tier,
    variant: input.variant,
    awakeningKeys: input.awakeningKeys ?? 0,
    aetherValue: input.aetherValue,
    popularityRank: input.popularityRank,
    atk: input.atk ?? 80,
    def: input.def ?? 75,
    spd: input.spd ?? 85,
    ownerName: input.ownerName,
    locale: input.locale ?? DEFAULT_LOCALE,
    portrait,
    theme: resolveTheme(tier, input.variant),
    seed: plan.seed,
    imageKey: input.imageKey ?? input.imageUrl,
    emblem: plan.art.mode === "EMBLEM" ? plan.art.emblem : undefined,
  };

  const canvas = createCanvas(skin.size.w, skin.size.h);
  const g = canvas.getContext("2d");
  let complete = plan.art.mode === "EMBLEM" || !plan.art.url || portrait !== null;
  for (const layer of skin.layers) {
    g.save();
    try {
      await layer.draw(g, ctx, assets);
    } catch (err) {
      complete = false;
      warn("camada de carta falhou; camada ignorada", { skin: skin.id, layer: layer.id, err: String(err) });
    } finally {
      g.restore();
    }
  }
  return { canvas, plan, complete };
}

/** Renderiza a carta como WebP (qualidade 88), usando o cache de carta pronta. */
export async function renderCard(input: RenderCardInput, opts: RenderOptions = {}): Promise<Buffer> {
  const cache = opts.cache === false ? null : (opts.cache ?? getCardCache());
  const plan = planCard(input);
  const hit = cache?.get(plan.key);
  if (hit) return hit;

  const { canvas, complete } = await drawCard(input, opts);
  const buf = await canvas.encode("webp", WEBP_QUALITY);
  if (cache && complete) cache.set(plan.key, buf);
  return buf;
}
