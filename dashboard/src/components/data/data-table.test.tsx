import { fireEvent, screen, within } from "@testing-library/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockMatchMedia, renderWithProviders } from "../test-utils";
import { DataTable } from "./data-table";

interface Row {
  id: string;
  name: string;
  aether: number;
}

const data: Row[] = [
  { id: "1", name: "Rem", aether: 300 },
  { id: "2", name: "Asuka", aether: 100 },
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "name", header: "Nome" },
  { accessorKey: "aether", header: "Éter", meta: { numeric: true } },
];

afterEach(() => vi.unstubAllGlobals());

describe("DataTable", () => {
  it("desktop: renderiza tabela com cabecalhos e linhas", () => {
    mockMatchMedia(true);
    renderWithProviders(<DataTable columns={columns} data={data} getRowId={(r) => r.id} aria-label="Entidades" />);
    const table = screen.getByRole("table", { name: "Entidades" });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(2);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("mobile: vira lista de cartoes com as mesmas colunas", () => {
    mockMatchMedia(false);
    renderWithProviders(<DataTable columns={columns} data={data} getRowId={(r) => r.id} aria-label="Entidades" />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: "Entidades" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Rem")).toBeTruthy();
    expect(within(list).getAllByText("Éter").length).toBe(2); // rotulo da 2a coluna em cada cartao
    expect(within(list).getByText("300")).toBeTruthy();
  });

  it("mobile aceita render customizado", () => {
    mockMatchMedia(false);
    renderWithProviders(
      <DataTable columns={columns} data={data} getRowId={(r) => r.id} aria-label="Entidades" mobile={(r) => <b>custom-{r.name}</b>} />,
    );
    expect(screen.getByText("custom-Rem")).toBeTruthy();
  });

  it("ordenacao controlada notifica e expoe aria-sort", () => {
    mockMatchMedia(true);
    const onSortingChange = vi.fn();
    const sorting: SortingState = [{ id: "aether", desc: true }];
    renderWithProviders(
      <DataTable columns={columns} data={data} getRowId={(r) => r.id} aria-label="Entidades" sorting={sorting} onSortingChange={onSortingChange} />,
    );
    expect(screen.getByRole("columnheader", { name: /Éter/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /Nome/ }));
    expect(onSortingChange).toHaveBeenCalledTimes(1);
  });

  it("estado vazio", () => {
    mockMatchMedia(true);
    renderWithProviders(<DataTable columns={columns} data={[]} getRowId={(r) => r.id} aria-label="Entidades" />);
    expect(screen.getByText("Nenhum registro encontrado.")).toBeTruthy();
  });
});
