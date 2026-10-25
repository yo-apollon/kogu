import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test-utils";
import { TierBadge } from "../card/tier-badge";
import { GenderGlyph } from "../card/gender-glyph";
import { Sparkline } from "../charts/sparkline";
import { BarSeries } from "../charts/bar-series";
import { ProgressBar } from "../data/progress-bar";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { Switch } from "./switch";

describe("a11y basica", () => {
  it("TierBadge traduz o tier (pt-BR e en-US)", () => {
    renderWithProviders(<TierBadge tier="LEGENDARY" />);
    expect(screen.getByText("Lendário")).toBeTruthy();
  });

  it("TierBadge em ingles", () => {
    renderWithProviders(<TierBadge tier="mythic" />, { locale: "en-US" });
    expect(screen.getByText("Mythic")).toBeTruthy();
  });

  it("GenderGlyph tem nome acessivel", () => {
    renderWithProviders(<GenderGlyph gender="NONBINARY" />);
    expect(screen.getByRole("img", { name: "Não binário" })).toBeTruthy();
  });

  it("graficos expoem role=img com titulo", () => {
    renderWithProviders(
      <>
        <Sparkline data={[1, 2, 3]} label="Tendência" />
        <BarSeries data={[{ label: "D1", value: 3 }]} label="Barras" />
      </>,
    );
    expect(screen.getByRole("img", { name: "Tendência" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Barras" })).toBeTruthy();
  });

  it("ProgressBar expoe valores ARIA limitados", () => {
    renderWithProviders(<ProgressBar value={150} max={100} label="Uso" />);
    const bar = screen.getByRole("progressbar", { name: "Uso" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("Switch tem role switch", () => {
    renderWithProviders(<Switch aria-label="Ativar" />);
    expect(screen.getByRole("switch", { name: "Ativar" }).getAttribute("aria-checked")).toBe("false");
  });

  it("EmptyState mostra o comando do bot", () => {
    renderWithProviders(<EmptyState title="Vazio" command="$summon" />);
    expect(screen.getByText("$summon").tagName).toBe("KBD");
  });

  it("ErrorState usa role=alert e retry", () => {
    renderWithProviders(<ErrorState onRetry={() => {}} digest="x1" />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.getByText("ID do erro: x1")).toBeTruthy();
  });
});
