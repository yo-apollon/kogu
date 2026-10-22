import type { SKRSContext2D } from "@napi-rs/canvas";
import type { CardRenderContext } from "../../skins/types.js";
import { drawAstral } from "../../effects/astral.js";
import { drawFoil } from "../../effects/foil.js";
import { drawHolo } from "../../effects/holo.js";
import { tierRank } from "../../theme/tiers.js";
import type { FaceHole } from "./layer.js";
import type { Rect } from "./shapes.js";

/**
 * Efeito de raridade da variante sobre a area da arte. STANDARD nao tem efeito.
 * A intensidade cresce levemente com o tier; `scale` permite a skin atenuar (ex.: noir).
 */
export function drawVariantEffects(
  g: SKRSContext2D,
  c: CardRenderContext,
  rect: Rect,
  hole?: FaceHole | null,
  scale = 1
): void {
  const intensity = (0.85 + tierRank(c.tier) * 0.06) * scale;
  switch (c.variant) {
    case "FOIL":
      drawFoil(g, rect, { seed: c.seed, tint: c.theme.primary, intensity, hole });
      break;
    case "HOLO":
      drawHolo(g, rect, { seed: c.seed, intensity, hole });
      break;
    case "ASTRAL":
      drawAstral(g, rect, { seed: c.seed, theme: c.theme, intensity, hole });
      break;
    default:
      break;
  }
}
