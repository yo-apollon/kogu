/**
 * Gera cartas de teste sem rede (retrato sintetico) e mede o tempo de render.
 *
 *   npx tsx src/scripts/testCanvas.ts --all                       # 4 skins x 4 variantes em .cache/test-cards/
 *   npx tsx src/scripts/testCanvas.ts --skin cinema-noir --variant ASTRAL --tier MYTHIC
 *   npx tsx src/scripts/testCanvas.ts --all --out some/dir --pool # renderiza pelo pool de workers
 *   npx tsx src/scripts/testCanvas.ts --all --golden              # (re)gera tests/__golden__/*.png
 *
 * Saidas: <out>/<skin>__<variant>.webp (o que o bot envia) e <out>/png/<...>.png (para inspecao visual).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { drawAetherCrystal } from "../canvas/engine/draw/shapes.js";
import { setFont } from "../canvas/engine/draw/text.js";
import { buildSummonEmbed, type SummonView } from "../ui/summonEmbed.js";
import { CARD_VARIANTS, ENTITY_TIERS, type CardVariant, type EntityTier } from "../config/gacha.js";
import { CardCache, getCardCache } from "../canvas/engine/cache.js";
import { registerFonts } from "../canvas/engine/fonts.js";
import { ImageLoader, imageCacheKey, type ImageFetcher } from "../canvas/engine/imageLoader.js";
import { canvasPoolStats, renderCardInPool, shutdownCanvasPool } from "../canvas/engine/pool.js";
import { drawCard, renderCard, type RenderCardInput } from "../canvas/engine/renderer.js";
import { listSkins } from "../canvas/skins/registry.js";

/* ------------------------------------------------------------------ */
/* Retrato sintetico (sem rede, deterministico)                        */
/* ------------------------------------------------------------------ */

/** PNG 600x860 com gradiente, silhueta e rosto estilizado na regiao superior (onde a arte real tem o rosto). */
export async function makeSyntheticPortrait(index: number): Promise<Buffer> {
  const W = 600;
  const H = 860;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  const hue = (index * 47 + 200) % 360;

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${hue},62%,32%)`);
  bg.addColorStop(1, `hsl(${(hue + 50) % 360},70%,10%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // faixas de fundo
  g.fillStyle = `hsla(${(hue + 120) % 360},80%,60%,0.10)`;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(i * 110 - 60, 0);
    g.lineTo(i * 110 + 20, 0);
    g.lineTo(i * 110 - 160, H);
    g.lineTo(i * 110 - 240, H);
    g.closePath();
    g.fill();
  }

  // ombros / corpo
  g.fillStyle = `hsl(${(hue + 200) % 360},35%,18%)`;
  g.beginPath();
  g.moveTo(40, H);
  g.quadraticCurveTo(70, 560, 300, 540);
  g.quadraticCurveTo(530, 560, 560, H);
  g.closePath();
  g.fill();
  // pescoco
  g.fillStyle = "#d9b08c";
  g.fillRect(262, 440, 76, 120);
  // cabeca
  g.fillStyle = "#ebc7a6";
  g.beginPath();
  g.ellipse(300, 330, 108, 138, 0, 0, Math.PI * 2);
  g.fill();
  // cabelo
  g.fillStyle = `hsl(${(hue + 160) % 360},30%,92%)`;
  g.beginPath();
  g.moveTo(180, 330);
  g.quadraticCurveTo(170, 150, 300, 160);
  g.quadraticCurveTo(430, 150, 420, 330);
  g.quadraticCurveTo(400, 250, 300, 250);
  g.quadraticCurveTo(200, 250, 180, 330);
  g.closePath();
  g.fill();
  // olhos
  for (const ex of [255, 345]) {
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.ellipse(ex, 335, 22, 14, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `hsl(${(hue + 190) % 360},90%,55%)`;
    g.beginPath();
    g.arc(ex, 335, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#101018";
    g.beginPath();
    g.arc(ex, 335, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  // boca
  g.strokeStyle = "#a8584f";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(300, 395, 22, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();

  return canvas.encode("png");
}

/** Fetcher local: `synthetic://<n>` => retrato sintetico. Nunca usa a rede. */
export function syntheticFetcher(): ImageFetcher {
  return {
    async fetch(url: string): Promise<Buffer | null> {
      const m = /^synthetic:\/\/(\d+)$/.exec(url);
      return m ? makeSyntheticPortrait(Number(m[1])) : null;
    },
  };
}

export function createSyntheticLoader(): ImageLoader {
  return new ImageLoader({ fetcher: syntheticFetcher(), cacheDir: false });
}

/* ------------------------------------------------------------------ */
/* Casos de teste                                                      */
/* ------------------------------------------------------------------ */

const SAMPLES: Array<Pick<RenderCardInput, "name" | "franchise" | "universe" | "ownerName" | "awakeningKeys" | "popularityRank">> = [
  { name: "Zero Two", franchise: "DARLING in the FRANXX", universe: "ANIME", ownerName: "Apollon", awakeningKeys: 3, popularityRank: 1 },
  { name: "五条悟", franchise: "呪術廻戦 (Jujutsu Kaisen)", universe: "ANIME", awakeningKeys: 8, popularityRank: 4 },
  {
    name: "Maximilian Alexander von Hohenzollern-Sigmaringen III",
    franchise: "A Very Long Franchise Title That Surely Will Not Fit On One Line Of The Card",
    universe: "GAME",
    ownerName: "UsuarioComNomeMuitoGrandeDemais",
    awakeningKeys: 0,
  },
  { name: "Ellen Ripley", franchise: "Alien", universe: "CINEMA", awakeningKeys: 6, popularityRank: 12 },
];

/** Entrada deterministica para (skin, variante, indice). Usada pelo script, goldens e testes. */
export function buildSampleInput(skinId: string, variant: CardVariant, index: number): RenderCardInput {
  const sample = SAMPLES[index % SAMPLES.length]!;
  return {
    ...sample,
    entityId: `sample-${index % SAMPLES.length}`,
    variant,
    tier: ENTITY_TIERS[index % ENTITY_TIERS.length]!,
    aetherValue: 120 + index * 137,
    atk: 92 - index * 3,
    def: 80 + (index % 5) * 4,
    spd: 94 - (index % 4) * 7,
    locale: "pt-BR",
    imageUrl: `synthetic://${index % SAMPLES.length}`,
    imageKey: `synthetic-${index % SAMPLES.length}`,
    skinId,
    // data fixa: nenhum evento ativo
    now: new Date("2026-01-01T00:00:00Z"),
  };
}

/** PNG reduzido (golden): decodifica o WebP e reamostra para 240 de largura (altura proporcional: 350 ou 375). */
export async function toGoldenPng(webp: Buffer): Promise<Buffer> {
  const img = await loadImage(webp);
  const h = Math.round((240 * img.height) / img.width);
  const canvas = createCanvas(240, h);
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, 240, h);
  return canvas.encode("png");
}

/* ------------------------------------------------------------------ */
/* Previa do embed (so para conferencia visual; imita o Discord)       */
/* ------------------------------------------------------------------ */

/** Caso completo, replicando o exemplo do Mudae. */
export const MUDAE_SAMPLE_VIEW: SummonView = {
  name: "Ryuji Sakamoto",
  franchise: "Persona 5",
  gender: "MALE",
  universe: "GAME",
  aetherValue: 380,
  awakeningKeys: 8,
  claimRank: 855,
  likeRank: 587,
  tier: "COMMON",
  variant: "STANDARD",
  ownerNote: "art by askziye",
  ownerPhrase: "For real ?!",
  hasCustomPic: true,
  customPicIndex: 1,
  ownerName: "hrtadorii",
  ownerKeys: 40,
  ownerPosition: 1,
};

const PREVIEW = {
  page: "#313338",
  embedBg: "#1e1f22",
  text: "#dbdee1",
  muted: "#b5bac1",
  blue: "#3b9bff",
  pink: "#ff6fb1",
  keyGold: "#e5b53b",
  crystal: "#8fa8ff",
  dot: "#6d6f78",
} as const;

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

type Seg = { text: string; bold: boolean; italic: boolean };

function parseMarkdown(line: string): Seg[] {
  const out: Seg[] = [];
  const re = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index), bold: false, italic: false });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true, italic: true });
    else if (m[2] !== undefined) out.push({ text: m[2], bold: true, italic: false });
    else out.push({ text: m[3]!, bold: false, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false, italic: false });
  return out.map((s) => ({ ...s, text: s.text.replace(/\\([\\*_~`|>[\]()#-])/g, "$1") }));
}

/** Desenha um segmento; emojis viram icones vetoriais simples (canvas nao renderiza emoji). Devolve o novo x. */
function drawSegment(g: SKRSContext2D, seg: Seg, x: number, y: number, size: number): number {
  setFont(g, seg.bold ? 700 : 400, size);
  let cx = x;
  for (const part of seg.text.split(/(\p{Extended_Pictographic}️?)/u)) {
    if (!part) continue;
    if (/^\p{Extended_Pictographic}/u.test(part)) {
      const r = size * 0.42;
      if (part.startsWith("💠")) {
        drawAetherCrystal(g, cx + r, y - size * 0.34, r, PREVIEW.crystal);
      } else if (part.startsWith("🗝")) {
        g.save();
        g.strokeStyle = PREVIEW.keyGold;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx + r * 0.6, y - size * 0.45, r * 0.5, 0, Math.PI * 2);
        g.moveTo(cx + r * 1.1, y - size * 0.3);
        g.lineTo(cx + r * 2.2, y - size * 0.05);
        g.stroke();
        g.restore();
      } else if (part.startsWith("♂") || part.startsWith("♀")) {
        g.fillStyle = part.startsWith("♂") ? PREVIEW.blue : PREVIEW.pink;
        g.beginPath();
        g.arc(cx + r, y - size * 0.34, r * 0.8, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = PREVIEW.dot;
        g.beginPath();
        g.arc(cx + r, y - size * 0.34, r * 0.8, 0, Math.PI * 2);
        g.fill();
      }
      cx += r * 2.4;
      continue;
    }
    g.fillStyle = PREVIEW.text;
    g.save();
    if (seg.italic) {
      g.translate(cx, y);
      g.transform(1, 0, -0.2, 1, 0, 0);
      g.fillText(part, 0, 0);
    } else g.fillText(part, cx, y);
    g.restore();
    setFont(g, seg.bold ? 700 : 400, size);
    cx += g.measureText(part).width;
  }
  return cx;
}

/** Previa do embed completo: fundo do Discord, barra lateral, author, linhas, imagem e footer. */
export async function renderEmbedPreview(view: SummonView, art: Buffer | Uint8Array, locale = "pt-BR"): Promise<Buffer> {
  registerFonts();
  const { embed } = buildSummonEmbed(view, { locale });
  const data = embed.toJSON();
  const lines = (data.description ?? "").split("\n");

  const pad = 16;
  const artW = 400;
  const img = await loadImage(Buffer.from(art));
  const artH = Math.round((artW * img.height) / img.width);
  const lineH = 24;
  const W = artW + pad * 2 + 4 + 36;
  const headerH = 34;
  const H = 20 + pad + headerH + lines.length * lineH + 14 + artH + 14 + 28 + pad + 20;

  const canvas = createCanvas(W, H);
  const g = canvas.getContext("2d");
  g.fillStyle = PREVIEW.page;
  g.fillRect(0, 0, W, H);

  const bx = 18;
  const by = 20;
  const bw = W - 36;
  const bh = H - 40;
  g.fillStyle = PREVIEW.embedBg;
  g.beginPath();
  g.roundRect(bx, by, bw, bh, 6);
  g.fill();
  g.fillStyle = hex(data.color ?? 0);
  g.beginPath();
  g.roundRect(bx, by, 4, bh, [6, 0, 0, 6]);
  g.fill();

  const x0 = bx + 4 + pad;
  let y = by + pad + 16;
  setFont(g, 700, 16);
  g.fillStyle = "#ffffff";
  g.fillText(data.author?.name ?? "", x0, y);
  y += headerH - 6;
  for (const line of lines) {
    let x = x0;
    for (const seg of parseMarkdown(line)) x = drawSegment(g, seg, x, y, 16);
    y += lineH;
  }
  y += 2;
  g.drawImage(img, x0, y, artW, artH);
  y += artH + 14;

  // footer: icone circular + texto
  g.fillStyle = PREVIEW.dot;
  g.beginPath();
  g.arc(x0 + 10, y + 4, 10, 0, Math.PI * 2);
  g.fill();
  setFont(g, 600, 13);
  g.fillStyle = PREVIEW.muted;
  g.fillText(data.footer?.text ?? "", x0 + (data.footer?.icon_url !== undefined || view.ownerName ? 30 : 0), y + 9);
  return canvas.encode("png");
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** Semeia .cache/img com os retratos sinteticos para que os workers (fetcher padrao so aceita https) os leiam do disco. */
async function seedDiskCache(): Promise<void> {
  const dir = path.join(process.cwd(), ".cache", "img");
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < SAMPLES.length; i++) {
    await fs.writeFile(path.join(dir, imageCacheKey(`synthetic://${i}`)), await makeSyntheticPortrait(i));
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      all: { type: "boolean", default: false },
      skin: { type: "string" },
      variant: { type: "string" },
      tier: { type: "string" },
      out: { type: "string", default: ".cache/test-cards" },
      pool: { type: "boolean", default: false },
      golden: { type: "boolean", default: false },
      rounds: { type: "string", default: "1" },
    },
  });

  const skinIds = values.skin ? [values.skin] : listSkins().map((s) => s.id);
  const variants = values.variant ? [values.variant as CardVariant] : [...CARD_VARIANTS];
  if (!values.all && !values.skin && !values.variant && !values.tier) {
    console.log("Use --all ou --skin/--variant/--tier. Exemplo: npx tsx src/scripts/testCanvas.ts --all");
    process.exitCode = 1;
    return;
  }
  for (const s of skinIds) if (!listSkins().some((k) => k.id === s)) throw new Error(`skin desconhecida: ${s}`);
  for (const v of variants) if (!(CARD_VARIANTS as readonly string[]).includes(v)) throw new Error(`variante desconhecida: ${v}`);
  if (values.tier && !(ENTITY_TIERS as readonly string[]).includes(values.tier)) throw new Error(`tier desconhecido: ${values.tier}`);

  const outDir = path.resolve(values.out);
  const pngDir = path.join(outDir, "png");
  const goldenDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/__golden__");
  await fs.mkdir(pngDir, { recursive: true });
  if (values.golden) await fs.mkdir(goldenDir, { recursive: true });

  const fonts = registerFonts();
  console.log(`Fontes: ${fonts.ok ? "ok" : "FALTANDO " + fonts.missing.join(", ")} (${fonts.dir})`);
  console.log(`Modo: ${values.pool ? "pool de workers" : "in-process"}; saida: ${outDir}`);

  const loader = createSyntheticLoader();
  const rounds = Math.max(1, Number(values.rounds) || 1);

  // warm-up (fontes, assets, JIT, pool): nao entra nas medidas
  const warmInput = buildSampleInput(skinIds[0]!, "STANDARD", 0);
  if (values.pool) {
    process.env.CANVAS_POOL = "on";
    await seedDiskCache();
    await renderCardInPool(warmInput);
  } else {
    await renderCard(warmInput, { loader, cache: false });
  }

  const times: number[] = [];
  const sizes: number[] = [];
  let index = 0;
  for (const skinId of skinIds) {
    for (const variant of variants) {
      const input = buildSampleInput(skinId, variant, index);
      if (values.tier) input.tier = values.tier as EntityTier;
      const name = `${skinId}__${variant}`;

      let webp: Buffer = Buffer.alloc(0);
      for (let r = 0; r < rounds; r++) {
        if (values.pool) getCardCache().clear();
        const t0 = performance.now();
        webp = values.pool
          ? await renderCardInPool(input)
          : await renderCard(input, { loader, cache: false });
        times.push(performance.now() - t0);
      }
      sizes.push(webp.length);
      await fs.writeFile(path.join(outDir, `${name}.webp`), webp);
      const { canvas } = await drawCard(input, { loader });
      await fs.writeFile(path.join(pngDir, `${name}.png`), await canvas.encode("png"));
      if (values.golden) await fs.writeFile(path.join(goldenDir, `${name}.png`), await toGoldenPng(webp));

      console.log(
        `${name.padEnd(26)} ${String(input.tier).padEnd(9)} ${(times[times.length - 1]!).toFixed(1).padStart(6)} ms  ${(webp.length / 1024).toFixed(1).padStart(6)} KB`
      );
      index++;
    }
  }

  const sorted = [...times].sort((a, b) => a - b);
  console.log(
    `\n${times.length} renders | p50 ${pct(sorted, 50).toFixed(1)} ms | p95 ${pct(sorted, 95).toFixed(1)} ms | max ${sorted[sorted.length - 1]!.toFixed(1)} ms | maior arquivo ${(Math.max(...sizes) / 1024).toFixed(1)} KB`
  );
  if (values.pool) {
    console.log(`pool: ${JSON.stringify(canvasPoolStats())} (tempo inclui ida/volta de mensagem; retratos vem do cache em disco semeado)`);
  }
  if (values.golden) console.log(`Goldens gravados em ${goldenDir}`);

  // previas do embed da skin mudae (arte limpa + embed imitando o Discord)
  if (skinIds.includes("mudae")) {
    const embedDir = path.join(outDir, "embed");
    await fs.mkdir(embedDir, { recursive: true });
    for (const variant of variants) {
      const input = { ...buildSampleInput("mudae", variant, 0), skinId: "mudae" };
      if (values.tier) input.tier = values.tier as EntityTier;
      const art = await renderCard(input, { loader, cache: false });
      const full = { ...MUDAE_SAMPLE_VIEW, variant, tier: input.tier ?? "COMMON" };
      await fs.writeFile(path.join(embedDir, `mudae-embed__${variant}.png`), await renderEmbedPreview(full, art));
      if (variant === variants[0]) {
        const free: SummonView = { ...full, ownerName: undefined, ownerNote: undefined, ownerPhrase: undefined, hasCustomPic: false };
        await fs.writeFile(path.join(embedDir, `mudae-embed-free__${variant}.png`), await renderEmbedPreview(free, art));
      }
    }
    console.log(`Previas do embed: ${embedDir}`);
  }

  // sanidade: cache usa a mesma chave => segunda chamada e hit
  const cache = new CardCache();
  const probe = buildSampleInput(skinIds[0]!, variants[0]!, 0);
  await renderCard(probe, { loader, cache });
  const t0 = performance.now();
  await renderCard(probe, { loader, cache });
  console.log(`cache hit: ${(performance.now() - t0).toFixed(2)} ms (hits=${cache.stats.hits})`);

  await shutdownCanvasPool();
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
