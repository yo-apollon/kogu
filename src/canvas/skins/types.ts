import type { SKRSContext2D, Image } from "@napi-rs/canvas";
import type { CardVariant, EntityTier } from "../../config/gacha.js";

export type UniverseKey = "ANIME" | "GAME" | "CINEMA" | "MYTHOLOGY" | "ORIGINAL" | "WEAPON";

/** Tokens de cor/estilo resolvidos por tier x variante. */
export interface ThemeTokens {
  primary: string;
  secondary: string;
  glow: string;
  badgeBg: string;
  label: string;
  borderWidth: number;
  glowBlur: number;
}

/** Tudo que uma carta precisa para ser desenhada. Deterministico: mesmo contexto => mesma imagem. */
export interface CardRenderContext {
  name: string;
  franchise: string;
  universe: UniverseKey;
  tier: EntityTier;
  variant: CardVariant;
  awakeningKeys: number;
  aetherValue: number;
  popularityRank?: number;
  atk: number;
  def: number;
  spd: number;
  ownerName?: string;
  locale: string;
  /** Retrato ja carregado; null => a skin desenha o fallback. */
  portrait: Image | null;
  theme: ThemeTokens;
  /** Semente deterministica para ruido/particulas. */
  seed: number;
  /** Chave de imagem para cache (id da imagem primaria). */
  imageKey?: string;
}

/** Contexto para decidir se uma skin se aplica. */
export interface SkinMatchContext {
  universe: UniverseKey;
  tier: EntityTier;
  variant: CardVariant;
  /** Skin cosmetica escolhida pelo dono, se houver. */
  preferredSkinId?: string;
  now: Date;
}

/** Biblioteca de assets ja carregados (molduras, texturas). */
export interface AssetBag {
  fontsReady: boolean;
  get(name: string): Image | undefined;
}

export interface CardLayer {
  id: string;
  draw(g: SKRSContext2D, c: CardRenderContext, a: AssetBag): void | Promise<void>;
}

export interface CardSkin {
  id: string;
  version: number;
  label: string;
  size: { w: number; h: number };
  /** 0 = nao se aplica; maior valor vence. */
  match(ctx: SkinMatchContext): number;
  layers: CardLayer[];
}
