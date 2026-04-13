import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, MapPin, DollarSign, BarChart3, Check, Zap, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranches } from "@/hooks/use-branches";

import { proxyImageUrl } from "@/lib/image-utils";

function ProductImage({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const safeUrl = url ? proxyImageUrl(url) : null;
  if (safeUrl && !failed) {
    return (
      <img
        src={safeUrl}
        alt={name}
        className="h-20 w-20 rounded-lg object-cover shrink-0 border border-border"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <Package className="h-10 w-10 text-muted-foreground" />
    </div>
  );
}

type StockMode = "select_source" | "select_multi" | "info_only";

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
  /** Currently selected source branch ID – used to highlight */
  selectedSourceBranchId?: string | null;
  /** "select_source" = clickable to pick origin; "select_multi" = multi-select; "info_only" = display only */
  stockMode?: StockMode;
  /** Required quantity – used to show sufficiency indicators */
  requiredQuantity?: number;
  /** Selected branch IDs for select_multi mode */
  selectedBranchIds?: Set<string>;
  /** Toggle branch selection in select_multi mode */
  onToggleBranch?: (branchId: string) => void;
  className?: string;
  compact?: boolean;
  /** Live stock override from BIMS */
  liveStock?: { stock_by_warehouse: Record<string, number>; total_stock: number } | null;
  /** Whether the stock data is from live BIMS */
  isLive?: boolean;
  /** Branch IDs that should be shown but not selectable (e.g. user's own branch) */
  disabledBranchIds?: string[];
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
  selectedSourceBranchId,
  stockMode = "select_source",
  requiredQuantity,
  selectedBranchIds,
  onToggleBranch,
  className,
  compact = false,
  liveStock,
  isLive = false,
  disabledBranchIds,
}: ProductCardProps) {
  // Use live stock if available, otherwise fall back to local
  const effectiveStockByWarehouse = liveStock?.stock_by_warehouse ?? productStockByWarehouse;
  const effectiveTotalStock = liveStock?.total_stock ?? productTotalStock;
  const { data: branches } = useBranches();

  const isValidWarehouseKey = (key: string): boolean => {
    return !!key && key !== "undefined" && key !== "null" && key.trim() !== "";
  };

  const getWarehouseBranchName = (warehouseId: string): string => {
    const branch = branches?.find(b => b.code === warehouseId);
    return branch?.name || `Depósito ${warehouseId}`;
  };

  const getBranchIdByCode = (warehouseId: string): string | null => {
    const branch = branches?.find(b => b.code === warehouseId);
    return branch?.id || null;
  };

  const filteredStockEntries = effectiveStockByWarehouse
    ? Object.entries(effectiveStockByWarehouse).filter(([key]) => isValidWarehouseKey(key))
    : [];
  const hasStock = filteredStockEntries.length > 0;
  const hasPrice = productSellPrice != null && productSellPrice > 0;
  const hasPriceScales = productPriceScales && productPriceScales.length > 0;
  const isSelectMode = stockMode === "select_source" && !!onSelectSourceBranch;
  const isMultiSelectMode = stockMode === "select_multi" && !!onToggleBranch;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-3 p-3 rounded-lg border border-border bg-card", className)}>
        {productImageUrl ? (
          <img src={proxyImageUrl(productImageUrl)} alt={productName} className="h-10 w-10 rounded object-cover shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
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
        {effectiveTotalStock != null && (
          <Badge variant={effectiveTotalStock > 0 ? "default" : "destructive"} className="text-xs shrink-0">
            Stock: {Math.floor(effectiveTotalStock)}
          </Badge>
        )}
        {productUnit && <span className="text-xs text-muted-foreground shrink-0">{productUnit}</span>}
      </div>
    );
  }

  return (
    <Card className={cn("overflow-hidden max-w-full", className)}>
      <CardContent className="p-4 space-y-4 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex gap-4">
          <ProductImage url={productImageUrl} name={productName} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <h3 className="font-semibold text-base leading-tight break-words min-w-0">{productName}</h3>
              {effectiveTotalStock != null && (
                <Badge variant={effectiveTotalStock > 0 ? "default" : "destructive"} className="text-xs shrink-0">
                  Stock: {Math.floor(effectiveTotalStock)}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5 min-w-0">
              {productSku && <Badge variant="outline" className="text-xs font-mono truncate max-w-full">SKU: {productSku}</Badge>}
              {productBimsCode && <Badge variant="outline" className="text-xs font-mono truncate max-w-full">Cód: {productBimsCode}</Badge>}
              {productBarcode && <Badge variant="outline" className="text-xs font-mono truncate max-w-full">CB: {productBarcode}</Badge>}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap min-w-0">
              {productCategory && <span className="text-xs text-muted-foreground">{productCategory}</span>}
              {productUnit && <span className="text-xs text-muted-foreground">• Unidad: {productUnit}</span>}
              {hasPrice && <span className="text-xs font-medium text-foreground">• ₲{productSellPrice!.toLocaleString()}</span>}
            </div>
          </div>
        </div>

        {/* Description */}
        {productDescription && (
         <div className="p-3 rounded-lg bg-muted/30 border border-border/30 min-w-0 overflow-hidden">
            <p className="text-xs text-muted-foreground whitespace-pre-line break-words">{productDescription}</p>
          </div>
        )}

        {/* Prices – base + 6 & 12 unit scales only */}
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
            {hasPriceScales && (() => {
              const relevant = productPriceScales!.filter(s => s.min_quantity === 6 || s.min_quantity === 12);
              return relevant.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {relevant
                    .sort((a, b) => a.min_quantity - b.min_quantity)
                    .map((scale, i) => (
                      <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs bg-muted/50">
                        <span>≥ {scale.min_quantity} un.</span>
                        <span className="font-medium">₲{scale.price.toLocaleString()}</span>
                      </div>
                    ))}
                </div>
              ) : null;
            })()}
          </div>
        )}

        {/* Stock by warehouse */}
        {hasStock && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5 flex-wrap min-w-0">
              <BarChart3 className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{isSelectMode ? "Seleccionar sucursal origen" : isMultiSelectMode ? "Stock disponible — click para seleccionar" : "Stock disponible por sucursal"}</span>
              {isLive ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600 ml-1">
                  <Zap className="h-3 w-3" /> En vivo
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground ml-1">
                  <Clock className="h-3 w-3" /> Sincronizado
                </span>
              )}
              {effectiveTotalStock != null && (
                <Badge variant={effectiveTotalStock > 0 ? "default" : "destructive"} className="text-xs ml-auto">
                  Total: {Math.floor(effectiveTotalStock)}
                </Badge>
              )}
            </h4>
            <div className="grid grid-cols-2 gap-1.5">
              {filteredStockEntries
                .filter(([, qty]) => qty > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([whId, qty]) => {
                  const branchId = getBranchIdByCode(whId);
                  const isDisabled = !!(branchId && disabledBranchIds?.includes(branchId));
                  const isSelected = isDisabled ? false : isMultiSelectMode
                    ? !!(branchId && selectedBranchIds?.has(branchId))
                    : branchId === selectedSourceBranchId;
                  const isSufficient = requiredQuantity ? qty >= requiredQuantity : null;
                  const isClickable = !isDisabled && ((isSelectMode && !!branchId) || (isMultiSelectMode && !!branchId));

                  return (
                    <button
                      key={whId}
                      type="button"
                      onClick={() => {
                        if (isDisabled) return;
                        if (isMultiSelectMode && branchId) onToggleBranch!(branchId);
                        else if (isSelectMode && branchId) onSelectSourceBranch!(branchId);
                      }}
                      disabled={!isClickable}
                      title={isDisabled ? "No puedes seleccionar tu propia sucursal como origen" : undefined}
                      className={cn(
                        "flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-left transition-colors",
                        isDisabled
                          ? "bg-muted/30 opacity-50 cursor-not-allowed"
                          : isSelected
                            ? "bg-primary/10 border border-primary/30 ring-1 ring-primary/20"
                            : isClickable
                              ? "bg-muted/50 hover:bg-accent/10 cursor-pointer"
                              : "bg-muted/30 cursor-default"
                      )}
                    >
                      <span className="font-medium truncate flex items-center gap-1">
                        {isSelected && <Check className="h-3 w-3 text-primary shrink-0" />}
                        {getWarehouseBranchName(whId)}
                      </span>
                      <span className="flex items-center gap-1.5 ml-2 shrink-0">
                        {isSufficient !== null && (
                          <span className={cn("text-[10px]", isSufficient ? "text-green-600" : "text-amber-500")}>
                            {isSufficient ? "suficiente" : "insuficiente"}
                          </span>
                        )}
                        <Badge variant={qty > 0 ? "default" : "secondary"} className="text-xs">
                          {Math.floor(qty)}
                        </Badge>
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* No stock fallback for select mode */}
        {!hasStock && isSelectMode && branches && branches.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Seleccionar sucursal origen para este producto
            </h4>
            <p className="text-xs text-muted-foreground mb-2">
              Stock no disponible. Seleccioná una sucursal basándote en conocimiento operativo.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
            {branches.map((b) => {
                const isDisabled = disabledBranchIds?.includes(b.id);
                const isSelected = isDisabled ? false : b.id === selectedSourceBranchId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => { if (!isDisabled) onSelectSourceBranch!(b.id); }}
                    disabled={!!isDisabled}
                    title={isDisabled ? "No puedes seleccionar tu propia sucursal como origen" : undefined}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors text-left",
                      isDisabled
                        ? "bg-muted/30 opacity-50 cursor-not-allowed"
                        : isSelected
                          ? "bg-primary/10 border border-primary/30 ring-1 ring-primary/20"
                          : "bg-muted/50 hover:bg-accent/10"
                    )}
                  >
                    <span className="font-medium flex items-center gap-1">
                      {isSelected && <Check className="h-3 w-3 text-primary" />}
                      {b.name}
                    </span>
                    <span className="text-muted-foreground">{b.code}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* No stock + info only */}
        {!hasStock && stockMode === "info_only" && (
          <p className="text-xs text-muted-foreground italic">Stock no disponible para este producto.</p>
        )}
      </CardContent>
    </Card>
  );
}
