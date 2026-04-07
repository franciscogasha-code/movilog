import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, MapPin, DollarSign, BarChart3, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranches } from "@/hooks/use-branches";

interface ProductCardProps {
  productId: string;
  productName: string;
  productSku?: string | null;
  productBimsCode?: string | null;
  productBarcode?: string | null;
  productCategory?: string | null;
  productUnit?: string | null;
  productDescription?: string | null;
  productImageUrl?: string | null;
  productSellPrice?: number | null;
  productPriceScales?: { min_quantity: number; price: number }[];
  productPriceLists?: { name: string; amount: number }[];
  productStockByWarehouse?: Record<string, number>;
  productTotalStock?: number | null;
  onSelectSourceBranch?: (branchId: string) => void;
  className?: string;
  compact?: boolean;
}

export function ProductCard({
  productId,
  productName,
  productSku,
  productBimsCode,
  productBarcode,
  productCategory,
  productUnit,
  productDescription,
  productImageUrl,
  productSellPrice,
  productPriceScales,
  productPriceLists,
  productStockByWarehouse,
  productTotalStock,
  onSelectSourceBranch,
  className,
  compact = false,
}: ProductCardProps) {
  const { data: branches } = useBranches();

  // Map BIMS warehouse IDs to SLIS branch names
  const getWarehouseBranchName = (warehouseId: string): string => {
    const branch = branches?.find(b => b.code === warehouseId);
    return branch?.name || `Depósito ${warehouseId}`;
  };

  const getBranchIdByCode = (warehouseId: string): string | null => {
    const branch = branches?.find(b => b.code === warehouseId);
    return branch?.id || null;
  };

  const hasStock = productStockByWarehouse && Object.keys(productStockByWarehouse).length > 0;
  const hasPrice = productSellPrice != null && productSellPrice > 0;
  const hasPriceScales = productPriceScales && productPriceScales.length > 0;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border border-border bg-card", className)}>
        {productImageUrl ? (
          <img src={productImageUrl} alt={productName} className="h-10 w-10 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
            <Package className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{productName}</p>
          <p className="text-xs text-muted-foreground">
            {productSku && <span>SKU: {productSku}</span>}
            {productBimsCode && <span className="ml-1">• Cód: {productBimsCode}</span>}
            {hasPrice && <span className="ml-1">• ₲{productSellPrice!.toLocaleString()}</span>}
          </p>
        </div>
        {productTotalStock != null && (
          <Badge variant={productTotalStock > 0 ? "default" : "destructive"} className="text-xs shrink-0">
            Stock: {Math.floor(productTotalStock)}
          </Badge>
        )}
        {productUnit && <span className="text-xs text-muted-foreground shrink-0">{productUnit}</span>}
      </div>
    );
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex gap-4">
          {productImageUrl ? (
            <img
              src={productImageUrl}
              alt={productName}
              className="h-20 w-20 rounded-lg object-cover shrink-0 border border-border"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div className={cn("h-20 w-20 rounded-lg bg-muted flex items-center justify-center shrink-0", productImageUrl && "hidden")}>
            <Package className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-tight">{productName}</h3>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {productSku && <Badge variant="outline" className="text-xs font-mono">SKU: {productSku}</Badge>}
              {productBimsCode && <Badge variant="outline" className="text-xs font-mono">Cód: {productBimsCode}</Badge>}
              {productBarcode && <Badge variant="outline" className="text-xs font-mono">CB: {productBarcode}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              {productCategory && <span className="text-xs text-muted-foreground">{productCategory}</span>}
              {productUnit && <span className="text-xs text-muted-foreground">• Unidad: {productUnit}</span>}
            </div>
          </div>
        </div>

        {/* Description */}
        {productDescription && (
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
            <p className="text-xs text-muted-foreground whitespace-pre-line">{productDescription}</p>
          </div>
        )}

        {/* Prices */}
        {(hasPrice || hasPriceScales) && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> Precios
            </h4>
            {hasPrice && (
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-foreground">₲{productSellPrice!.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">precio base</span>
              </div>
            )}
            {hasPriceScales && (
              <div className="grid grid-cols-2 gap-1.5">
                {productPriceScales!.map((scale, i) => (
                  <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs bg-muted/50">
                    <span>≥ {scale.min_quantity} un.</span>
                    <span className="font-medium">₲{scale.price.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
            {productPriceLists && productPriceLists.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {productPriceLists.map((pl, i) => (
                  <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs bg-accent/5 border border-border/30">
                    <span className="text-muted-foreground">{pl.name}</span>
                    <span className="font-medium">₲{pl.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stock by warehouse */}
        {hasStock && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Stock por sucursal
              {productTotalStock != null && (
                <Badge variant={productTotalStock > 0 ? "default" : "destructive"} className="text-xs ml-auto">
                  Total: {Math.floor(productTotalStock)}
                </Badge>
              )}
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(productStockByWarehouse!)
                .filter(([, qty]) => qty > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([whId, qty]) => {
                  const branchId = getBranchIdByCode(whId);
                  return (
                    <button
                      key={whId}
                      type="button"
                      onClick={() => branchId && onSelectSourceBranch?.(branchId)}
                      disabled={!branchId || !onSelectSourceBranch}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-left",
                        branchId && onSelectSourceBranch
                          ? "bg-muted/50 hover:bg-accent/10 transition-colors cursor-pointer"
                          : "bg-muted/30 cursor-default"
                      )}
                    >
                      <span className="font-medium truncate">{getWarehouseBranchName(whId)}</span>
                      <Badge variant={qty > 0 ? "default" : "secondary"} className="text-xs ml-2 shrink-0">
                        {Math.floor(qty)}
                      </Badge>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Branch selector fallback when no stock data */}
        {!hasStock && onSelectSourceBranch && branches && branches.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Seleccionar sucursal origen
            </h4>
            <p className="text-xs text-muted-foreground mb-2">
              Stock no disponible para este producto. Seleccioná una sucursal basándote en conocimiento operativo.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectSourceBranch(b.id)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs bg-muted/50 hover:bg-accent/10 transition-colors text-left"
                >
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted-foreground">{b.code}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
