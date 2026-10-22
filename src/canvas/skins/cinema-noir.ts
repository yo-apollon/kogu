import type { SKRSContext2D } from "@napi-rs/canvas";
import { clampStat, labelsFor, ownerText, rankText, safeAether } from "../engine/draw/labels.js";
import { scoreMatch } from "../engine/draw/match.js";
import { drawPortrait } from "../engine/draw/portrait.js";
import { drawAetherCrystal, drawStar, roundRectPath, type Rect } from "../engine/draw/shapes.js";
import { FONT_SERIF, fitText, setFont, withTracking } from "../engine/draw/text.js";
import { drawVariantEffects } from "../engine/draw/variantEffects.js";
import { drawGrain } from "../effects/noise.js";
import { COLORS, SKIN_COLORS, rgba } from "../theme/tokens.js";
import type { CardLayer, CardSkin } from "./types.js";

/** Cinema noir: tira de filme com perfuracoes, retrato dessaturado com viragem sepia, tipografia Cinzel. */
const W = 480;
const H = 700;
const P = SKIN_COLORS.cinemaNoir;
const ART: Rect = { x: 50, y: 58, w: 380, h: 462 };
const CX = W / 2;

function sprockets(g: SKRSContext2D): void {
  g.fillStyle = rgba(P.hole, 0.88);
  for (let y = 14; y < H - 20; y += 34) {
    roundRectPath(g, { x: 14, y, w: 18, h: 22 }, 4);
    g.fill();
    roundRectPath(g, { x: W - 32, y, w: 18, h: 22 }, 4);
    g.fill();
  }
}

const background: CardLayer = {
  id: "background",
  draw(g, c) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, P.bg1);
    grad.addColorStop(1, P.film);
    g.fillStyle = grad;
    roundRectPath(g, { x: 0, y: 0, w: W, h: H }, 16);
    g.fill();
    sprockets(g);
    drawGrain(g, { x: 0, y: 0, w: W, h: H }, c.seed ^ 0x0f11, { density: 0.0015, alpha: 0.06 });
  },
};

const portrait: CardLayer = {
  id: "portrait",
  draw(g, c) {
    g.save();
    g.beginPath();
    g.rect(ART.x, ART.y, ART.w, ART.h);
    g.clip();
    drawPortrait(g, c, ART, { yBias: 0.08, fallbackCenter: P.ash, fallbackMid: P.bg1, fallbackEdge: P.bg0 });

    // dessaturacao + viragem sepia
    g.globalCompositeOperation = "saturation";
    g.fillStyle = rgba(COLORS.black, 0.82);
    g.fillRect(ART.x, ART.y, ART.w, ART.h);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = rgba(P.sepia, 0.5);
    g.fillRect(ART.x, ART.y, ART.w, ART.h);
    g.globalCompositeOperation = "source-over";

    // vinheta
    const vig = g.createRadialGradient(CX, ART.y + ART.h * 0.42, ART.h * 0.25, CX, ART.y + ART.h * 0.5, ART.h * 0.75);
    vig.addColorStop(0, rgba(COLORS.black, 0));
    vig.addColorStop(1, rgba(COLORS.black, 0.7));
    g.fillStyle = vig;
    g.fillRect(ART.x, ART.y, ART.w, ART.h);
    const fade = g.createLinearGradient(0, ART.y + ART.h - 80, 0, ART.y + ART.h);
    fade.addColorStop(0, rgba(COLORS.black, 0));
    fade.addColorStop(1, rgba(COLORS.black, 0.8));
    g.fillStyle = fade;
    g.fillRect(ART.x, ART.y + ART.h - 80, ART.w, 80);

    drawGrain(g, ART, c.seed, { density: 0.006, alpha: 0.1 });
    g.restore();
  },
};

const effects: CardLayer = {
  id: "effects",
  draw(g, c) {
    g.save();
    g.beginPath();
    g.rect(ART.x, ART.y, ART.w, ART.h);
    g.clip();
    drawVariantEffects(g, c, ART, undefined, 0.75);
    g.restore();
  },
};

const nameplate: CardLayer = {
  id: "nameplate",
  draw(g, c) {
    g.textAlign = "center";
    g.fillStyle = P.ivory;
    const name = fitText(g, c.name, 372, { size: 28, minSize: 16, weight: 700, stack: FONT_SERIF, tracking: 1.5 });
    withTracking(g, 1.5, () => g.fillText(name, CX, 562));

    // regua com losango central
    const y = 574;
    g.strokeStyle = rgba(P.sepia, 0.8);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ART.x + 20, y);
    g.lineTo(CX - 12, y);
    g.moveTo(CX + 12, y);
    g.lineTo(ART.x + ART.w - 20, y);
    g.stroke();
    g.fillStyle = P.sepia;
    g.beginPath();
    g.moveTo(CX, y - 5);
    g.lineTo(CX + 6, y);
    g.lineTo(CX, y + 5);
    g.lineTo(CX - 6, y);
    g.closePath();
    g.fill();

    g.fillStyle = P.ash;
    const fr = fitText(g, c.franchise.toUpperCase(), 360, { size: 12, minSize: 9, weight: 400, stack: FONT_SERIF, tracking: 2 });
    withTracking(g, 2, () => g.fillText(fr, CX, 594));
    g.textAlign = "left";
  },
};

const stats: CardLayer = {
  id: "stats",
  draw(g, c) {
    const cols: Array<[string, number]> = [
      ["ATK", c.atk],
      ["DEF", c.def],
      ["SPD", c.spd],
    ];
    const colW = ART.w / 3;
    g.textAlign = "center";
    cols.forEach(([label, value], i) => {
      const cx = ART.x + colW * i + colW / 2;
      setFont(g, 700, 26, FONT_SERIF);
      g.fillStyle = P.ivory;
      g.fillText(String(clampStat(value)), cx, 634);
      setFont(g, 600, 11, FONT_SERIF);
      g.fillStyle = P.sepia;
      withTracking(g, 2, () => g.fillText(label, cx, 652));
      if (i > 0) {
        g.strokeStyle = rgba(P.sepia, 0.45);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(ART.x + colW * i, 612);
        g.lineTo(ART.x + colW * i, 656);
        g.stroke();
      }
    });
    g.textAlign = "left";
  },
};

const badges: CardLayer = {
  id: "badges",
  draw(g, c) {
    const labels = labelsFor(c.locale);
    const { theme } = c;

    // cabecalho: universo | rank | variante
    setFont(g, 600, 12, FONT_SERIF);
    g.textBaseline = "alphabetic";
    withTracking(g, 1.5, () => {
      g.textAlign = "left";
      g.fillStyle = P.ivory;
      g.fillText(fitText(g, c.universe, 110, { size: 12, minSize: 9, weight: 600, stack: FONT_SERIF, tracking: 1.5 }), ART.x, 40);
      g.textAlign = "center";
      g.fillStyle = COLORS.gold;
      g.fillText(`${labels.rank} ${rankText(c)}`, CX, 40);
      g.textAlign = "right";
      g.fillStyle = theme.primary;
      g.fillText(fitText(g, theme.label, 120, { size: 12, minSize: 9, weight: 600, stack: FONT_SERIF, tracking: 1.5 }), ART.x + ART.w, 40);
    });
    g.textAlign = "left";

    // selos de despertar
    if (c.awakeningKeys > 0) {
      const max = Math.min(c.awakeningKeys, 6);
      for (let i = 0; i < max; i++) drawStar(g, ART.x + 18 + i * 22, ART.y + ART.h - 20, 8.5, 3.8, COLORS.gold, 6);
      if (c.awakeningKeys > 6) {
        setFont(g, 700, 13);
        g.fillStyle = COLORS.gold;
        g.fillText(`+${c.awakeningKeys - 6}`, ART.x + 18 + max * 22, ART.y + ART.h - 15);
      }
    }

    // rodape: eter | dono
    drawAetherCrystal(g, ART.x + 8, 680, 7, COLORS.aether);
    setFont(g, 600, 14, FONT_SERIF);
    g.fillStyle = COLORS.aether;
    g.fillText(`${safeAether(c)} ${labels.aether}`, ART.x + 22, 685);
    g.textAlign = "right";
    if (c.ownerName) {
      g.fillStyle = COLORS.owner;
      g.fillText(fitText(g, `${labels.pact} ${ownerText(c.ownerName)}`, 200, { size: 13, minSize: 9, weight: 600 }), ART.x + ART.w, 685);
    } else {
      g.fillStyle = COLORS.free;
      g.fillText(fitText(g, labels.free, 200, { size: 12, minSize: 9, weight: 600 }), ART.x + ART.w, 685);
    }
    g.textAlign = "left";
  },
};

const frame: CardLayer = {
  id: "frame",
  draw(g, c) {
    const { theme } = c;
    // moldura dupla da cena
    g.strokeStyle = P.sepia;
    g.lineWidth = 2;
    g.strokeRect(ART.x - 4, ART.y - 4, ART.w + 8, ART.h + 8);
    g.strokeStyle = rgba(P.sepia, 0.5);
    g.lineWidth = 1;
    g.strokeRect(ART.x - 9, ART.y - 9, ART.w + 18, ART.h + 18);

    // contorno externo com a cor da raridade
    g.save();
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, theme.primary);
    grad.addColorStop(0.5, theme.secondary);
    grad.addColorStop(1, theme.primary);
    g.strokeStyle = grad;
    g.lineWidth = Math.max(3, theme.borderWidth - 1);
    if (theme.glowBlur > 0) {
      g.shadowColor = theme.glow;
      g.shadowBlur = theme.glowBlur;
    }
    roundRectPath(g, { x: 4, y: 4, w: W - 8, h: H - 8 }, 14);
    g.stroke();
    g.restore();
  },
};

export const cinemaNoirSkin: CardSkin = {
  id: "cinema-noir",
  version: 1,
  label: "Cinema Noir",
  size: { w: W, h: H },
  match: (ctx) => scoreMatch("cinema-noir", ctx, { universes: ["CINEMA"] }),
  layers: [background, portrait, effects, nameplate, stats, badges, frame],
};
