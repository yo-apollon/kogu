import { createCanvas, loadImage, SKRSContext2D } from "@napi-rs/canvas";

export interface CardRenderOptions {
  name: string;
  franchise: string;
  universe: string;
  imageUrl?: string;
  variant: "STANDARD" | "FOIL" | "HOLO" | "ASTRAL";
  awakeningKeys?: number;
  aetherValue: number;
  popularityRank?: number;
  atk?: number;
  def?: number;
  spd?: number;
  ownerName?: string;
  isWish?: boolean;
}

/**
 * Desenha um Cristal de Éter (Losango lapidado vetorial) — substitui emojis que quebram no Canvas
 */
function drawAetherCrystal(ctx: SKRSContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.75, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.75, y);
  ctx.closePath();

  const grad = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
  grad.addColorStop(0, "#FFFFFF");
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, "#006644");
  ctx.fillStyle = grad;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();
  ctx.restore();
}

/**
 * Desenha uma Estrela de 5 pontas vetorial para os Selos de Despertar
 */
function drawStar(ctx: SKRSContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number, color: string) {
  ctx.save();
  let rot = (Math.PI / 2) * 3;
  let x = cx;
  let y = cy;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();
}

/**
 * Baixa a imagem via fetch com User-Agent real para evitar bloqueio 403 de CDNs
 */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    // Rejeita links conhecidos do Imgur que foram deletados ou retornam placeholder
    if (url.includes("imgur.com") && !url.includes("i.imgur.com/fallback")) {
      // Muitos links antigos do imgur estão mortos e retornam imagem de erro de 503 bytes
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    // Imagens de erro do Imgur "The image you are requesting does not exist" têm tipicamente entre 500 e 6000 bytes
    if (url.includes("imgur.com") && buf.length < 8000) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

export async function renderCharacterCard(options: CardRenderOptions): Promise<Buffer> {
  const width = 480;
  const height = 700;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const safeAether = Number.isFinite(options.aetherValue) ? options.aetherValue : 150;
  const safeRank = options.popularityRank && options.popularityRank < 99999 ? `#${options.popularityRank}` : "#NEW";
  const atk = options.atk ?? 80;
  const def = options.def ?? 75;
  const spd = options.spd ?? 85;

  // Paleta de Raridade TCG AAA
  const themes: Record<
    string,
    {
      primary: string;
      secondary: string;
      glow: string;
      badgeBg: string;
      label: string;
    }
  > = {
    STANDARD: {
      primary: "#5865F2",
      secondary: "#2B2D31",
      glow: "#5865F2",
      badgeBg: "#313338",
      label: "STANDARD",
    },
    FOIL: {
      primary: "#E2E8F0",
      secondary: "#64748B",
      glow: "#CBD5E1",
      badgeBg: "#475569",
      label: "FOIL +25%",
    },
    HOLO: {
      primary: "#FACC15",
      secondary: "#CA8A04",
      glow: "#FDE047",
      badgeBg: "#854D0E",
      label: "HOLO +75%",
    },
    ASTRAL: {
      primary: "#E879F9",
      secondary: "#06B6D4",
      glow: "#D946EF",
      badgeBg: "#701A75",
      label: "ASTRAL +300%",
    },
  };

  const theme = themes[options.variant] || themes.STANDARD;

  // 1. Fundo Base Escuro com Gradiente Dimensional
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#0B0C10");
  bgGrad.addColorStop(0.5, "#141622");
  bgGrad.addColorStop(1, "#090A0F");
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 22);
  ctx.fill();

  // 2. Área da Arte do Personagem (Grande Destaque Estilo Mudae & TCG)
  const artX = 16;
  const artY = 56;
  const artW = width - 32;
  const artH = 490; // Amplo destaque vertical para a arte do personagem

  let loadedImg = null;
  if (options.imageUrl) {
    const imgBuf = await fetchImageBuffer(options.imageUrl);
    if (imgBuf) {
      try {
        loadedImg = await loadImage(imgBuf);
      } catch {
        loadedImg = null;
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(artX, artY, artW, artH, 12);
  ctx.clip();

  if (loadedImg) {
    const imgRatio = loadedImg.width / loadedImg.height;
    const boxRatio = artW / artH;
    let drawW = artW;
    let drawH = artH;
    let offsetX = artX;
    let offsetY = artY;

    if (imgRatio > boxRatio) {
      drawW = artH * imgRatio;
      offsetX = artX - (drawW - artW) / 2;
    } else {
      drawH = artW / imgRatio;
      offsetY = artY - (drawH - artH) * 0.10;
    }
    ctx.drawImage(loadedImg, offsetX, offsetY, drawW, drawH);
  } else {
    const fallbackGrad = ctx.createRadialGradient(
      width / 2,
      artY + artH / 2,
      20,
      width / 2,
      artY + artH / 2,
      260
    );
    fallbackGrad.addColorStop(0, theme.primary);
    fallbackGrad.addColorStop(0.5, "#1E1B4B");
    fallbackGrad.addColorStop(1, "#090A0F");
    ctx.fillStyle = fallbackGrad;
    ctx.fillRect(artX, artY, artW, artH);

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(width / 2, artY + artH / 2, 110, 0, Math.PI * 2);
    ctx.stroke();

    const initials = options.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 76px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, width / 2, artY + artH / 2);
  }

  // Vinheta inferior suave
  const vignette = ctx.createLinearGradient(0, artY + artH - 90, 0, artY + artH);
  vignette.addColorStop(0, "rgba(11, 12, 16, 0)");
  vignette.addColorStop(1, "rgba(11, 12, 16, 0.95)");
  ctx.fillStyle = vignette;
  ctx.fillRect(artX, artY + artH - 90, artW, 90);

  // Efeito Holográfico / Astral sobreposto na arte
  if (options.variant !== "STANDARD") {
    const sheen = ctx.createLinearGradient(artX, artY, artX + artW, artY + artH);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.0)");
    sheen.addColorStop(0.45, "rgba(255, 255, 255, 0.08)");
    sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.22)");
    sheen.addColorStop(0.55, "rgba(255, 255, 255, 0.08)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(artX, artY, artW, artH);
  }
  ctx.restore();

  // 3. Barra Superior (Header da Carta: Universo + Variante + Rank)
  // Pill do Universo
  ctx.fillStyle = "#1E2030";
  ctx.beginPath();
  ctx.roundRect(16, 14, 130, 32, 6);
  ctx.fill();
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(options.universe.toUpperCase(), 81, 35);

  // Pill da Variante (Centro)
  ctx.fillStyle = theme.badgeBg;
  ctx.beginPath();
  ctx.roundRect(156, 14, 160, 32, 6);
  ctx.fill();
  ctx.strokeStyle = theme.primary;
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText(theme.label, 236, 35);

  // Pill do Rank (Direita)
  ctx.fillStyle = "#1E2030";
  ctx.beginPath();
  ctx.roundRect(width - 138, 14, 122, 32, 6);
  ctx.fill();
  ctx.strokeStyle = "#FACC15";
  ctx.stroke();

  ctx.fillStyle = "#FACC15";
  ctx.font = "bold 13px Arial, sans-serif";
  ctx.fillText(`RANK ${safeRank}`, width - 77, 35);

  // 4. Estrelas de Despertar (Flutuando na base da Arte)
  if (options.awakeningKeys && options.awakeningKeys > 0) {
    const maxStars = Math.min(options.awakeningKeys, 6);
    for (let i = 0; i < maxStars; i++) {
      drawStar(ctx, 36 + i * 26, artY + artH - 20, 5, 10, 4.5, "#FACC15");
    }
    if (options.awakeningKeys > 6) {
      ctx.fillStyle = "#FACC15";
      ctx.font = "bold 15px Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`+${options.awakeningKeys - 6}`, 36 + maxStars * 26, artY + artH - 14);
    }
  }

  // 5. Painel de Informações Inferior (Design Limpo e Elegante)
  const panelY = 556;
  ctx.fillStyle = "#13151F";
  ctx.beginPath();
  ctx.roundRect(16, panelY, width - 32, 128, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Nome da Entidade
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "bold 24px Arial, sans-serif";
  ctx.textAlign = "left";
  const displayName = options.name.length > 24 ? options.name.slice(0, 22) + "..." : options.name;
  ctx.fillText(displayName, 30, panelY + 32);

  // Nome da Franquia / Obra
  ctx.fillStyle = "#94A3B8";
  ctx.font = "bold 14px Arial, sans-serif";
  const displayFranchise =
    options.franchise.length > 36 ? options.franchise.slice(0, 34) + "..." : options.franchise;
  ctx.fillText(displayFranchise, 30, panelY + 56);

  // Linha divisória sutil
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(30, panelY + 68);
  ctx.lineTo(width - 30, panelY + 68);
  ctx.stroke();

  // Atributos de Combate (ATK / DEF / SPD)
  ctx.font = "bold 12px Arial, sans-serif";
  ctx.fillStyle = "#F87171";
  ctx.fillText(`ATK ${atk}`, 30, panelY + 88);

  ctx.fillStyle = "#60A5FA";
  ctx.fillText(`DEF ${def}`, 105, panelY + 88);

  ctx.fillStyle = "#34D399";
  ctx.fillText(`SPD ${spd}`, 180, panelY + 88);

  // Cristal Vetorial + Valor em Éter (Esquerda Inferior)
  drawAetherCrystal(ctx, 38, panelY + 110, 8, "#00FFA3");
  ctx.fillStyle = "#00FFA3";
  ctx.font = "bold 17px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${safeAether} Éter`, 54, panelY + 115);

  // Badge de Status do Pacto (Direita Inferior)
  ctx.textAlign = "right";
  if (options.ownerName) {
    ctx.fillStyle = "#F472B6";
    ctx.font = "bold 13px Arial, sans-serif";
    ctx.fillText(`Pacto: ${options.ownerName.slice(0, 16)}`, width - 30, panelY + 115);
  } else {
    ctx.fillStyle = "#4ADE80";
    ctx.font = "bold 14px Arial, sans-serif";
    ctx.fillText("LIVRE PARA PACTO", width - 30, panelY + 115);
  }

  // 6. Moldura Externa Principal com Brilho de Raridade
  ctx.save();
  const borderGrad = ctx.createLinearGradient(0, 0, width, height);
  borderGrad.addColorStop(0, theme.primary);
  borderGrad.addColorStop(0.5, theme.secondary);
  borderGrad.addColorStop(1, theme.primary);

  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = options.variant === "ASTRAL" ? 8 : options.variant === "HOLO" ? 6 : 4;
  if (options.variant !== "STANDARD") {
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur = 16;
  }
  ctx.beginPath();
  ctx.roundRect(8, 8, width - 16, height - 16, 18);
  ctx.stroke();
  ctx.restore();

  return canvas.toBuffer("image/png");
}
