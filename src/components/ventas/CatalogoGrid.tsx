import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, ImageOff, X, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolvePrice, resolveStock, formatGs, ProductRow } from "@/lib/ventas";
import { useDebounce } from "@/hooks/use-debounce";
import { proxyImageUrl } from "@/lib/image-utils";
import { AvailabilityChip } from "@/components/ventas/AvailabilityChip";
import { useSalesPresentation } from "@/contexts/SalesPresentationContext";


type CatalogItem = {
  id: string;
  bims_code: string;
  name: string;
  description: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  image_url: string | null;
  sell_price: number | null;
  price_scales: unknown;
  price_lists: unknown;
  stock_by_warehouse: unknown;
  total_stock: number | null;
};

export function CatalogoGrid({
  customerPriceListId,
  onAdd,
  cartItemIds,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onSelectManyIds,
  onClearSelection,
  onGeneratePdf,
}: {
  customerPriceListId?: string | null;
  onAdd: (product: ProductRow, quantity: number) => void;
  cartItemIds: Set<string>;
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectManyIds?: (ids: string[]) => void;
  onClearSelection?: () => void;
  onGeneratePdf?: () => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { clientMode } = useSalesPresentation();
  const [onlyStock, setOnlyStock] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllDone, setSelectAllDone] = useState(0);

  const [category, setCategory] = useState<string>("all");
  const [brand, setBrand] = useState<string>("all");
  const [brandOpen, setBrandOpen] = useState(false);

  const { data: facets } = useQuery({
    queryKey: ["ventas-catalogo-facets"],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_catalog_facets");
      if (error) throw error;
      const rows = (data ?? []) as { kind: string; value: string; total: number }[];
      const sortByName = (a: { value: string }, b: { value: string }) =>
        a.value.localeCompare(b.value, "es");
      return {
        categories: rows.filter((r) => r.kind === "category").sort(sortByName),
        brands: rows.filter((r) => r.kind === "brand").sort(sortByName),
      };
    },
  });

  const PAGE_SIZE = 48;
  const SELECT_ALL_BATCH = 1000;
  const sel = (s: string): string => s;

  /** Aplica los filtros activos sobre un query builder de `products`. */
  const applyFilters = (q: any) => {
    let out = q.eq("is_active", true);
    if (debouncedSearch.trim()) {
      const term = debouncedSearch.trim();
      out = out.or(`name.ilike.%${term}%,bims_code.ilike.%${term}%,barcode.ilike.%${term}%`);
    }
    if (onlyStock) out = out.gt("total_stock", 0);
    if (category !== "all") out = out.eq("category", category);
    if (brand !== "all") out = out.eq("brand", brand);
    return out;
  };

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["ventas-catalogo", debouncedSearch, onlyStock, category, brand],
    initialPageParam: 0,
    getNextPageParam: (lastPage: { rows: CatalogItem[]; count: number }, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + p.rows.length, 0);
      return loaded < lastPage.count ? loaded : undefined;
    },
    queryFn: async ({ pageParam }) => {
      const from = pageParam as number;
      const q = applyFilters(
        supabase
          .from("products")
          .select(
            sel(
              "id, bims_code, name, description, barcode, category, brand, unit, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock"
            ),
            { count: "exact" }
          )
      ).order("name", { ascending: true });

      const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as CatalogItem[], count: count ?? 0 };
    },
  });


  const products = useMemo<CatalogItem[]>(
    () => (data?.pages ?? []).flatMap((p) => p.rows),
    [data]
  );
  const totalCount = data?.pages?.[0]?.count ?? 0;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  /** Trae TODOS los ids del filtro, paginando de a 1.000. */
  const selectAllFiltered = async () => {
    if (!onSelectManyIds) return;
    setSelectingAll(true);
    setSelectAllDone(0);
    try {
      const ids: string[] = [];
      for (let from = 0; ; from += SELECT_ALL_BATCH) {
        const { data, error } = await applyFilters(supabase.from("products").select("id"))
          .order("name", { ascending: true })
          .range(from, from + SELECT_ALL_BATCH - 1);
        if (error) throw error;
        const batch = ((data ?? []) as { id: string }[]).map((r) => r.id);
        ids.push(...batch);
        setSelectAllDone(ids.length);
        if (batch.length < SELECT_ALL_BATCH) break;
      }
      onSelectManyIds(ids);
    } finally {
      setSelectingAll(false);
      setSelectAllDone(0);
    }
  };

  const selectedCount = selectedIds?.size ?? 0;

  return (

    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={onlyStock ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyStock(!onlyStock)}
        >
          Con stock
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="flex-1 min-w-0">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="all">Todas las categorías</SelectItem>
            {(facets?.categories ?? []).map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover open={brandOpen} onOpenChange={setBrandOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              className="flex-1 min-w-0 justify-between font-normal"
            >
              <span className="truncate">
                {brand === "all" ? "Marca" : brand}
              </span>
              <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[260px]" align="start">
            <Command>
              <CommandInput placeholder="Buscar marca..." />
              <CommandList className="max-h-72">
                <CommandEmpty>Sin resultados</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="Todas las marcas"
                    onSelect={() => {
                      setBrand("all");
                      setBrandOpen(false);
                    }}
                  >
                    Todas las marcas
                  </CommandItem>
                  {(facets?.brands ?? []).map((b) => (
                    <CommandItem
                      key={b.value}
                      value={b.value}
                      onSelect={() => {
                        setBrand(b.value);
                        setBrandOpen(false);
                      }}
                    >
                      <span className="truncate">{b.value}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {Number(b.total).toLocaleString("de-DE")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {(category !== "all" || brand !== "all") && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => {
              setCategory("all");
              setBrand("all");
            }}
            aria-label="Limpiar filtros"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground text-center py-8">Cargando...</p>
      )}

      {!isLoading && products.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No se encontraron productos
        </p>
      )}

      {!isLoading && products.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Mostrando {products.length.toLocaleString("de-DE")} de{" "}
            {totalCount.toLocaleString("de-DE")} productos
          </p>
          {selectionMode && onSelectManyIds && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectingAll}
              onClick={selectAllFiltered}
            >
              {selectingAll
                ? `Seleccionando ${selectAllDone.toLocaleString("de-DE")} de ${totalCount.toLocaleString("de-DE")}...`
                : `Seleccionar todo el filtro (${totalCount.toLocaleString("de-DE")})`}
            </Button>
          )}
        </div>
      )}


      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {products.map((p) => {
          const stock = resolveStock(p as ProductRow);
          const price = resolvePrice(p as ProductRow, customerPriceListId, 1);
          const inCart = cartItemIds.has(p.id);
          const isSelected = selectedIds?.has(p.id) ?? false;
          return (
            <Card
              key={p.id}
              className={`overflow-hidden flex flex-col cursor-pointer transition-colors ${
                selectionMode && isSelected
                  ? "border-primary ring-2 ring-primary/30"
                  : "hover:border-primary/50"
              }`}
              onClick={() =>
                selectionMode ? onToggleSelect?.(p.id) : onAdd(p as ProductRow, 0)
              }
            >
              <div className="aspect-square bg-muted flex items-center justify-center relative">
                {p.image_url ? (
                  <img
                    src={proxyImageUrl(p.image_url)}
                    alt={p.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <ImageOff className="h-8 w-8 text-muted-foreground" />
                )}
                {selectionMode && (
                  <span
                    className={`absolute top-2 left-2 h-6 w-6 rounded-md border-2 flex items-center justify-center ${
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-background/90 border-muted-foreground/40"
                    }`}
                    aria-hidden
                  >
                    {isSelected && <Check className="h-4 w-4" />}
                  </span>
                )}
                {inCart && !selectionMode && (
                  <Badge className="absolute top-2 right-2 gap-1" variant="secondary" aria-label="Producto en carrito">
                    <Check className="h-3 w-3" />
                    En carrito
                  </Badge>
                )}
              </div>
              <CardContent className="p-3 flex flex-col flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {[p.brand, p.category].filter(Boolean).join(" · ") || "Sin categoría"}
                </p>
                <p className="text-sm font-medium line-clamp-2 flex-1">{p.name}</p>
                {!clientMode && (
                  <p className="text-xs text-muted-foreground mt-1">Código: {p.bims_code}</p>
                )}
                <div className="flex items-center justify-between gap-1 mt-2">
                  <span className="text-sm font-bold text-primary">{formatGs(price)}</span>
                  {clientMode ? (
                    <AvailabilityChip stock={stock} size="sm" />
                  ) : (
                    <span className={`text-xs ${stock > 0 ? "text-green-600" : "text-destructive"}`}>
                      Stock {stock.toLocaleString("de-DE")}
                    </span>
                  )}
                </div>

                {selectionMode ? (
                  <Button
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    className="w-full mt-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect?.(p.id);
                    }}
                  >
                    {isSelected ? "Quitar del catálogo" : "Agregar al catálogo"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full mt-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(p as ProductRow, 1);
                    }}
                    disabled={stock <= 0}
                  >
                    {stock > 0 ? "Agregar" : "Sin stock"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-1" />

      {isFetchingNextPage && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !hasNextPage && products.length > 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          No hay más productos
        </p>
      )}

      {selectionMode && (
        <>
          <div className="h-20" />
          <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                {selectedCount.toLocaleString("de-DE")} seleccionados
              </p>
              {selectedCount > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => onClearSelection?.()}
                >
                  Limpiar selección
                </button>
              )}
            </div>
            <Button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => onGeneratePdf?.()}
            >
              Generar PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
