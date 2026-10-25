import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]));
}

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

describe("contraste AA dos tokens (>= 4.5:1)", () => {
  for (const [name, t] of [["claro", light], ["escuro", dark]] as const) {
    const pairs: Array<[string, string]> = [
      ["fg", "bg"],
      ["fg", "surface"],
      ["muted", "bg"],
      ["muted", "surface"],
      ["muted", "surface-2"],
      ["subtle", "bg"],
      ["subtle", "surface"],
      ["subtle", "surface-2"],
      ["accent-fg", "accent"],
      ["accent", "surface"],
      ["state-success", "surface"],
      ["state-error", "surface"],
    ];
    for (const [fg, bg] of pairs) {
      it(`${name}: ${fg} sobre ${bg}`, () => {
        expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
