import type { SKRSContext2D } from "@napi-rs/canvas";
import { drawVariantEffects } from "../engine/draw/variantEffects.js";
import { clampStat, labelsFor, ownerText, rankText, safeAether } from "../engine/draw/labels.js";
import { scoreMatch } from "../engine/draw/match.js";
import { drawPortrait } from "../engine/draw/portrait.js";
import { drawAetherCrystal, drawStar, roundRectPath, type Rect } from "../engine/draw/shapes.js";
import { fitText, setFont } from "../engine/draw/text.js";
import { COLORS, rgba } from "../theme/tokens.js";
import type { CardLayer, CardSkin } from "./types.js";

/** Port do layout legado 480x700 (renderer antigo), agora com tokens e fontes registradas. */
const W = 480;
const H = 700;
const ART: Rect = { x: 16, y: 56, w: W - 32, h: 490 };
const PANEL_Y = 556;

function pill(g: SKRSContext2D, r: Rect, fill: string, stroke: string, text: string, textColor: string) {
  g.fillStyle = fill;
  roundRectPath(g, r, 6);
  g.fill();
  g.strokeStyle = stroke;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = textColor;
  g.textAlign = "center";
  const t = fitText(g, text, r.w - 16, { size: 13, minSize: 10 });
  g.fillText(t, r.x + r.w / 2, r.y + 21);
  g.textAlign = "left";
}

const background: CardLayer = {
  id: "background",
  draw(g) {
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, COLORS.ink0);
    grad.addColorStop(0.5, COLORS.ink1);
    grad.addColorStop(1, COLORS.ink2);
    g.fillStyle = grad;
    roundRectPath(g, { x: 0, y: 0, w: W, h: H }, 22);
    g.fill();
  },
};

const portrait: CardLayer = {
  id: "portrait",
  draw(g, c) {
    g.save();
    roundRectPath(g, ART, 12);
    g.clip();
    drawPortrait(g, c, ART, { yBias: 0.1 });

    // vinheta inferior suave
    const vy = ART.y + ART.h - 90;
    const vig = g.createLinearGradient(0, vy, 0, ART.y + ART.h);
    vig.addColorStop(0, rgba(COLORS.ink0, 0));
    vig.addColorStop(1, rgba(COLORS.ink0, 0.95));
    g.fillStyle = vig;
    g.fillRect(ART.x, vy, ART.w, 90);

    if (c.variant !== "STANDARD") {
      const sheen = g.createLinearGradient(ART.x, ART.y, ART.x + ART.w, ART.y + ART.h);
      sheen.addColorStop(0, rgba(COLORS.white, 0));
      sheen.addColorStop(0.45, rgba(COLORS.white, 0.08));
      sheen.addColorStop(0.5, rgba(COLORS.white, 0.22));
      sheen.addColorStop(0.55, rgba(COLORS.white, 0.08));
      sheen.addColorStop(1, rgba(COLORS.white, 0));
      g.fillStyle = sheen;
      g.fillRect(ART.x, ART.y, ART.w, ART.h);
    }
    g.restore();
  },
};

const effects: CardLayer = {
  id: "effects",
  draw(g, c) {
    g.save();
    roundRectPath(g, ART, 12);
    g.clip();
    drawVariantEffects(g, c, ART);
    g.restore();
  },
};

const nameplate: CardLayer = {
  id: "nameplate",
  draw(g, c) {
    const panel: Rect = { x: 16, y: PANEL_Y, w: W - 32, h: 128 };
    g.fillStyle = COLORS.panel;
    roundRectPath(g, panel, 10);
    g.fill();
    g.strokeStyle = rgba(COLORS.white, 0.1);
    g.lineWidth = 1;
    g.stroke();

    g.textAlign = "left";
    g.fillStyle = COLORS.white;
    g.fillText(fitText(g, c.name, W - 60, { size: 24, minSize: 17 }), 30, PANEL_Y + 32);

    g.fillStyle = COLORS.muted;
    g.fillText(fitText(g, c.franchise, W - 60, { size: 14, minSize: 11 }), 30, PANEL_Y + 56);

    g.strokeStyle = rgba(COLORS.white, 0.08);
    g.beginPath();
    g.moveTo(30, PANEL_Y + 68);
    g.lineTo(W - 30, PANEL_Y + 68);
    g.stroke();
  },
};

const stats: CardLayer = {
  id: "stats",
  draw(g, c) {
    setFont(g, 700, 13);
    g.textAlign = "left";
    g.fillStyle = COLORS.atk;
    g.fillText(`ATK ${clampStat(c.atk)}`, 30, PANEL_Y + 88);
    g.fillStyle = COLORS.def;
    g.fillText(`DEF ${clampStat(c.def)}`, 105, PANEL_Y + 88);
    g.fillStyle = COLORS.spd;
    g.fillText(`SPD ${clampStat(c.spd)}`, 180, PANEL_Y + 88);
  },
};

const badges: CardLayer = {
  id: "badges",
  draw(g, c) {
    const labels = labelsFor(c.locale);
    const { theme } = c;

    pill(g, { x: 16, y: 14, w: 130, h: 32 }, COLORS.pill, theme.primary, c.universe.toUpperCase(), COLORS.white);
    pill(g, { x: 156, y: 14, w: 160, h: 32 }, theme.badgeBg, theme.primary, theme.label, COLORS.white);
    pill(g, { x: W - 138, y: 14, w: 122, h: 32 }, COLORS.pill, COLORS.gold, `${labels.rank} ${rankText(c)}`, COLORS.gold);

    // selos de despertar sobre a base da arte
    if (c.awakeningKeys > 0) {
      const max = Math.min(c.awakeningKeys, 6);
      for (let i = 0; i < max; i++) {
        drawStar(g, 36 + i * 26, ART.y + ART.h - 20, 10, 4.5, COLORS.gold, 8);
      }
      if (c.awakeningKeys > 6) {
        setFont(g, 700, 15);
        g.fillStyle = COLORS.gold;
        g.textAlign = "left";
        g.fillText(`+${c.awakeningKeys - 6}`, 36 + max * 26, ART.y + ART.h - 14);
      }
    }

    // valor em eter
    drawAetherCrystal(g, 38, PANEL_Y + 110, 8, COLORS.aether);
    setFont(g, 700, 17);
    g.fillStyle = COLORS.aether;
    g.textAlign = "left";
    g.fillText(`${safeAether(c)} ${labels.aether}`, 54, PANEL_Y + 115);

    // status do pacto
    g.textAlign = "right";
    if (c.ownerName) {
      g.fillStyle = COLORS.owner;
      const t = fitText(g, `${labels.pact} ${ownerText(c.ownerName)}`, 230, { size: 13, minSize: 10 });
      g.fillText(t, W - 30, PANEL_Y + 115);
    } else {
      g.fillStyle = COLORS.free;
      const t = fitText(g, labels.free, 230, { size: 14, minSize: 10 });
      g.fillText(t, W - 30, PANEL_Y + 115);
    }
    g.textAlign = "left";
  },
};

const frame: CardLayer = {
  id: "frame",
  draw(g, c) {
    const { theme } = c;
    g.save();
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, theme.primary);
    grad.addColorStop(0.5, theme.secondary);
    grad.addColorStop(1, theme.primary);
    g.strokeStyle = grad;
    g.lineWidth = theme.borderWidth;
    if (theme.glowBlur > 0) {
      g.shadowColor = theme.glow;
      g.shadowBlur = theme.glowBlur;
    }
    roundRectPath(g, { x: 8, y: 8, w: W - 16, h: H - 16 }, 18);
    g.stroke();
    g.restore();
  },
};

export const classicSkin: CardSkin = {
  id: "classic",
  version: 1,
  label: "Classic",
  size: { w: W, h: H },
  match: (ctx) => scoreMatch("classic", ctx, { fallback: true }),
  layers: [background, portrait, effects, nameplate, stats, badges, frame],
};
