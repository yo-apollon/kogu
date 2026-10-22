import { describe, expect, it } from "vitest";
import { CARD_VARIANTS, ENTITY_TIERS } from "../../../src/config/gacha.js";
import { VARIANT_PALETTES } from "../../../src/ui/tokens.js";
import { mix, resolveTheme, rgba, variantLabel } from "../../../src/canvas/theme/tokens.js";

describe("resolveTheme", () => {
  it("COMMON reproduz as paletas do renderer legado", () => {
    expect(resolveTheme("COMMON", "STANDARD")).toMatchObject({ primary: "#5865F2", secondary: "#2B2D31", badgeBg: "#313338", label: "STANDARD", borderWidth: 4, glowBlur: 0 });
    expect(resolveTheme("COMMON", "FOIL")).toMatchObject({ primary: "#E2E8F0", glow: "#CBD5E1", label: "FOIL +25%", borderWidth: 4, glowBlur: 16 });
    expect(resolveTheme("COMMON", "HOLO")).toMatchObject({ primary: "#FACC15", label: "HOLO +75%", borderWidth: 6 });
    expect(resolveTheme("COMMON", "ASTRAL")).toMatchObject({ primary: "#E879F9", secondary: "#06B6D4", label: "ASTRAL +300%", borderWidth: 8 });
  });

  it("borda e brilho crescem (ou ficam iguais) com o tier", () => {
    for (const variant of CARD_VARIANTS) {
      let prevBorder = 0;
      let prevGlow = -1;
      for (const tier of ENTITY_TIERS) {
        const t = resolveTheme(tier, variant);
        expect(t.borderWidth).toBeGreaterThanOrEqual(prevBorder);
        expect(t.glowBlur).toBeGreaterThan(prevGlow);
        prevBorder = t.borderWidth;
        prevGlow = t.glowBlur;
      }
    }
  });

  it("paletas de variante batem com src/ui/tokens (embeds e cartas usam as mesmas cores)", () => {
    for (const variant of CARD_VARIANTS) {
      const canvas = resolveTheme("COMMON", variant);
      const ui = VARIANT_PALETTES[variant];
      const hex = (n: number) => `#${n.toString(16).padStart(6, "0").toUpperCase()}`;
      expect([canvas.primary, canvas.secondary, canvas.glow, canvas.badgeBg]).toEqual([hex(ui.primary), hex(ui.secondary), hex(ui.glow), hex(ui.badgeBg)]);
    }
  });

  it("e deterministico e memoizado", () => {
    expect(resolveTheme("EPIC", "HOLO")).toBe(resolveTheme("EPIC", "HOLO"));
  });

  it("variantLabel segue o multiplicador de Eter", () => {
    expect(variantLabel("STANDARD")).toBe("STANDARD");
    expect(variantLabel("ASTRAL")).toBe("ASTRAL +300%");
  });

  it("helpers de cor", () => {
    expect(rgba("#FF0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});
