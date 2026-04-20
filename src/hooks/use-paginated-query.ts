import { useState, useMemo, useEffect } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";

/** Builder mínimo de Supabase que necesita el hook (evita dep externa). */
type SupabaseRangeBuilder<TRow> = {
  range: (from: number, to: number) => Promise<{
    data: TRow[] | null;
    error: any;
    count: number | null;
  }> & SupabaseRangeBuilder<TRow>;
};

/**
 * Hook estándar de paginación server-side para MoviLog.
 *
 * Aplica `.range(from, to)` y `count: 'exact'` automáticamente sobre el
 * builder de Supabase devuelto por `buildQuery`. Devuelve filas + total real
 * para que la barra de paginación pueda mostrar "Mostrando X–Y de Z".
 *
 * Reglas:
 *  - El consumidor sólo construye filtros/orden, NO toca `.range` ni `.limit`.
 *  - Cualquier cambio en el `queryKey` resetea la página a 1 (vía effect).
 *  - `pageSize` por defecto: 25 (estándar listados administrativos).
 */
export interface PaginatedQueryOptions<TRow, TMapped = TRow> {
  /** Clave de cache; cualquier cambio dispara reset de página. */
  queryKey: QueryKey;
  /**
   * Constructor del query Supabase. Debe devolver un PostgrestFilterBuilder
   * SIN `.range()` ni `.limit()` aplicados (los aplica el hook).
   * Sí puede aplicar `.select(..., { count: 'exact' })` o lo agrega el hook.
   */
  buildQuery: () => SupabaseRangeBuilder<TRow> | any;
  /** Mapeo opcional de filas crudas al modelo final consumido por la UI. */
  mapRow?: (row: TRow) => TMapped;
  /** Tamaño de página inicial (default 25). */
  initialPageSize?: number;
  /** Habilita/deshabilita la query (igual a useQuery.enabled). */
  enabled?: boolean;
}

export interface PaginatedQueryResult<TMapped> {
  rows: TMapped[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  from: number; // índice 1-based del primer registro mostrado
  to: number;   // índice 1-based del último registro mostrado
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  refetch: () => void;
}

export function usePaginatedQuery<TRow, TMapped = TRow>(
  opts: PaginatedQueryOptions<TRow, TMapped>,
): PaginatedQueryResult<TMapped> {
  const { queryKey, buildQuery, mapRow, initialPageSize = 25, enabled = true } = opts;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Reset de página al cambiar filtros/queryKey
  const keyHash = useMemo(() => JSON.stringify(queryKey), [queryKey]);
  useEffect(() => {
    setPage(1);
  }, [keyHash, pageSize]);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const query = useQuery({
    queryKey: [...queryKey, "__page", page, "__size", pageSize],
    enabled,
    queryFn: async () => {
      const q = buildQuery().range(from, to);
      const { data, error, count } = await q;
      if (error) throw error;
      return { data: (data ?? []) as TRow[], count: count ?? 0 };
    },
  });

  const rows = useMemo(() => {
    const raw = query.data?.data ?? [];
    return mapRow ? raw.map(mapRow) : (raw as unknown as TMapped[]);
  }, [query.data, mapRow]);

  const total = query.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayFrom = total === 0 ? 0 : from + 1;
  const displayTo = Math.min(to + 1, total);

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    from: displayFrom,
    to: displayTo,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    setPage: (p: number) => setPage(Math.max(1, Math.min(p, totalPages))),
    setPageSize,
    refetch: query.refetch,
  };
}
