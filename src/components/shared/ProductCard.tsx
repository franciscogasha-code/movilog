import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, MapPin, ShoppingCart, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  productId: string;
  productName: string;
  productSku?: string | null;
  productBimsCode?: string | null;
  productCategory?: string | null;
  productUnit?: string | null;
  onAddToOrder?: () => void;
  onAddToConsultation?: () => void;
  onSelectSourceBranch?: (branchId: string) => void;
  className?: string;
  compact?: boolean;
}

type StockByBranch = {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  quantity: number;
};

export function ProductCard({
  productId,
  productName,
  productSku,
  productBimsCode,
  productCategory,
  productUnit,
  onAddToOrder,
  onAddToConsultation,
  onSelectSourceBranch,
  className,
  compact = false,
}: ProductCardProps) {
  // Fetch BIMS stock data per warehouse via the proxy
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["product-stock-bims", productBimsCode],
    queryFn: async () => {
      if (!productBimsCode) return [];

      // Get all branches to map warehouse codes to names
      const { data: branches } = await supabase
        .from("branches")
        .select("id, name, code")
        .eq("is_active", true);

      if (!branches?.length) return [];

      // Fetch stock from each warehouse via BIMS
      const stockResults: StockByBranch[] = [];

      for (const branch of branches) {
        try {
          const { data: stockRes } = await supabase.functions.invoke("bims-proxy", {
            body: null,
            headers: { "Content-Type": "application/json" },
          });
          // For now, we don't have per-warehouse stock from BIMS easily
          // We'll show branches as available sources
        } catch {
          // Skip on error
        }
      }

      return branches.map(b => ({
        branch_id: b.id,
        branch_name: b.name,
        branch_code: b.code,
        quantity: -1, // Unknown - BIMS stock query needs warehouse_id mapping
      }));
    },
    enabled: !!productBimsCode,
    staleTime: 60_000,
  });

  // Get branches for stock display (local data)
  const { data: branches } = useQuery({
    queryKey: ["branches-for-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border border-border bg-card", className)}>
        <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
          <Package className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{productName}</p>
          <p className="text-xs text-muted-foreground">
            {productSku && <span>SKU: {productSku}</span>}
            {productBimsCode && <span className="ml-1">• Cód: {productBimsCode}</span>}
          </p>
        </div>
        {productCategory && <Badge variant="outline" className="text-xs shrink-0">{productCategory}</Badge>}
        {productUnit && <span className="text-xs text-muted-foreground shrink-0">{productUnit}</span>}
      </div>
    );
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex gap-4">
          <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Package className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-tight">{productName}</h3>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {productSku && (
                <Badge variant="outline" className="text-xs font-mono">SKU: {productSku}</Badge>
              )}
              {productBimsCode && (
                <Badge variant="outline" className="text-xs font-mono">Cód: {productBimsCode}</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {productCategory && (
                <span className="text-xs text-muted-foreground">{productCategory}</span>
              )}
              {productUnit && (
                <span className="text-xs text-muted-foreground">• Unidad: {productUnit}</span>
              )}
            </div>
          </div>
        </div>

        {/* Stock por sucursal */}
        <div>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Disponibilidad por sucursal
          </h4>
          {branches && branches.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectSourceBranch?.(b.id)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs bg-muted/50 hover:bg-accent/10 transition-colors text-left"
                >
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground">{b.code}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Cargando sucursales...</p>
          )}
        </div>

        {/* Actions */}
        {(onAddToOrder || onAddToConsultation) && (
          <div className="flex gap-2 pt-1">
            {onAddToOrder && (
              <Button type="button" size="sm" className="flex-1 gap-1.5" onClick={onAddToOrder}>
                <ShoppingCart className="h-3.5 w-3.5" /> Agregar a pedido
              </Button>
            )}
            {onAddToConsultation && (
              <Button type="button" variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onAddToConsultation}>
                <Search className="h-3.5 w-3.5" /> Consultar disponibilidad
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
