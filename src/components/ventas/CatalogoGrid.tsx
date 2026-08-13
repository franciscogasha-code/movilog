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
}: {
  customerPriceListId?: string | null;
  onAdd: (product: ProductRow, quantity: number) => void;
  cartItemIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { clientMode } = useSalesPresentation();
  const [onlyStock, setOnlyStock] = useState(false);

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

  const { data: products, isLoading } = useQuery<CatalogItem[]>({
    queryKey: ["ventas-catalogo", debouncedSearch, onlyStock, category, brand],
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select(
          "id, bims_code, name, description, barcode, category, brand, unit, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock"
        )
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (debouncedSearch.trim()) {
        q = q.or(
          `name.ilike.%${debouncedSearch.trim()}%,bims_code.ilike.%${debouncedSearch.trim()}%,barcode.ilike.%${debouncedSearch.trim()}%`
        );
      }
      if (onlyStock) {
        q = q.gt("total_stock", 0);
      }
      if (category !== "all") {
        q = q.eq("category", category);
      }
      if (brand !== "all") {
        q = q.eq("brand", brand);
      }
      const { data, error } = await q.limit(50);
      if (error) throw error;
      return (data ?? []) as CatalogItem[];
    },
  });

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

      {!isLoading && (products ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No se encontraron productos
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {(products ?? []).map((p) => {
          const stock = resolveStock(p as ProductRow);
          const price = resolvePrice(p as ProductRow, customerPriceListId, 1);
          const inCart = cartItemIds.has(p.id);
          return (
            <Card
              key={p.id}
              className="overflow-hidden flex flex-col cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => onAdd(p as ProductRow, 0)}
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
                {inCart && (
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
