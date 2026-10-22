import type { SKRSContext2D } from "@napi-rs/canvas";
import { clampStat, labelsFor, ownerText, rankText, safeAether } from "../engine/draw/labels.js";
import { scoreMatch } from "../engine/draw/match.js";
import { drawPortrait } from "../engine/draw/portrait.js";
import { chamferPath, drawAetherCrystal, drawStar, type Rect } from "../engine/draw/shapes.js";
import { fitText, setFont } from "../engine/draw/text.js";
import { drawVariantEffects } from "../engine/draw/variantEffects.js";
import { COLORS, SKIN_COLORS, rgba } from "../theme/tokens.js";
import type { CardLayer, CardSkin } from "./types.js";

/** HUD de jogo: paineis chanfrados, grade, scanlines, barras segmentadas de stats e recurso de Eter. */
const W = 480;
const H = 700;
const P = SKIN_COLORS.gameHud;
const OUTER: Rect = { x: 0, y: 0, w: W, h: H };
const ART: Rect = { x: 22, y: 60, w: 436, h: 424 };
const NAME: Rect = { x: 22, y: 492, w: 436, h: 66 };
const STATS: Rect = { x: 22, y: 566, w: 436, h: 94 };
const SEGMENTS = 20;

function tag(g: SKRSContext2D, r: Rect, fill: string, stroke: string, text: string, color: string): void {
  chamferPath(g, r, [8, 0, 8, 0]);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = stroke;
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = color;
  g.textAlign = "center";
  g.fillText(fitText(g, text, r.w - 16, { size: 13, minSize: 10 }), r.x + r.w / 2, r.y + 21);
  g.textAlign = "left";
}

function segmentBar(g: SKRSContext2D, r: Rect, value: number, color: string): void {
  const gap = 3;
  const sw = (r.w - gap * (SEGMENTS - 1)) / SEGMENTS;
  const filled = Math.max(0, Math.min(SEGMENTS, Math.ceil((Math.min(value, 100) / 100) * SEGMENTS)));
  for (let i = 0; i < SEGMENTS; i++) {
    g.fillStyle = i < filled ? color : rgba(COLORS.white, 0.1);
    g.fillRect(r.x + i * (sw + gap), r.y, sw, r.h);
  }
}

const background: CardLayer = {
  id: "background",
  draw(g) {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, P.bg1);
    grad.addColorStop(1, P.bg0);
    g.fillStyle = grad;
    chamferPath(g, OUTER, [28, 10, 28, 10]);
    g.fill();

    g.save();
    chamferPath(g, OUTER, [28, 10, 28, 10]);
    g.clip();
    g.strokeStyle = rgba(P.line, 0.35);
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 24) {
      g.moveTo(x + 0.5, 0);
      g.lineTo(x + 0.5, H);
    }
    for (let y = 0; y <= H; y += 24) {
      g.moveTo(0, y + 0.5);
      g.lineTo(W, y + 0.5);
    }
    g.stroke();
    g.restore();
  },
};

const portrait: CardLayer = {
  id: "portrait",
  draw(g, c, a) {
    g.save();
    chamferPath(g, ART, [18, 0, 18, 0]);
    g.clip();
    drawPortrait(g, c, ART, { yBias: 0.1, fallbackCenter: c.theme.primary, fallbackMid: P.steel, fallbackEdge: P.bg0 });

    const scan = a.get("scanlines");
    if (scan) {
      const pat = g.createPattern(scan, "repeat");
      if (pat) {
        g.globalAlpha = 0.22;
        g.fillStyle = pat;
        g.fillRect(ART.x, ART.y, ART.w, ART.h);
        g.globalAlpha = 1;
      }
    }
    const fade = g.createLinearGradient(0, ART.y + ART.h - 100, 0, ART.y + ART.h);
    fade.addColorStop(0, rgba(P.bg0, 0));
    fade.addColorStop(1, rgba(P.bg0, 0.9));
    g.fillStyle = fade;
    g.fillRect(ART.x, ART.y + ART.h - 100, ART.w, 100);
    g.restore();
  },
};

const effects: CardLayer = {
  id: "effects",
  draw(g, c) {
    g.save();
    chamferPath(g, ART, [18, 0, 18, 0]);
    g.clip();
    drawVariantEffects(g, c, ART);
    g.restore();
  },
};

const nameplate: CardLayer = {
  id: "nameplate",
  draw(g, c) {
    chamferPath(g, NAME, [0, 14, 0, 14]);
    g.fillStyle = P.steel;
    g.fill();
    g.strokeStyle = c.theme.primary;
    g.lineWidth = 1.5;
    g.stroke();
    // barra de acento lateral
    g.fillStyle = c.theme.primary;
    g.fillRect(NAME.x, NAME.y, 5, NAME.h);

    g.textAlign = "left";
    g.fillStyle = COLORS.white;
    g.fillText(fitText(g, c.name.toUpperCase(), 290, { size: 24, minSize: 15 }), NAME.x + 18, NAME.y + 31);
    g.fillStyle = COLORS.muted;
    g.fillText(fitText(g, c.franchise, 290, { size: 13, minSize: 10, weight: 600 }), NAME.x + 18, NAME.y + 53);

    // rank
    const labels = labelsFor(c.locale);
    const rb: Rect = { x: NAME.x + NAME.w - 112, y: NAME.y + 12, w: 98, h: 42 };
    chamferPath(g, rb, [8, 0, 8, 0]);
    g.fillStyle = P.bg0;
    g.fill();
    g.strokeStyle = COLORS.gold;
    g.lineWidth = 1.5;
    g.stroke();
    g.textAlign = "center";
    setFont(g, 600, 10);
    g.fillStyle = COLORS.muted;
    g.fillText(labels.rank, rb.x + rb.w / 2, rb.y + 15);
    g.fillStyle = COLORS.gold;
    g.fillText(fitText(g, rankText(c), rb.w - 12, { size: 20, minSize: 12 }), rb.x + rb.w / 2, rb.y + 35);
    g.textAlign = "left";
  },
};

const stats: CardLayer = {
  id: "stats",
  draw(g, c) {
    chamferPath(g, STATS, [0, 0, 14, 0]);
    g.fillStyle = rgba(P.bg0, 0.92);
    g.fill();
    g.strokeStyle = P.line;
    g.lineWidth = 1.5;
    g.stroke();

    const rows: Array<[string, number, string]> = [
      ["ATK", c.atk, COLORS.atk],
      ["DEF", c.def, COLORS.def],
      ["SPD", c.spd, COLORS.spd],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = STATS.y + 14 + i * 26;
      setFont(g, 700, 13);
      g.textAlign = "left";
      g.fillStyle = color;
      g.fillText(label, STATS.x + 14, y + 10);
      segmentBar(g, { x: STATS.x + 58, y, w: 196, h: 12 }, value, color);
      g.fillStyle = COLORS.white;
      g.textAlign = "right";
      g.fillText(String(clampStat(value)), STATS.x + 298, y + 11);
      g.textAlign = "left";
    });

    // painel do recurso Eter
    g.strokeStyle = P.line;
    g.beginPath();
    g.moveTo(STATS.x + 316, STATS.y + 12);
    g.lineTo(STATS.x + 316, STATS.y + STATS.h - 12);
    g.stroke();
  },
};

const badges: CardLayer = {
  id: "badges",
  draw(g, c) {
    const labels = labelsFor(c.locale);
    const { theme } = c;
    tag(g, { x: 22, y: 16, w: 124, h: 32 }, P.steel, theme.primary, c.universe, COLORS.white);
    tag(g, { x: 154, y: 16, w: 170, h: 32 }, theme.badgeBg, theme.primary, theme.label, COLORS.white);

    // dono / livre no topo direito
    const ownerLabel = c.ownerName ? `${labels.pact} ${ownerText(c.ownerName)}` : labels.free;
    tag(g, { x: 332, y: 16, w: 126, h: 32 }, P.steel, c.ownerName ? COLORS.owner : COLORS.free, ownerLabel, c.ownerName ? COLORS.owner : COLORS.free);

    // selos de despertar (estrelas) sobre a arte
    if (c.awakeningKeys > 0) {
      const max = Math.min(c.awakeningKeys, 6);
      for (let i = 0; i < max; i++) drawStar(g, ART.x + 24 + i * 25, ART.y + ART.h - 20, 10, 4.5, COLORS.gold, 8);
      if (c.awakeningKeys > 6) {
        setFont(g, 700, 15);
        g.fillStyle = COLORS.gold;
        g.fillText(`+${c.awakeningKeys - 6}`, ART.x + 24 + max * 25, ART.y + ART.h - 14);
      }
    }

    // recurso: Eter
    const cx = STATS.x + 316;
    g.textAlign = "center";
    drawAetherCrystal(g, cx + 60, STATS.y + 28, 11, COLORS.aether);
    setFont(g, 700, 26);
    g.fillStyle = COLORS.aether;
    g.fillText(fitText(g, String(safeAether(c)), 110, { size: 26, minSize: 14 }), cx + 60, STATS.y + 66);
    setFont(g, 600, 11);
    g.fillStyle = COLORS.muted;
    g.fillText(labels.aether.toUpperCase(), cx + 60, STATS.y + 82);
    g.textAlign = "left";
  },
};

const frame: CardLayer = {
  id: "frame",
  draw(g, c) {
    const { theme } = c;
    g.save();
    g.strokeStyle = theme.primary;
    g.lineWidth = Math.max(3, theme.borderWidth - 1);
    if (theme.glowBlur > 0) {
      g.shadowColor = theme.glow;
      g.shadowBlur = theme.glowBlur;
    }
    chamferPath(g, { x: 5, y: 5, w: W - 10, h: H - 10 }, [24, 8, 24, 8]);
    g.stroke();
    g.restore();

    // colchetes de canto na arte
    g.strokeStyle = P.accent;
    g.lineWidth = 2.5;
    const L = 26;
    const { x, y, w, h } = ART;
    g.beginPath();
    g.moveTo(x + 20, y + 20 + L);
    g.lineTo(x + 20, y + 20);
    g.lineTo(x + 20 + L, y + 20);
    g.moveTo(x + w - 20 - L, y + h - 20);
    g.lineTo(x + w - 20, y + h - 20);
    g.lineTo(x + w - 20, y + h - 20 - L);
    g.stroke();
    chamferPath(g, ART, [18, 0, 18, 0]);
    g.strokeStyle = rgba(P.accent, 0.6);
    g.lineWidth = 1.5;
    g.stroke();
  },
};

export const gameHudSkin: CardSkin = {
  id: "game-hud",
  version: 1,
  label: "Game HUD",
  size: { w: W, h: H },
  match: (ctx) => scoreMatch("game-hud", ctx, { universes: ["GAME"] }),
  layers: [background, portrait, effects, nameplate, stats, badges, frame],
};
