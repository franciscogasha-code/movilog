import { useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  isFetching?: boolean;
  /** Clase opcional para el contenedor */
  className?: string;
  /** Etiqueta de la unidad ("pedidos", "viajes"...). Default: "registros". */
  itemLabel?: string;
}

/**
 * Barra de paginación estándar MoviLog.
 *
 * Muestra:
 *  - "Mostrando X–Y de Z {itemLabel}"
 *  - Anterior / páginas (con elipsis si > 7) / Siguiente
 *  - Estado vacío
 *  - "Fin de lista" cuando se está en la última página
 */
export function PaginationBar({
  page,
  pageSize: _pageSize,
  total,
  totalPages,
  from,
  to,
  onPageChange,
  isFetching,
  className,
  itemLabel = "registros",
}: PaginationBarProps) {
  const pages = useMemo(() => buildPageList(page, totalPages), [page, totalPages]);
  const isLast = page >= totalPages;
  const isFirst = page <= 1;

  // Caso vacío (después de hooks, no antes)
  if (total === 0) {
    return (
      <div className={cn("flex items-center justify-center py-3 text-xs text-muted-foreground", className)}>
        Sin {itemLabel} para mostrar
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-2 border-t border-border/50 text-xs",
        className,
      )}
    >
      <span className="text-muted-foreground">
        Mostrando <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> de{" "}
        <span className="font-medium text-foreground">{total}</span> {itemLabel}
        {isFetching && <span className="ml-2 opacity-60">actualizando…</span>}
      </span>

      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              disabled={isFirst || isFetching}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
          </PaginationItem>

          {pages.map((p, idx) =>
            p === "ellipsis" ? (
              <PaginationItem key={`e-${idx}`}>
                <PaginationEllipsis className="h-7 w-7" />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  isActive={p === page}
                  size="sm"
                  className="h-7 w-7 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!isFetching) onPageChange(p);
                  }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}

          <PaginationItem>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1"
              disabled={isLast || isFetching}
              onClick={() => onPageChange(page + 1)}
            >
              Siguiente
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>

      {isLast && totalPages > 1 && (
        <span className="text-muted-foreground italic hidden sm:inline">Fin de lista</span>
      )}
    </div>
  );
}

/**
 * Construye lista de páginas con elipsis: [1, "ellipsis", 4, 5, 6, "ellipsis", 12]
 */
function buildPageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) pages.push("ellipsis");
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}
