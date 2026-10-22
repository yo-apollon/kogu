import type { SKRSContext2D } from "@napi-rs/canvas";
import { clampStat, labelsFor, ownerText, rankText, safeAether } from "../engine/draw/labels.js";
import { scoreMatch } from "../engine/draw/match.js";
import { drawPortrait } from "../engine/draw/portrait.js";
import { drawAetherCrystal, drawStar, polygonPath, roundRectPath, type Rect } from "../engine/draw/shapes.js";
import { fitText, setFont } from "../engine/draw/text.js";
import { drawVariantEffects } from "../engine/draw/variantEffects.js";
import { mulberry32 } from "../effects/noise.js";
import { COLORS, SKIN_COLORS, rgba } from "../theme/tokens.js";
import type { CardLayer, CardSkin } from "./types.js";

/** Neon anime: fundo roxo com halftone e linhas de velocidade, cortes diagonais, contornos neon e texto inclinado. */
const W = 480;
const H = 700;
const P = SKIN_COLORS.animeNeon;
const ART: Rect = { x: 20, y: 60, w: 440, h: 480 };
const SLANT = 14;

function artPath(g: SKRSContext2D, dx = 0, dy = 0): void {
  polygonPath(g, [
    [ART.x + dx, ART.y + dy],
    [ART.x + ART.w - 28 + dx, ART.y + dy],
    [ART.x + ART.w + dx, ART.y + 28 + dy],
    [ART.x + ART.w + dx, ART.y + ART.h + dy],
    [ART.x + 40 + dx, ART.y + ART.h + dy],
    [ART.x + dx, ART.y + ART.h - 40 + dy],
  ]);
}

function slantPath(g: SKRSContext2D, r: Rect, slant = SLANT): void {
  polygonPath(g, [
    [r.x + slant, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w - slant, r.y + r.h],
    [r.x, r.y + r.h],
  ]);
}

function skewText(g: SKRSContext2D, text: string, x: number, y: number, skew = -0.2): void {
  g.save();
  g.translate(x, y);
  g.transform(1, 0, skew, 1, 0, 0);
  g.fillText(text, 0, 0);
  g.restore();
}

function tag(g: SKRSContext2D, r: Rect, fill: string, stroke: string, text: string, color: string): void {
  slantPath(g, r);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = stroke;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = "center";
  const t = fitText(g, text, r.w - 30, { size: 13, minSize: 10 });
  skewText(g, t, r.x + r.w / 2 + 2, r.y + 21);
  g.textAlign = "left";
}

const background: CardLayer = {
  id: "background",
  draw(g, c, a) {
    const grad = g.createLinearGradient(0, 0, W * 0.6, H);
    grad.addColorStop(0, P.bg1);
    grad.addColorStop(0.55, P.bg0);
    grad.addColorStop(1, P.bg2);
    g.fillStyle = grad;
    roundRectPath(g, { x: 0, y: 0, w: W, h: H }, 22);
    g.fill();

    g.save();
    roundRectPath(g, { x: 0, y: 0, w: W, h: H }, 22);
    g.clip();
    // halftone na metade inferior
    const dots = a.get("halftone");
    if (dots) {
      const pat = g.createPattern(dots, "repeat");
      if (pat) {
        g.globalAlpha = 0.16;
        g.fillStyle = pat;
        g.fillRect(0, H * 0.55, W, H * 0.45);
        g.globalAlpha = 1;
      }
    }
    // linhas de velocidade radiais (semeadas)
    const rand = mulberry32(c.seed ^ 0xa11e);
    g.strokeStyle = rgba(c.theme.primary, 0.12);
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < 34; i++) {
      const ang = rand() * Math.PI * 2;
      const r0 = 150 + rand() * 80;
      const r1 = 520;
      g.moveTo(W / 2 + Math.cos(ang) * r0, 300 + Math.sin(ang) * r0);
      g.lineTo(W / 2 + Math.cos(ang) * r1, 300 + Math.sin(ang) * r1);
    }
    g.stroke();
    g.restore();
  },
};

const portrait: CardLayer = {
  id: "portrait",
  draw(g, c) {
    g.save();
    artPath(g);
    g.clip();
    drawPortrait(g, c, ART, {
      yBias: 0.12,
      fallbackCenter: c.theme.primary,
      fallbackMid: P.bg1,
      fallbackEdge: P.bg2,
    });
    const fade = g.createLinearGradient(0, ART.y + ART.h - 130, 0, ART.y + ART.h);
    fade.addColorStop(0, rgba(P.bg2, 0));
    fade.addColorStop(1, rgba(P.bg2, 0.92));
    g.fillStyle = fade;
    g.fillRect(ART.x, ART.y + ART.h - 130, ART.w, 130);
    const top = g.createLinearGradient(0, ART.y, 0, ART.y + 90);
    top.addColorStop(0, rgba(P.bg2, 0.75));
    top.addColorStop(1, rgba(P.bg2, 0));
    g.fillStyle = top;
    g.fillRect(ART.x, ART.y, ART.w, 90);
    g.restore();
  },
};

const effects: CardLayer = {
  id: "effects",
  draw(g, c) {
    g.save();
    artPath(g);
    g.clip();
    drawVariantEffects(g, c, ART);
    g.restore();
  },
};

const nameplate: CardLayer = {
  id: "nameplate",
  draw(g, c) {
    const r: Rect = { x: 14, y: 546, w: 452, h: 60 };
    g.save();
    g.shadowColor = c.theme.glow;
    g.shadowBlur = 12;
    slantPath(g, r, 22);
    g.fillStyle = P.chip;
    g.fill();
    g.restore();
    slantPath(g, r, 22);
    g.strokeStyle = c.theme.primary;
    g.lineWidth = 2.5;
    g.stroke();
    // faixa de cor lateral
    polygonPath(g, [
      [r.x + 22, r.y],
      [r.x + 40, r.y],
      [r.x + 18, r.y + r.h],
      [r.x, r.y + r.h],
    ]);
    g.fillStyle = P.pink;
    g.fill();

    g.textAlign = "left";
    g.fillStyle = COLORS.white;
    g.save();
    g.shadowColor = c.theme.glow;
    g.shadowBlur = 8;
    const name = fitText(g, c.name, 372, { size: 26, minSize: 16 });
    skewText(g, name, r.x + 52, r.y + 29);
    g.restore();
    g.fillStyle = P.cyan;
    const fr = fitText(g, c.franchise, 372, { size: 13, minSize: 10, weight: 600 });
    skewText(g, fr, r.x + 48, r.y + 49);
  },
};

const stats: CardLayer = {
  id: "stats",
  draw(g, c) {
    const items: Array<[string, number, string]> = [
      ["ATK", c.atk, COLORS.atk],
      ["DEF", c.def, COLORS.def],
      ["SPD", c.spd, COLORS.spd],
    ];
    const y = 616;
    items.forEach(([label, value, color], i) => {
      const r: Rect = { x: 20 + i * 148, y, w: 140, h: 32 };
      slantPath(g, r, 12);
      g.fillStyle = P.chip;
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
      setFont(g, 700, 13);
      g.textAlign = "left";
      g.fillStyle = color;
      skewText(g, label, r.x + 22, r.y + 21);
      setFont(g, 700, 19);
      g.textAlign = "right";
      g.fillStyle = COLORS.white;
      skewText(g, String(clampStat(value)), r.x + r.w - 16, r.y + 23);
      g.textAlign = "left";
    });
  },
};

const badges: CardLayer = {
  id: "badges",
  draw(g, c) {
    const labels = labelsFor(c.locale);
    const { theme } = c;
    tag(g, { x: 26, y: 16, w: 128, h: 32 }, P.chip, theme.primary, c.universe, COLORS.white);
    tag(g, { x: 162, y: 16, w: 162, h: 32 }, theme.badgeBg, theme.primary, theme.label, COLORS.white);
    tag(g, { x: 332, y: 16, w: 128, h: 32 }, P.chip, P.pink, `${labels.rank} ${rankText(c)}`, COLORS.gold);

    // selos de despertar
    if (c.awakeningKeys > 0) {
      const max = Math.min(c.awakeningKeys, 6);
      for (let i = 0; i < max; i++) drawStar(g, 44 + i * 25, ART.y + ART.h - 62, 10, 4.5, P.lime, 10);
      if (c.awakeningKeys > 6) {
        setFont(g, 700, 15);
        g.fillStyle = P.lime;
        g.textAlign = "left";
        g.fillText(`+${c.awakeningKeys - 6}`, 44 + max * 25, ART.y + ART.h - 57);
      }
    }

    drawAetherCrystal(g, 36, 674, 8, COLORS.aether);
    setFont(g, 700, 17);
    g.fillStyle = COLORS.aether;
    g.textAlign = "left";
    g.fillText(`${safeAether(c)} ${labels.aether}`, 52, 680);

    g.textAlign = "right";
    if (c.ownerName) {
      g.fillStyle = COLORS.owner;
      g.fillText(fitText(g, `${labels.pact} ${ownerText(c.ownerName)}`, 230, { size: 13, minSize: 10 }), W - 28, 679);
    } else {
      g.fillStyle = COLORS.free;
      g.fillText(fitText(g, labels.free, 230, { size: 14, minSize: 10 }), W - 28, 679);
    }
    g.textAlign = "left";
  },
};

const frame: CardLayer = {
  id: "frame",
  draw(g, c) {
    const { theme } = c;
    g.save();
    // contorno deslocado (aberracao cromatica)
    artPath(g, 4, 4);
    g.strokeStyle = rgba(P.cyan, 0.55);
    g.lineWidth = 2;
    g.stroke();
    artPath(g);
    g.strokeStyle = theme.primary;
    g.lineWidth = 3;
    if (theme.glowBlur > 0) {
      g.shadowColor = theme.glow;
      g.shadowBlur = theme.glowBlur;
    }
    g.stroke();
    g.restore();

    g.save();
    g.strokeStyle = theme.primary;
    g.lineWidth = theme.borderWidth;
    if (theme.glowBlur > 0) {
      g.shadowColor = theme.glow;
      g.shadowBlur = theme.glowBlur;
    }
    roundRectPath(g, { x: 6, y: 6, w: W - 12, h: H - 12 }, 20);
    g.stroke();
    g.restore();
    g.strokeStyle = rgba(P.pink, 0.55);
    g.lineWidth = 1.5;
    roundRectPath(g, { x: 12, y: 12, w: W - 24, h: H - 24 }, 15);
    g.stroke();
  },
};

export const animeNeonSkin: CardSkin = {
  id: "anime-neon",
  version: 1,
  label: "Anime Neon",
  size: { w: W, h: H },
  match: (ctx) => scoreMatch("anime-neon", ctx, { universes: ["ANIME"] }),
  layers: [background, portrait, effects, nameplate, stats, badges, frame],
};
