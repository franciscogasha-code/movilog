import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, MapPin, BarChart3, Check, Zap, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranches } from "@/hooks/use-branches";
import { proxyImageUrl } from "@/lib/image-utils";

/* ── Product Image ───────────────────────────────────────────── */
function ProductImage({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const safeUrl = url ? proxyImageUrl(url) : null;
  if (safeUrl && !failed) {
    return (
      <img
        src={safeUrl}
        alt={name}
        className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg object-cover shrink-0 border border-border"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg bg-muted flex items-center justify-center shrink-0">
      <Package className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground" />
    </div>
  );
}

/* ── Types ────────────────────────────────────────────────────── */
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
  selectedSourceBranchId?: string | null;
  stockMode?: StockMode;
  requiredQuantity?: number;
  selectedBranchIds?: Set<string>;
  onToggleBranch?: (branchId: string) => void;
  className?: string;
  compact?: boolean;
  liveStock?: { stock_by_warehouse: Record<string, number>; total_stock: number } | null;
  isLive?: boolean;
  disabledBranchIds?: string[];
}

/* ── Compact variant ─────────────────────────────────────────── */
function CompactProductCard({
  productName,
  productSku,
  productBimsCode,
  productImageUrl,
  productSellPrice,
  productUnit,
  effectiveTotalStock,
  className,
}: {
  productName: string;
  productSku?: string | null;
  productBimsCode?: string | null;
  productImageUrl?: string | null;
  productSellPrice?: number | null;
  productUnit?: string | null;
  effectiveTotalStock?: number | null;
  className?: string;
}) {
  const hasPrice = productSellPrice != null && productSellPrice > 0;
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
          {hasPrice && <span className="ml-1">• ₲{productSellPrice!.toLocaleString("de-DE")}</span>}
        </p>
      </div>
      {effectiveTotalStock != null && (
        <Badge variant={effectiveTotalStock > 0 ? "default" : "destructive"} className="text-xs shrink-0">
          Stock: {Math.floor(effectiveTotalStock).toLocaleString("de-DE")}
        </Badge>
      )}
      {productUnit && <span className="text-xs text-muted-foreground shrink-0">{productUnit}</span>}
    </div>
  );
}

/* ── Stock warehouse button ──────────────────────────────────── */
function StockWarehouseButton({
  whId,
  qty,
  branchName,
  isSelected,
  isDisabled,
  isClickable,
  isSufficient,
  onClick,
}: {
  whId: string;
  qty: number;
  branchName: string;
  isSelected: boolean;
  isDisabled: boolean;
  isClickable: boolean;
  isSufficient: boolean | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isClickable}
      title={isDisabled ? "No puedes seleccionar tu propia sucursal como origen" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-2 px-2.5 py-2 sm:px-3 rounded-md text-xs text-left transition-colors min-h-[36px]",
        isDisabled
          ? "bg-muted/30 opacity-50 cursor-not-allowed"
          : isSelected
            ? "bg-primary/10 border border-primary/30 ring-1 ring-primary/20"
            : isClickable
              ? "bg-muted/50 hover:bg-accent/10 cursor-pointer border border-transparent"
              : "bg-muted/30 cursor-default border border-transparent"
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{branchName}</span>
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-1.5">
        {isSufficient !== null && (
          <span className={cn("text-[10px] hidden sm:inline", isSufficient ? "text-green-600" : "text-amber-500")}>
            {isSufficient ? "suficiente" : "insuficiente"}
          </span>
        )}
        <Badge variant={qty > 0 ? "default" : "secondary"} className="text-xs tabular-nums shrink-0">
          {Math.floor(qty).toLocaleString("de-DE")}
        </Badge>
      </span>
    </button>
  );
}

/* ── Main ProductCard ────────────────────────────────────────── */
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
  const effectiveStockByWarehouse = liveStock?.stock_by_warehouse ?? productStockByWarehouse;
  const effectiveTotalStock = liveStock?.total_stock ?? productTotalStock;
  const { data: branches } = useBranches();

  // ── Compact mode early return ──
  if (compact) {
    return (
      <CompactProductCard
        productName={productName}
        productSku={productSku}
        productBimsCode={productBimsCode}
        productImageUrl={productImageUrl}
        productSellPrice={productSellPrice}
        productUnit={productUnit}
        effectiveTotalStock={effectiveTotalStock}
        className={className}
      />
    );
  }

  // ── Helpers ──
  const isValidWarehouseKey = (key: string): boolean =>
    !!key && key !== "undefined" && key !== "null" && key.trim() !== "";

  const getWarehouseBranchName = (warehouseId: string): string => {
    const branch = branches?.find(b => b.code === warehouseId);
    return branch?.name || `Depósito ERP ${warehouseId}`;
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

  return (
    <Card className={cn("w-full min-w-0", className)}>
      <CardContent className="min-w-0 p-0">
        {/* ── Section 1: Header ── */}
        <div className="p-2 sm:p-4 pb-2 sm:pb-3">
          <div className="flex min-w-0 gap-3">
            <ProductImage url={productImageUrl} name={productName} />
            <div className="flex-1 min-w-0 space-y-1.5">
              {/* Title + total stock */}
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-base leading-snug line-clamp-2 min-w-0">{productName}</h3>
                {effectiveTotalStock != null && (
                  <Badge
                    variant={effectiveTotalStock > 0 ? "default" : "destructive"}
                    className="text-xs shrink-0 whitespace-nowrap mt-0.5"
                  >
                    Stock: {Math.floor(effectiveTotalStock).toLocaleString("de-DE")}
                  </Badge>
                )}
              </div>
              {/* Metadata chips */}
              <div className="flex flex-wrap gap-1">
                {productSku && (
                  <Badge variant="outline" className="text-[11px] font-mono px-1.5 py-0">SKU: {productSku}</Badge>
                )}
                {productBimsCode && (
                  <Badge variant="outline" className="text-[11px] font-mono px-1.5 py-0">Cód: {productBimsCode}</Badge>
                )}
                {productBarcode && (
                  <Badge variant="outline" className="text-[11px] font-mono px-1.5 py-0">CB: {productBarcode}</Badge>
                )}
              </div>
              {/* Category / Unit / Price */}
              <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
                {productCategory && <span className="truncate max-w-[120px]">{productCategory}</span>}
                {productUnit && (
                  <>
                    {productCategory && <span>•</span>}
                    <span>Unidad: {productUnit}</span>
                  </>
                )}
                {hasPrice && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-foreground whitespace-nowrap">₲{productSellPrice!.toLocaleString("de-DE")}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Description ── */}
        {productDescription && (
          <div className="px-2 sm:px-4 pb-2 sm:pb-3">
            <div className="p-2.5 rounded-md bg-muted/30 border border-border/30">
              <p className="text-xs text-muted-foreground whitespace-pre-line break-words line-clamp-3">{productDescription}</p>
            </div>
          </div>
        )}

        {/* ── Section 3: Prices ── */}
        {(hasPrice || hasPriceScales) && (
          <div className="px-2 sm:px-4 pb-2 sm:pb-3 space-y-1.5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Precios</h4>
            <div className="flex flex-wrap gap-2">
              {hasPrice && (
                <span className="inline-flex items-baseline gap-1 rounded-md border px-2 py-1 bg-muted/40">
                  <span className="font-medium text-xs">Unitario</span>
                  <span className="font-bold text-sm">₲ {productSellPrice!.toLocaleString("de-DE")}</span>
                </span>
              )}
              {hasPriceScales && (() => {
                const relevant = productPriceScales!
                  .filter(s => s.min_quantity === 6 || s.min_quantity === 12)
                  .sort((a, b) => a.min_quantity - b.min_quantity);
                return relevant.map((scale, i) => (
                  <span
                    key={i}
                    className="inline-flex items-baseline gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground bg-background"
                  >
                    <span>≥{scale.min_quantity} un.</span>
                    <span className="font-medium">₲ {scale.price.toLocaleString("de-DE")}</span>
                  </span>
                ));
              })()}
            </div>
          </div>
        )}

        {/* ── Section 4: Stock by warehouse ── */}
        {hasStock && (
          <div className="px-2 sm:px-4 pb-2 sm:pb-4 space-y-2">
            {/* Section header */}
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                {isSelectMode
                  ? "Seleccionar sucursal origen"
                  : isMultiSelectMode
                    ? "Click para seleccionar"
                    : "Stock por sucursal"}
              </h4>
              <div className="flex items-center gap-2 shrink-0">
                {isLive ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600">
                    <Zap className="h-3 w-3" /> En vivo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" /> Sincronizado
                  </span>
                )}
                {effectiveTotalStock != null && (
                  <Badge variant={effectiveTotalStock > 0 ? "default" : "destructive"} className="text-xs">
                    Total: {Math.floor(effectiveTotalStock).toLocaleString("de-DE")}
                  </Badge>
                )}
              </div>
            </div>

            {/* Stock grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                    <StockWarehouseButton
                      key={whId}
                      whId={whId}
                      qty={qty}
                      branchName={getWarehouseBranchName(whId)}
                      isSelected={isSelected}
                      isDisabled={isDisabled}
                      isClickable={isClickable}
                      isSufficient={isSufficient}
                      onClick={() => {
                        if (isDisabled) return;
                        if (isMultiSelectMode && branchId) onToggleBranch!(branchId);
                        else if (isSelectMode && branchId) onSelectSourceBranch!(branchId);
                      }}
                    />
                  );
                })}
            </div>
          </div>
        )}

        {/* ── No stock fallback for select mode ── */}
        {!hasStock && isSelectMode && branches && branches.length > 0 && (
          <div className="px-4 pb-4 space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Seleccionar sucursal origen
            </h4>
            <p className="text-xs text-muted-foreground">
              Stock no disponible. Seleccioná una sucursal basándote en conocimiento operativo.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                      "flex items-center justify-between gap-2 px-3 py-2 rounded-md text-xs transition-colors text-left min-h-[36px]",
                      isDisabled
                        ? "bg-muted/30 opacity-50 cursor-not-allowed"
                        : isSelected
                          ? "bg-primary/10 border border-primary/30 ring-1 ring-primary/20"
                          : "bg-muted/50 hover:bg-accent/10 border border-transparent"
                    )}
                  >
                    <span className="font-medium flex items-center gap-1.5">
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                      {b.name}
                    </span>
                    <span className="text-muted-foreground">{b.code}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── No stock + info only ── */}
        {!hasStock && stockMode === "info_only" && (
          <div className="px-4 pb-4">
            <p className="text-xs text-muted-foreground italic">Stock no disponible para este producto.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
