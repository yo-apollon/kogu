import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const GOLDEN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../__golden__");
export const SRC_CANVAS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src/canvas");

export function sha1(buf: Uint8Array): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/** aHash 16x16: 256 bits (1 = pixel acima da media de luminancia). */
export async function aHash(image: Buffer): Promise<boolean[]> {
  const img = await loadImage(image);
  const canvas = createCanvas(16, 16);
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, 16, 16);
  const { data } = g.getImageData(0, 0, 16, 16);
  const lum: number[] = [];
  for (let i = 0; i < data.length; i += 4) lum.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  return lum.map((v) => v > mean);
}

export function hamming(a: boolean[], b: boolean[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function listSourceFiles(dir: string, filter: (file: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full, filter));
    else if (entry.name.endsWith(".ts") && filter(full)) out.push(full);
  }
  return out;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}
