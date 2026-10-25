"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { DataList, DataListFields } from "./data-list";
import { useMediaQuery } from "./use-media-query";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    /** Alinha a direita e usa numeros tabulares. */
    numeric?: boolean;
    className?: string;
    /** Rotulo no cartao mobile quando o header nao e texto. */
    mobileLabel?: string;
  }
}

export const ROW_HEIGHT = 36;
export const VIRTUALIZE_AFTER = 100;

export interface DataTableProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  data: readonly T[];
  getRowId: (row: T, index: number) => string;
  /**
   * Ordenacao controlada (URL/servidor). Se `onSortingChange` existir, a tabela NAO reordena:
   * a fonte de dados ja chega ordenada. Sem ele, ordena no cliente.
   */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Renderizacao do cartao no mobile. Padrao: 1a coluna como titulo e as demais como pares. */
  mobile?: (row: T) => ReactNode;
  loading?: boolean;
  empty?: ReactNode;
  /** Nome acessivel da tabela/lista. */
  "aria-label": string;
  /** Altura maxima da area rolavel (cabecalho fixo). */
  maxHeight?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  sorting: sortingProp,
  onSortingChange,
  mobile,
  loading,
  empty,
  "aria-label": ariaLabel,
  maxHeight = "70vh",
  className,
}: DataTableProps<T>) {
  const t = useTranslations("table");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const manual = onSortingChange !== undefined;
  const sorting = sortingProp ?? localSorting;

  // TanStack Table nao e memoizavel pelo React Compiler; o componente aceita isso.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({
    data: data as T[],
    columns: columns as ColumnDef<T, unknown>[],
    state: { sorting },
    onSortingChange: onSortingChange ?? setLocalSorting,
    manualSorting: manual,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manual ? undefined : getSortedRowModel(),
    enableSortingRemoval: true,
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = isDesktop && rows.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtual,
  });

  if (!isDesktop) {
    if (loading) return <ListSkeleton />;
    if (rows.length === 0) return <>{empty ?? <p className="py-8 text-center text-sm text-muted">{t("empty")}</p>}</>;
    return (
      <DataList
        aria-label={ariaLabel}
        items={rows}
        getKey={(r) => r.id}
        className={className}
        render={(r) => (mobile ? mobile(r.original) : <DefaultCard row={r} />)}
      />
    );
  }

  const items = virtual ? virtualizer.getVirtualItems() : null;
  const padTop = items && items.length > 0 ? (items[0]?.start ?? 0) : 0;
  const padBottom = items && items.length > 0 ? virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0) : 0;
  const visibleRows: Row<T>[] = items ? items.map((v) => rows[v.index]!) : rows;
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <table aria-label={ariaLabel} aria-rowcount={rows.length} className="w-full border-collapse text-base">
          <thead className="sticky top-0 z-10 bg-surface-2">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const content = flexRender(header.column.columnDef.header, header.getContext());
                  const columnName =
                    typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined}
                      className={cn(
                        "h-9 border-b border-border px-3 text-xs font-medium whitespace-nowrap text-muted",
                        meta?.numeric ? "text-right" : "text-left",
                        meta?.className,
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          aria-label={
                            sorted === "asc"
                              ? t("sortDesc", { column: columnName })
                              : sorted === "desc"
                                ? t("sortNone", { column: columnName })
                                : t("sortAsc", { column: columnName })
                          }
                          className={cn(
                            "-mx-1 inline-flex h-7 items-center gap-1 rounded-sm px-1 hover:text-fg",
                            meta?.numeric && "flex-row-reverse",
                            sorted && "text-fg",
                          )}
                        >
                          {content}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-50" aria-hidden />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} style={{ height: ROW_HEIGHT }}>
                  <td colSpan={colCount} className="px-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  {empty ?? <p className="py-10 text-center text-sm text-muted">{t("empty")}</p>}
                </td>
              </tr>
            ) : (
              <>
                {padTop > 0 ? (
                  <tr aria-hidden style={{ height: padTop }}>
                    <td colSpan={colCount} />
                  </tr>
                ) : null}
                {visibleRows.map((row) => (
                  <tr key={row.id} style={{ height: ROW_HEIGHT }} className="border-b border-border last:border-b-0 hover:bg-surface-2/60">
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "max-w-[28rem] truncate px-3 py-0",
                            meta?.numeric && "num text-right",
                            meta?.className,
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {padBottom > 0 ? (
                  <tr aria-hidden style={{ height: padBottom }}>
                    <td colSpan={colCount} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Cartao mobile com o MESMO conjunto de colunas da tabela. */
function DefaultCard<T>({ row }: { row: Row<T> }) {
  const cells = row.getVisibleCells();
  const [first, ...rest] = cells;
  if (!first) return null;
  return (
    <DataListFields
      title={flexRender(first.column.columnDef.cell, first.getContext())}
      fields={rest.map((cell) => {
        const def = cell.column.columnDef;
        const label = def.meta?.mobileLabel ?? (typeof def.header === "string" ? def.header : cell.column.id);
        return { label, value: flexRender(def.cell, cell.getContext()) };
      })}
    />
  );
}
