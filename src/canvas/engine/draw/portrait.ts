import type { SKRSContext2D } from "@napi-rs/canvas";
import type { CardRenderContext } from "../../skins/types.js";
import { drawEmblem } from "../../emblems/draw.js";
import { COLORS, rgba } from "../../theme/tokens.js";
import type { Rect } from "./shapes.js";
import { FONT_SANS, initialsOf } from "./text.js";

export interface PortraitOptions {
  /** Deslocamento vertical do recorte para imagens altas (0 = topo, 0.5 = centro). Legado: 0.10. */
  yBias?: number;
  /** Cor do centro do fallback (padrao: theme.primary). */
  fallbackCenter?: string;
  fallbackMid?: string;
  fallbackEdge?: string;
}

/** Desenha o retrato em modo "cover" dentro de `rect`. O chamador aplica o clip. */
export function drawPortrait(g: SKRSContext2D, c: CardRenderContext, rect: Rect, opts: PortraitOptions = {}): void {
  if (c.emblem) {
    drawEmblem(g, c.emblem, rect, { theme: c.theme, tier: c.tier, seed: c.seed, name: c.name });
    return;
  }
  const img = c.portrait;
  if (!img || img.width === 0 || img.height === 0) {
    drawPortraitFallback(g, c, rect, opts);
    return;
  }
  const imgRatio = img.width / img.height;
  const boxRatio = rect.w / rect.h;
  let drawW = rect.w;
  let drawH = rect.h;
  let ox = rect.x;
  let oy = rect.y;
  if (imgRatio > boxRatio) {
    drawW = rect.h * imgRatio;
    ox = rect.x - (drawW - rect.w) / 2;
  } else {
    drawH = rect.w / imgRatio;
    oy = rect.y - (drawH - rect.h) * (opts.yBias ?? 0.1);
  }
  g.drawImage(img, ox, oy, drawW, drawH);
}

export function drawPortraitFallback(
  g: SKRSContext2D,
  c: CardRenderContext,
  rect: Rect,
  opts: PortraitOptions = {}
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const grad = g.createRadialGradient(cx, cy, 20, cx, cy, Math.max(rect.w, rect.h) * 0.55);
  grad.addColorStop(0, opts.fallbackCenter ?? c.theme.primary);
  grad.addColorStop(0.5, opts.fallbackMid ?? COLORS.fallbackMid);
  grad.addColorStop(1, opts.fallbackEdge ?? COLORS.ink2);
  g.fillStyle = grad;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);

  g.strokeStyle = rgba(COLORS.white, 0.15);
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, Math.min(rect.w, rect.h) * 0.245, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = rgba(COLORS.white, 0.85);
  g.font = `bold 76px ${FONT_SANS}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initialsOf(c.name), cx, cy);
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
}
