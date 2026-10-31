import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * Compact 256-color Animated GIF89a Encoder (pure JS/TS, zero external deps).
 * Builds a uniform 6x6x6 RGB palette + 40 grayscale/astral tones and LZW-encodes frames.
 */
function buildPalette(): Uint8Array {
	const pal = new Uint8Array(256 * 3);
	let idx = 0;
	for (let r = 0; r < 6; r++) {
		for (let g = 0; g < 6; g++) {
			for (let b = 0; b < 6; b++) {
				pal[idx * 3] = Math.round((r * 255) / 5);
				pal[idx * 3 + 1] = Math.round((g * 255) / 5);
				pal[idx * 3 + 2] = Math.round((b * 255) / 5);
				idx++;
			}
		}
	}
	// Remaining 40 slots: fine dark/violet/crimson/cyan shades for smooth dark-anime gradients
	for (let i = 0; i < 40; i++) {
		const v = Math.round((i / 39) * 255);
		pal[idx * 3] = v;
		pal[idx * 3 + 1] = Math.round(v * 0.85);
		pal[idx * 3 + 2] = Math.min(255, Math.round(v * 1.15));
		idx++;
	}
	return pal;
}

function quantizeFrame(rgba: Uint8ClampedArray, width: number, height: number, pal: Uint8Array): Uint8Array {
	const out = new Uint8Array(width * height);
	for (let i = 0, p = 0; i < out.length; i++, p += 4) {
		// Ordered dither (2x2 Bayer) to eliminate banding in dark gradients
		const x = i % width;
		const y = (i / width) | 0;
		const bayer = ((x & 1) * 2 + (y & 1) - 1.5) * 4;
		const r = Math.max(0, Math.min(255, rgba[p] + bayer));
		const g = Math.max(0, Math.min(255, rgba[p + 1] + bayer));
		const b = Math.max(0, Math.min(255, rgba[p + 2] + bayer));

		const ri = Math.round((r * 5) / 255);
		const gi = Math.round((g * 5) / 255);
		const bi = Math.round((b * 5) / 255);
		out[i] = ri * 36 + gi * 6 + bi;
	}
	return out;
}

function lzwEncode(indices: Uint8Array, minCodeSize = 8): Buffer {
	const clearCode = 1 << minCodeSize;
	const eoiCode = clearCode + 1;
	let codeSize = minCodeSize + 1;
	let nextCode = eoiCode + 1;

	// Hash table for (prefix << 8) | suffix -> code
	const table = new Int32Array(4096 * 256).fill(-1);
	const bytes: number[] = [];
	let bitBuf = 0;
	let bitCount = 0;

	const emit = (code: number) => {
		bitBuf |= code << bitCount;
		bitCount += codeSize;
		while (bitCount >= 8) {
			bytes.push(bitBuf & 0xff);
			bitBuf >>= 8;
			bitCount -= 8;
		}
	};

	emit(clearCode);
	let prefix = indices[0];

	for (let i = 1; i < indices.length; i++) {
		const k = indices[i];
		const key = (prefix << 8) | k;
		const found = table[key];
		if (found !== -1) {
			prefix = found;
		} else {
			emit(prefix);
			if (nextCode < 4096) {
				table[key] = nextCode++;
				if (nextCode > 1 << codeSize && codeSize < 12) {
					codeSize++;
				}
			} else {
				emit(clearCode);
				table.fill(-1);
				codeSize = minCodeSize + 1;
				nextCode = eoiCode + 1;
			}
			prefix = k;
		}
	}
	emit(prefix);
	emit(eoiCode);
	if (bitCount > 0) bytes.push(bitBuf & 0xff);

	// Sub-blocks of up to 255 bytes
	const subBlocks: number[] = [minCodeSize];
	for (let i = 0; i < bytes.length; i += 255) {
		const chunk = bytes.slice(i, i + 255);
		subBlocks.push(chunk.length, ...chunk);
	}
	subBlocks.push(0);
	return Buffer.from(subBlocks);
}

function encodeAnimatedGif(width: number, height: number, frames: Uint8ClampedArray[], delayCs = 6): Buffer {
	const pal = buildPalette();
	const chunks: Buffer[] = [];

	// Header + Logical Screen Descriptor (Global Color Table 256 colors = 0xF7)
	const header = Buffer.alloc(13);
	header.write("GIF89a", 0, "ascii");
	header.writeUInt16LE(width, 6);
	header.writeUInt16LE(height, 8);
	header[10] = 0xf7;
	header[11] = 0;
	header[12] = 0;
	chunks.push(header, Buffer.from(pal));

	// Netscape 2.0 Infinite Loop Extension
	chunks.push(
		Buffer.from([
			0x21, 0xff, 0x0b,
			0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
			0x03, 0x01, 0x00, 0x00, 0x00,
		])
	);

	for (const rgba of frames) {
		const gce = Buffer.from([0x21, 0xf9, 0x04, 0x00, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00]);
		const imgDesc = Buffer.alloc(10);
		imgDesc[0] = 0x2c;
		imgDesc.writeUInt16LE(0, 1);
		imgDesc.writeUInt16LE(0, 3);
		imgDesc.writeUInt16LE(width, 5);
		imgDesc.writeUInt16LE(height, 7);
		imgDesc[9] = 0x00;

		const indexed = quantizeFrame(rgba, width, height, pal);
		const lzw = lzwEncode(indexed, 8);
		chunks.push(gce, imgDesc, lzw);
	}

	chunks.push(Buffer.from([0x3b]));
	return Buffer.concat(chunks);
}

async function generateKoguAvatarGif(baseImagePath: string, outPath: string): Promise<void> {
	const W = 400;
	const H = 400;
	const TOTAL_FRAMES = 24;
	const baseImg = await loadImage(baseImagePath);
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");
	const frames: Uint8ClampedArray[] = [];

	// Fixed deterministic particles
	const particles = Array.from({ length: 28 }, (_, i) => ({
		x: ((i * 73) % 360) + 20,
		baseY: ((i * 137) % 380) + 10,
		size: (i % 3) + 1.8,
		speed: (i % 2) + 1,
		phase: (i * Math.PI) / 7,
		color: i % 3 === 0 ? "#a855f7" : i % 3 === 1 ? "#38bdf8" : "#f43f5e",
	}));

	for (let f = 0; f < TOTAL_FRAMES; f++) {
		const t = (f / TOTAL_FRAMES) * Math.PI * 2;
		ctx.clearRect(0, 0, W, H);

		// Subtle breathing zoom on portrait
		const scale = 1.03 + Math.sin(t) * 0.02;
		const dw = W * scale;
		const dh = H * scale;
		ctx.drawImage(baseImg, (W - dw) / 2, (H - dh) / 2, dw, dh);

		// Dark cinematic vignette + pulsing crimson/violet aura
		const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.22, W / 2, H / 2, W * 0.54);
		grad.addColorStop(0, "rgba(0,0,0,0)");
		grad.addColorStop(0.75, `rgba(88, 28, 135, ${0.18 + Math.sin(t) * 0.08})`);
		grad.addColorStop(1, "rgba(5, 5, 12, 0.72)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, W, H);

		// Glowing rising Ether shards
		for (const p of particles) {
			const y = (p.baseY - (f / TOTAL_FRAMES) * 120 * p.speed + H * 2) % H;
			const x = p.x + Math.sin(t + p.phase) * 8;
			const alpha = 0.45 + 0.45 * Math.sin(t * 2 + p.phase);

			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.fillStyle = p.color;
			ctx.translate(x, y);
			ctx.rotate(t + p.phase);
			ctx.beginPath();
			ctx.moveTo(0, -p.size * 2.2);
			ctx.lineTo(p.size * 1.3, 0);
			ctx.lineTo(0, p.size * 2.2);
			ctx.lineTo(-p.size * 1.3, 0);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}

		// Rotating Astral Runic Ring around the border (fits Discord's circular avatar crop!)
		ctx.save();
		ctx.translate(W / 2, H / 2);
		ctx.rotate(t * 0.5);
		ctx.strokeStyle = `rgba(168, 85, 247, ${0.55 + 0.3 * Math.sin(t)})`;
		ctx.lineWidth = 3;
		ctx.setLineDash([18, 10, 6, 10]);
		ctx.beginPath();
		ctx.arc(0, 0, W * 0.46, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();

		// Subtle holographic scan sheen
		const sheenY = ((f / TOTAL_FRAMES) * (H + 160)) - 80;
		const sheen = ctx.createLinearGradient(0, sheenY - 40, 0, sheenY + 40);
		sheen.addColorStop(0, "rgba(56, 189, 248, 0)");
		sheen.addColorStop(0.5, "rgba(168, 85, 247, 0.14)");
		sheen.addColorStop(1, "rgba(56, 189, 248, 0)");
		ctx.fillStyle = sheen;
		ctx.fillRect(0, 0, W, H);

		frames.push(ctx.getImageData(0, 0, W, H).data);
	}

	const gifBuf = encodeAnimatedGif(W, H, frames, 6);
	fs.writeFileSync(outPath, gifBuf);
}

async function generateKoguBannerGif(baseBannerPath: string, outPath: string): Promise<void> {
	const W = 680;
	const H = 240;
	const TOTAL_FRAMES = 24;
	const baseImg = await loadImage(baseBannerPath);
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext("2d");
	const frames: Uint8ClampedArray[] = [];

	const shards = Array.from({ length: 34 }, (_, i) => ({
		x: (i * 97) % W,
		y: (i * 53) % H,
		r: (i % 3) + 1.5,
		phase: (i * Math.PI) / 6,
		color: i % 2 === 0 ? "#38bdf8" : "#c084fc",
	}));

	for (let f = 0; f < TOTAL_FRAMES; f++) {
		const t = (f / TOTAL_FRAMES) * Math.PI * 2;
		ctx.clearRect(0, 0, W, H);

		// Smooth camera pan + pulse on background artwork
		const scale = 1.06 + Math.sin(t) * 0.015;
		const dw = W * scale;
		const dh = H * scale;
		const ox = (W - dw) / 2 + Math.cos(t) * 6;
		const oy = (H - dh) / 2;
		ctx.drawImage(baseImg, ox, oy, dw, dh);

		// Dark gradient overlay on right/center for crisp typography
		const bgGrad = ctx.createLinearGradient(0, 0, W, 0);
		bgGrad.addColorStop(0, "rgba(8, 7, 16, 0.78)");
		bgGrad.addColorStop(0.5, "rgba(12, 10, 24, 0.52)");
		bgGrad.addColorStop(1, "rgba(8, 7, 16, 0.72)");
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, W, H);

		// Floating Ether shards across the cosmos
		for (const s of shards) {
			const sx = (s.x + (f / TOTAL_FRAMES) * 60) % W;
			const sy = s.y + Math.sin(t + s.phase) * 6;
			ctx.save();
			ctx.globalAlpha = 0.35 + 0.45 * Math.sin(t * 2 + s.phase);
			ctx.fillStyle = s.color;
			ctx.beginPath();
			ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		// Animated Summoning Portal Ring on the right side (x=540, y=120)
		ctx.save();
		ctx.translate(545, 120);
		ctx.rotate(t);
		ctx.strokeStyle = `rgba(56, 189, 248, ${0.45 + 0.25 * Math.sin(t)})`;
		ctx.lineWidth = 2;
		ctx.setLineDash([12, 8]);
		ctx.beginPath();
		ctx.arc(0, 0, 74, 0, Math.PI * 2);
		ctx.stroke();
		ctx.rotate(-t * 2);
		ctx.strokeStyle = `rgba(192, 132, 252, ${0.55 + 0.3 * Math.cos(t)})`;
		ctx.beginPath();
		ctx.arc(0, 0, 56, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();

		// Floating Mythic 1/1 Gacha Card inside the right portal
		const cardY = 120 + Math.sin(t) * 6;
		ctx.save();
		ctx.translate(545, cardY);
		ctx.rotate(Math.sin(t) * 0.08);
		ctx.fillStyle = "#131122";
		ctx.strokeStyle = "#f43f5e";
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.roundRect(-28, -42, 56, 84, 6);
		ctx.fill();
		ctx.stroke();
		// Inner diamond emblem on card
		ctx.fillStyle = "#38bdf8";
		ctx.beginPath();
		ctx.moveTo(0, -16);
		ctx.lineTo(11, 0);
		ctx.lineTo(0, 16);
		ctx.lineTo(-11, 0);
		ctx.closePath();
		ctx.fill();
		ctx.restore();

		// Clean high-end KOGU emblem & typography (positioned at x=210 so left avatar circle never blocks it)
		ctx.save();
		ctx.fillStyle = "#ffffff";
		ctx.font = "bold 46px sans-serif";
		ctx.fillText("KOGU", 195, 118);

		// Glowing accent line under KOGU
		const lineW = 140 + Math.sin(t) * 20;
		const lineGrad = ctx.createLinearGradient(195, 0, 195 + lineW, 0);
		lineGrad.addColorStop(0, "#a855f7");
		lineGrad.addColorStop(1, "#38bdf8");
		ctx.fillStyle = lineGrad;
		ctx.fillRect(195, 130, lineW, 3);

		ctx.fillStyle = "#cbd5e1";
		ctx.font = "600 13px sans-serif";
		ctx.fillText("MULTIVERSE GACHA  •  CARDS  •  ARENA RPG", 195, 154);
		ctx.restore();

		frames.push(ctx.getImageData(0, 0, W, H).data);
	}

	const gifBuf = encodeAnimatedGif(W, H, frames, 6);
	fs.writeFileSync(outPath, gifBuf);
}

async function main() {
	const artifactDir = "C:/Users/Apollon/.gemini/antigravity/brain/37bf8420-9cc0-4038-bfbf-d0e4d2aa73d8";
	const avatarBase = path.join(artifactDir, "arqon_avatar_1793469090202.jpg");
	const bannerBase = path.join(artifactDir, "arqon_banner_1793469137514.jpg");

	const outAvatarGif = path.join(artifactDir, "kogu_avatar_animated.gif");
	const outBannerGif = path.join(artifactDir, "kogu_banner_animated.gif");

	console.log("Gerando kogu_avatar_animated.gif...");
	await generateKoguAvatarGif(avatarBase, outAvatarGif);
	console.log("Gerando kogu_banner_animated.gif...");
	await generateKoguBannerGif(bannerBase, outBannerGif);
	console.log("GIFs gerados com sucesso em:", outAvatarGif, outBannerGif);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
