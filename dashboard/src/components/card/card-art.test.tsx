import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test-utils";
import { CardArt } from "./card-art";
import { VARIANTS } from "./constants";

describe("CardArt", () => {
  it.each(VARIANTS)("marca a variante %s", (variant) => {
    const { container } = renderWithProviders(<CardArt src="https://cdn.discordapp.com/x.png" name="Rem" tier="EPIC" variant={variant.toUpperCase()} />);
    const root = container.querySelector(".card-art");
    expect(root?.getAttribute("data-variant")).toBe(variant);
    expect(root?.getAttribute("data-tier")).toBe("epic");
  });

  it("variante e tier desconhecidos caem no padrao", () => {
    const { container } = renderWithProviders(<CardArt name="Rem" tier="???" variant={null} />);
    const root = container.querySelector(".card-art");
    expect(root?.getAttribute("data-variant")).toBe("standard");
    expect(root?.getAttribute("data-tier")).toBe("common");
  });

  it("usa imagem lazy, nao otimizada e com alt acessivel", () => {
    renderWithProviders(<CardArt src="https://cdn.discordapp.com/x.png" name="Rem" />);
    const img = screen.getByRole("img", { name: "Carta de Rem" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("src")).toContain("cdn.discordapp.com/x.png");
  });

  it("sem imagem mostra iniciais (fallback)", () => {
    const { container } = renderWithProviders(<CardArt name="Killua Zoldyck" tier="rare" />);
    expect(container.querySelector(".card-art")?.getAttribute("data-fallback")).toBe("true");
    expect(screen.getByRole("img", { name: "Carta de Killua Zoldyck" }).textContent).toBe("KZ");
  });

  it("erro de carga troca para o fallback", () => {
    const { container } = renderWithProviders(<CardArt src="https://cdn.discordapp.com/x.png" name="Rem" />);
    fireEvent.error(screen.getByRole("img", { name: "Carta de Rem" }));
    expect(container.querySelector(".card-art")?.getAttribute("data-fallback")).toBe("true");
  });
});
