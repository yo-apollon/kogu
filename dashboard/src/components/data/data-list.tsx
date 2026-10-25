import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface DataListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  render: (item: T) => ReactNode;
  "aria-label"?: string;
  className?: string;
}

/** Lista de cartoes: a forma da tabela no mobile. */
export function DataList<T>({ items, getKey, render, className, "aria-label": ariaLabel }: DataListProps<T>) {
  return (
    <ul aria-label={ariaLabel} className={cn("grid list-none gap-2 p-0", className)}>
      {items.map((item, i) => (
        <li key={getKey(item, i)} className="rounded-lg border border-border bg-surface px-3 py-2.5">
          {render(item)}
        </li>
      ))}
    </ul>
  );
}

export interface DataListFieldsProps {
  title: ReactNode;
  fields: ReadonlyArray<{ label: ReactNode; value: ReactNode }>;
}

/** Corpo padrao de um cartao: titulo + pares rotulo/valor em duas colunas. */
export function DataListFields({ title, fields }: DataListFieldsProps) {
  return (
    <div className="grid gap-2">
      <div className="min-w-0 text-base font-medium">{title}</div>
      {fields.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {fields.map((f, i) => (
            <div key={i} className="min-w-0">
              <dt className="text-xs text-subtle">{f.label}</dt>
              <dd className="num truncate text-sm">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
