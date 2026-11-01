import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import type { EntityTier } from "../../config/gacha.js";
import { mulberry32 } from "../effects/noise.js";
import { FONT_SANS, initialsOf } from "../engine/draw/text.js";
import { roundRectPath, type Rect } from "../engine/draw/shapes.js";
import type { ThemeTokens } from "../skins/types.js";
import { TIER_FRAME_COLOR, tierRank } from "../theme/tiers.js";
import { COLORS, darken, lighten, mix, rgba } from "../theme/tokens.js";
import type { EmblemKey } from "./pick.js";
import { SYMBOLS, type PartRole, type SymbolDef } from "./symbols.js";

export interface EmblemOptions {
  theme: ThemeTokens;
  tier: EntityTier;
  /** Semente do PRNG (decoracao de fundo). */
  seed: number;
  /** Nome da entidade; so o emblema `character` o usa (iniciais). */
  name?: string;
}

/** Matiz de raridade: tiers altos usam a cor da moldura; COMMON/RARE usam tokens neutros. */
function tierTint(tier: EntityTier): string {
  if (tier === "COMMON") return COLORS.muted;
  if (tier === "RARE") return COLORS.def;
  return TIER_FRAME_COLOR[tier] ?? COLORS.def;
}

/** Fracao da largura ocupada pela caixa 200x200 do simbolo. */
const SYMBOL_SPAN = 0.86;

function drawBackground(g: SKRSContext2D, rect: Rect, o: EmblemOptions, cx: number, cy: number): void {
  const { theme } = o;
  const bg = g.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  bg.addColorStop(0, darken(theme.primary, 0.78));
  bg.addColorStop(0.55, darken(theme.primary, 0.9));
  bg.addColorStop(1, COLORS.ink2);
  g.fillStyle = bg;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);

  const radius = rect.w * 0.78;
  const halo = g.createRadialGradient(cx, cy, 10, cx, cy, radius);
  halo.addColorStop(0, rgba(theme.glow, 0.42));
  halo.addColorStop(0.45, rgba(theme.primary, 0.16));
  halo.addColorStop(1, rgba(theme.primary, 0));
  g.fillStyle = halo;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);

  // poeira de estrelas semeada
  const rand = mulberry32(o.seed ^ 0x51ed270b);
  for (let i = 0; i < 46; i++) {
    const x = rect.x + rand() * rect.w;
    const y = rect.y + rand() * rect.h;
    const r = 0.8 + rand() * 1.8;
    g.fillStyle = rgba(lighten(theme.glow, 0.5), 0.1 + rand() * 0.35);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  // anel decorativo: quantidade de marcas cresce com o tier
  const ringR = rect.w * 0.4;
  g.strokeStyle = rgba(lighten(theme.glow, 0.4), 0.28);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, ringR, 0, Math.PI * 2);
  g.stroke();
  const ticks = 8 + tierRank(o.tier) * 4;
  g.fillStyle = rgba(lighten(theme.glow, 0.6), 0.55);
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
    g.beginPath();
    g.arc(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, 3, 0, Math.PI * 2);
    g.fill();
  }

  // vinheta
  const vig = g.createRadialGradient(cx, cy, rect.w * 0.45, cx, cy, rect.h * 0.78);
  vig.addColorStop(0, rgba(COLORS.black, 0));
  vig.addColorStop(1, rgba(COLORS.black, 0.55));
  g.fillStyle = vig;
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function roleFill(g: SKRSContext2D, role: PartRole, theme: ThemeTokens): ReturnType<SKRSContext2D["createLinearGradient"]> | string {
  const grad = (top: string, bottom: string) => {
    const gr = g.createLinearGradient(0, 0, 0, 200);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    return gr;
  };
  switch (role) {
    case "body":
      return grad(lighten(theme.primary, 0.82), lighten(theme.primary, 0.5));
    case "accent":
      return grad(lighten(mix(COLORS.gold, theme.glow, 0.25), 0.2), mix(COLORS.gold, theme.glow, 0.45));
    case "dark":
      return grad(mix(COLORS.ink1, theme.primary, 0.3), COLORS.ink0);
    case "light":
      return rgba(COLORS.white, 0.92);
    case "glow":
      return grad(COLORS.white, lighten(theme.glow, 0.55));
    case "line":
      return rgba(darken(theme.primary, 0.7), 0.85);
  }
}

function paintSymbol(g: SKRSContext2D, def: SymbolDef, theme: ThemeTokens, outlinePx: number): void {
  const paths = def.parts.map((p) => ({ part: p, path: new Path2D(p.d) }));
  const outline = lighten(theme.primary, 0.92);

  // passo 1: brilho suave atras de tudo
  g.save();
  g.shadowColor = rgba(theme.glow, 0.95);
  g.shadowBlur = 26 + theme.glowBlur;
  g.fillStyle = rgba(theme.glow, 0.9);
  for (const { part, path } of paths) if (part.role !== "line") g.fill(path, part.rule ?? "nonzero");
  g.restore();

  // passo 2: preenchimento + contorno claro
  g.lineJoin = "round";
  g.lineCap = "round";
  for (const { part, path } of paths) {
    if (part.role === "line") {
      g.strokeStyle = roleFill(g, "line", theme);
      g.lineWidth = outlinePx * 1.1;
      g.stroke(path);
      continue;
    }
    g.save();
    if (part.role === "glow") {
      g.shadowColor = rgba(COLORS.white, 0.95);
      g.shadowBlur = 18;
    }
    g.fillStyle = roleFill(g, part.role, theme);
    g.fill(path, part.rule ?? "nonzero");
    g.restore();
    g.strokeStyle = part.role === "dark" ? rgba(outline, 0.55) : outline;
    g.lineWidth = outlinePx;
    g.stroke(path);
  }
}

function drawItem(g: SKRSContext2D, key: Exclude<EmblemKey, "character">, rect: Rect, o: EmblemOptions, cx: number, cy: number): void {
  const def = SYMBOLS[key];
  const s = ((rect.w * SYMBOL_SPAN) / 200) * (def.scale ?? 1);
  g.save();
  g.translate(cx, cy);
  if (def.rotate) g.rotate((def.rotate * Math.PI) / 180);
  g.scale(s, s);
  g.translate(-100, -100);
  paintSymbol(g, def, o.theme, 3.4 / s);
  g.restore();
}

function drawCharacter(g: SKRSContext2D, rect: Rect, o: EmblemOptions, cx: number, cy: number): void {
  const { theme } = o;
  const s = (rect.w * 0.62) / 200;
  const outline = lighten(theme.primary, 0.92);
  const body = g.createLinearGradient(0, 0, 0, 200);
  body.addColorStop(0, lighten(theme.primary, 0.82));
  body.addColorStop(1, lighten(theme.primary, 0.45));

  g.save();
  g.translate(cx, cy - rect.h * 0.08);
  g.scale(s, s);
  g.translate(-100, -100);
  const head = new Path2D("M100 24 a40 40 0 1 0 0.01 0 Z");
  const shoulders = new Path2D("M28 196 C28 140 62 112 100 112 C138 112 172 140 172 196 Z");
  g.save();
  g.shadowColor = rgba(theme.glow, 0.9);
  g.shadowBlur = 24 + theme.glowBlur;
  g.fillStyle = rgba(theme.glow, 0.9);
  g.fill(head);
  g.fill(shoulders);
  g.restore();
  g.fillStyle = body;
  g.lineWidth = 3.4 / s;
  g.lineJoin = "round";
  g.strokeStyle = outline;
  for (const p of [shoulders, head]) {
    g.fill(p);
    g.stroke(p);
  }
  // gola: faixa escura entre cabeca e ombros
  g.strokeStyle = rgba(darken(theme.primary, 0.7), 0.8);
  g.lineWidth = 2.4 / s;
  g.beginPath();
  g.moveTo(72, 126);
  g.quadraticCurveTo(100, 150, 128, 126);
  g.stroke();
  g.restore();

  // iniciais numa placa abaixo do busto
  const text = initialsOf(o.name ?? "?");
  const py = cy + rect.h * 0.27;
  g.save();
  g.fillStyle = rgba(COLORS.ink0, 0.62);
  g.strokeStyle = rgba(outline, 0.7);
  g.lineWidth = 2;
  const plateW = rect.w * 0.34;
  const plateH = rect.h * 0.1;
  g.beginPath();
  roundRectPath(g, { x: cx - plateW / 2, y: py - plateH / 2, w: plateW, h: plateH }, plateH / 2);
  g.fill();
  g.stroke();
  g.fillStyle = rgba(COLORS.white, 0.95);
  g.font = `bold ${Math.round(plateH * 0.56)}px ${FONT_SANS}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, cx, py + 1);
  g.restore();
}

/**
 * Desenha um emblema original dentro de `rect`. O chamador aplica o clip.
 * Deterministico: mesma entrada => mesmos pixels. Itens nao levam texto; `character` leva so iniciais.
 */
export function drawEmblem(g: SKRSContext2D, key: EmblemKey, rect: Rect, base: EmblemOptions): void {
  const tint = tierTint(base.tier);
  const opts: EmblemOptions = {
    ...base,
    theme: { ...base.theme, primary: mix(base.theme.primary, tint, 0.6), glow: mix(base.theme.glow, tint, 0.6) },
  };
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h * 0.46;
  g.save();
  drawBackground(g, rect, opts, cx, cy);
  if (key === "character") drawCharacter(g, rect, opts, cx, cy);
  else drawItem(g, key, rect, opts, cx, cy);
  g.restore();
}
