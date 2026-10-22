import { describe, expect, it } from "vitest";
import {
  discordTimestamp,
  escapeMarkdown,
  formatAether,
  formatDuration,
  formatNumber,
  genderSymbol,
  pluralize,
  progressBar,
  relativeTime,
  truncate,
} from "../../../src/ui/format.js";

describe("formatNumber", () => {
  it("usa o separador do idioma", () => {
    expect(formatNumber(1234567, "pt-BR")).toBe("1.234.567");
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
  });
  it("trata NaN/Infinity como 0", () => {
    expect(formatNumber(NaN)).toBe("0");
    expect(formatNumber(Infinity)).toBe("0");
  });
});

describe("progressBar", () => {
  it("preenche proporcionalmente", () => {
    expect(progressBar(5, 10, 10)).toBe("█████░░░░░");
    expect(progressBar(0, 10, 4)).toBe("░░░░");
    expect(progressBar(10, 10, 4)).toBe("████");
  });
  it("limita valores fora da faixa e max invalido", () => {
    expect(progressBar(99, 10, 4)).toBe("████");
    expect(progressBar(-5, 10, 4)).toBe("░░░░");
    expect(progressBar(5, 0, 4)).toBe("░░░░");
  });
  it("celulas customizadas", () => {
    expect(progressBar(2, 4, 4, { filled: "🟩", empty: "⬛" })).toBe("🟩🟩⬛⬛");
  });
});

describe("truncate", () => {
  it("nao mexe em texto curto", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcde", 5)).toBe("abcde");
  });
  it("corta com reticencias dentro do limite", () => {
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
    expect(truncate("abcdefgh", 5).length).toBe(5);
  });
  it("nao quebra pares substitutos (emoji)", () => {
    expect(truncate("🌌🌌🌌🌌", 3)).toBe("🌌🌌…");
  });
});

describe("escapeMarkdown", () => {
  it("escapa caracteres especiais", () => {
    expect(escapeMarkdown("*a* _b_ ~c~ `d` |e| > [f](g) # h")).toBe(
      "\\*a\\* \\_b\\_ \\~c\\~ \\`d\\` \\|e\\| \\> \\[f\\]\\(g\\) \\# h"
    );
    expect(escapeMarkdown("a\\b")).toBe("a\\\\b");
  });
  it("escapa lista no inicio da linha", () => {
    expect(escapeMarkdown("- item\nx - y")).toBe("\\- item\nx - y");
  });
});

describe("tempo", () => {
  it("relativeTime gera marcador R do Discord", () => {
    expect(relativeTime(1_700_000_123_999)).toBe("<t:1700000123:R>");
    expect(discordTimestamp(1_700_000_123_000, "f")).toBe("<t:1700000123:f>");
  });
  it("formatDuration", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(3_725_000)).toBe("1h 02m");
    expect(formatDuration(-10)).toBe("0s");
  });
});

describe("pluralize / aether / genero", () => {
  it("pluralize", () => {
    expect(pluralize(1, "entidade", "entidades")).toBe("entidade");
    expect(pluralize(2, "entidade", "entidades")).toBe("entidades");
    expect(pluralize(0, "pact")).toBe("pacts");
  });
  it("formatAether", () => {
    expect(formatAether(1234, { locale: "pt-BR" })).toBe("1.234 💠");
    expect(formatAether(1234, { locale: "en-US", bold: true })).toBe("**1,234** 💠");
  });
  it("genderSymbol", () => {
    expect(genderSymbol("FEMALE")).toBe("♀");
    expect(genderSymbol("MALE")).toBe("♂");
    expect(genderSymbol("BOTH")).toBe("⚧");
    expect(genderSymbol(null)).toBe("⚧");
  });
});
