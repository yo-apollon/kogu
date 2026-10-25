import { describe, expect, it } from "vitest";
import { formatAether, formatDuration, formatNumber, formatRelative } from "./format";

const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("format", () => {
  it("formatNumber segue o locale", () => {
    expect(formatNumber(1234567, "pt-BR")).toBe("1.234.567");
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
  });

  it("formatAether anexa a unidade do idioma", () => {
    expect(norm(formatAether(1500, "pt-BR"))).toBe("1.500 Éter");
    expect(norm(formatAether(1500, "en-US"))).toBe("1,500 Aether");
    expect(formatAether(1500, "pt-BR", { withUnit: false })).toBe("1.500");
    expect(norm(formatAether(12_000_000n, "en-US", { compact: true }))).toBe("12M Aether");
  });

  it("formatRelative escolhe a unidade", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelative(new Date("2026-01-01T09:00:00Z"), "pt-BR", now)).toBe("há 3 horas");
    expect(formatRelative(new Date("2026-01-03T12:00:00Z"), "en-US", now)).toBe("in 2 days");
    expect(formatRelative(now, "en-US", now)).toBe("now");
  });

  it("formatDuration usa ate duas unidades", () => {
    expect(norm(formatDuration(3900, "pt-BR"))).toBe("1 h 5 min");
    expect(norm(formatDuration(45, "en-US"))).toBe("45s");
    expect(norm(formatDuration(90_061, "en-US"))).toBe("1d 1h");
    expect(norm(formatDuration(0, "en-US"))).toBe("0s");
  });
});
