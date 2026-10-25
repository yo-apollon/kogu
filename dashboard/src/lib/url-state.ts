/**
 * Parsers tipados (nuqs) para estado de lista na URL. Importados de `nuqs/server` para funcionarem
 * tanto em componentes cliente (useQueryStates) quanto em Server Components (createSearchParamsCache).
 */
import type { SortingState } from "@tanstack/react-table";
import { createParser, parseAsInteger, parseAsString } from "nuqs/server";

export interface SortParam {
  id: string;
  desc: boolean;
}

/** `?sort=aether.desc` / `?sort=name.asc`. */
export const parseAsSort = createParser<SortParam>({
  parse(value) {
    const [id, dir] = value.split(".");
    if (!id || !/^[a-zA-Z0-9_]+$/.test(id)) return null;
    return { id, desc: dir === "desc" };
  },
  serialize: (v) => `${v.id}.${v.desc ? "desc" : "asc"}`,
  eq: (a, b) => a.id === b.id && a.desc === b.desc,
});

/** Parametros comuns de listas: busca, cursor opaco, pagina numerica e ordenacao. */
export const listParams = {
  q: parseAsString.withDefault("").withOptions({ clearOnDefault: true }),
  cursor: parseAsString,
  page: parseAsInteger.withDefault(1).withOptions({ clearOnDefault: true }),
  sort: parseAsSort,
};

export function sortParamToState(sort: SortParam | null | undefined): SortingState {
  return sort ? [{ id: sort.id, desc: sort.desc }] : [];
}

export function sortStateToParam(state: SortingState): SortParam | null {
  const first = state[0];
  return first ? { id: first.id, desc: first.desc } : null;
}

export { parseAsInteger, parseAsString };
