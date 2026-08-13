import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, ImageOff } from "lucide-react";
import { resolvePrice, resolveStock, formatGs, ProductRow } from "@/lib/ventas";
import { useDebounce } from "@/hooks/use-debounce";

type CatalogItem = {
  id: string;
  bims_code: string;
  name: string;
  category: string | null;
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
  const [onlyStock, setOnlyStock] = useState(false);

  const { data: products, isLoading } = useQuery<CatalogItem[]>({
    queryKey: ["ventas-catalogo", debouncedSearch, onlyStock],
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select(
          "id, bims_code, name, category, unit, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock"
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
                    src={p.image_url}
                    alt={p.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <ImageOff className="h-8 w-8 text-muted-foreground" />
                )}
                {inCart && (
                  <Badge className="absolute top-2 right-2" variant="default">
                    <ShoppingCart className="h-3 w-3 mr-1" />
                    En carrito
                  </Badge>
                )}
              </div>
              <CardContent className="p-3 flex flex-col flex-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  {p.category ?? "Sin categoría"}
                </p>
                <p className="text-sm font-medium line-clamp-2 flex-1">{p.name}</p>
                <p className="text-xs text-muted-foreground mt-1">Código: {p.bims_code}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold text-primary">{formatGs(price)}</span>
                  <span className={`text-xs ${stock > 0 ? "text-green-600" : "text-destructive"}`}>
                    Stock {stock.toLocaleString("de-DE")}
                  </span>
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
