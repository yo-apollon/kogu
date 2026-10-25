"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/cn";

export interface FilterDef {
  /** Chave do parametro na URL. */
  key: string;
  label: string;
  options: readonly SelectOption[];
}

export interface FilterBarProps {
  /** Chave da busca na URL; `false` oculta o campo. */
  searchKey?: string | false;
  searchPlaceholder?: string;
  filters?: readonly FilterDef[];
  /** Parametros resetados a cada mudanca (paginacao). */
  resetKeys?: readonly string[];
  className?: string;
}

export const SEARCH_DEBOUNCE_MS = 300;
const ALL = "__all__";

/**
 * Barra de filtros com estado na URL (nuqs). A busca tem debounce de 300 ms; cada select vira um
 * chip removivel. Mudar qualquer filtro limpa `resetKeys` (cursor/page).
 */
export function FilterBar({
  searchKey = "q",
  searchPlaceholder,
  filters = [],
  resetKeys = ["cursor", "page"],
  className,
}: FilterBarProps) {
  const t = useTranslations("filter");
  const keyMap = useMemo(() => {
    const map: Record<string, typeof parseAsString> = {};
    if (searchKey) map[searchKey] = parseAsString;
    for (const f of filters) map[f.key] = parseAsString;
    for (const k of resetKeys) map[k] = parseAsString;
    return map;
  }, [searchKey, filters, resetKeys]);
  const [params, setParams] = useQueryStates(keyMap);

  const urlSearch = searchKey ? (params[searchKey] ?? "") : "";
  const [text, setText] = useState(urlSearch);
  const lastPushed = useRef(urlSearch);

  // URL mudou por fora (chip removido, voltar do navegador): sincroniza o campo.
  useEffect(() => {
    if (urlSearch !== lastPushed.current) {
      lastPushed.current = urlSearch;
      setText(urlSearch);
    }
  }, [urlSearch]);

  const resetPatch = useMemo(() => Object.fromEntries(resetKeys.map((k) => [k, null])), [resetKeys]);

  useEffect(() => {
    if (!searchKey || text === lastPushed.current) return;
    const id = setTimeout(() => {
      lastPushed.current = text;
      void setParams({ [searchKey]: text === "" ? null : text, ...resetPatch });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, searchKey, setParams, resetPatch]);

  const active = filters.filter((f) => params[f.key]);

  return (
    <div role="search" aria-label={t("label")} className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {searchKey ? (
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={searchPlaceholder ?? t("searchPlaceholder")}
              aria-label={t("search")}
              className="pl-8"
            />
          </div>
        ) : null}
        {filters.map((f) => (
          <Select
            key={f.key}
            aria-label={f.label}
            className="min-w-32"
            placeholder={f.label}
            value={params[f.key] ?? ALL}
            onValueChange={(v) => void setParams({ [f.key]: v === ALL ? null : v, ...resetPatch })}
            options={[{ value: ALL, label: `${f.label}: ${t("all")}` }, ...f.options]}
          />
        ))}
      </div>
      {active.length > 0 ? (
        <ul aria-label={t("activeFilters")} className="flex list-none flex-wrap items-center gap-1.5 p-0">
          {active.map((f) => {
            const value = params[f.key] ?? "";
            const optionLabel = f.options.find((o) => o.value === value)?.label ?? value;
            const name = `${f.label}: ${optionLabel}`;
            return (
              <li key={f.key}>
                <button
                  type="button"
                  aria-label={t("remove", { name })}
                  onClick={() => void setParams({ [f.key]: null, ...resetPatch })}
                  className="inline-flex h-6 items-center gap-1 rounded-full border border-border-strong bg-surface-2 pr-1.5 pl-2.5 text-xs hover:bg-border"
                >
                  {name}
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => void setParams({ ...Object.fromEntries(filters.map((f) => [f.key, null])), ...resetPatch })}
              className="h-6 rounded-sm px-1.5 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
            >
              {t("clearAll")}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
