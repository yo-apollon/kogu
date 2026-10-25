import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-utils";
import { FilterBar } from "./filter-bar";

const filters = [
  {
    key: "tier",
    label: "Tier",
    options: [
      { value: "rare", label: "Raro" },
      { value: "epic", label: "Épico" },
    ],
  },
];

describe("FilterBar", () => {
  it("escreve a busca na URL apos o debounce e limpa o cursor", async () => {
    const onUrlUpdate = vi.fn();
    renderWithProviders(<FilterBar filters={filters} />, { onUrlUpdate, searchParams: "?cursor=abc" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar" }), { target: { value: "killua" } });
    expect(onUrlUpdate).not.toHaveBeenCalled(); // ainda dentro dos 300 ms
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled(), { timeout: 2000 });
    const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams as URLSearchParams;
    expect(params.get("q")).toBe("killua");
    expect(params.has("cursor")).toBe(false);
  });

  it("filtros ativos viram chips removiveis", async () => {
    const onUrlUpdate = vi.fn();
    renderWithProviders(<FilterBar filters={filters} />, { onUrlUpdate, searchParams: "?tier=rare&page=3" });
    const chip = screen.getByRole("button", { name: "Remover filtro Tier: Raro" });
    fireEvent.click(chip);
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const params = onUrlUpdate.mock.calls.at(-1)?.[0].searchParams as URLSearchParams;
    expect(params.has("tier")).toBe(false);
    expect(params.has("page")).toBe(false);
  });

  it("limpar tudo remove todos os filtros", async () => {
    const onUrlUpdate = vi.fn();
    renderWithProviders(<FilterBar filters={filters} />, { onUrlUpdate, searchParams: "?tier=epic" });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect((onUrlUpdate.mock.calls.at(-1)?.[0].searchParams as URLSearchParams).has("tier")).toBe(false);
  });
});
