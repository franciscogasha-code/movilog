import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { ImageOff, Maximize2, Minus, Plus, Radio, TrendingDown, AlertTriangle } from "lucide-react";
import {
  resolvePrice,
  resolveStock,
  resolveScaleInfo,
  formatGs,
  ProductRow,
} from "@/lib/ventas";
import { proxyImageUrl } from "@/lib/image-utils";
import { useBranches } from "@/hooks/use-branches";
import { useLiveStock } from "@/hooks/use-live-stock";
import { cn } from "@/lib/utils";

const QUICK_STEPS = [6, 12, 24];

type StockRow = { key: string; name: string; qty: number };

export function ProductoFicha({
  product,
  customerPriceListId,
  open,
  onOpenChange,
  onAdd,
  cartQuantity = 0,
}: {
  product: ProductRow | null;
  customerPriceListId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: ProductRow, quantity: number) => void;
  cartQuantity?: number;
}) {
  const [quantity, setQuantity] = useState(1);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);
  const [zoom, setZoom] = useState(false);

  const { data: branches } = useBranches();
  const { liveStock, isLive } = useLiveStock(
    open && product?.bims_code ? [product.bims_code] : []
  );

  useEffect(() => {
    if (open) {
      setQuantity(1);
      setShowAllBranches(false);
      setExpandDesc(false);
      setZoom(false);
    }
  }, [open, product?.id]);

  const branchNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    (branches ?? []).forEach((b: any) => {
      if (b?.code) map.set(String(b.code), b.name as string);
    });
    return map;
  }, [branches]);

  const live = product?.bims_code ? liveStock?.[product.bims_code] : undefined;

  const stockRows: StockRow[] = useMemo(() => {
    if (!product) return [];
    const source =
      (live?.stock_by_warehouse as Record<string, number> | undefined) ??
      ((product.stock_by_warehouse as Record<string, number> | null) ?? {});
    return Object.entries(source)
      .map(([key, value]) => ({
        key,
        name: branchNameByCode.get(String(key)) ?? `Depósito ${key}`,
        qty: Number(value) || 0,
      }))
      .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "es"));
  }, [product, live, branchNameByCode]);

  if (!product) return null;

  const totalStock =
    typeof live?.total_stock === "number" ? live.total_stock : resolveStock(product);
  const withStock = stockRows.filter((r) => r.qty > 0);
  const visibleRows = showAllBranches ? stockRows : withStock;

  const unitPrice = resolvePrice(product, customerPriceListId, quantity);
  const basePrice = resolvePrice(product, customerPriceListId, 1);
  const { scales, active, next } = resolveScaleInfo(product, quantity);
  const saving = basePrice > unitPrice ? (basePrice - unitPrice) * quantity : 0;
  const description = (product.description ?? "").trim();
  const isLongDesc = description.length > 240;

  const handleAdd = () => {
    onAdd(product, quantity);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl p-0 gap-0 max-h-[92vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b shrink-0 text-left">
            <DialogTitle className="text-base leading-tight pr-8 line-clamp-2">
              {product.name}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {[product.brand, product.category].filter(Boolean).join(" · ") || "Sin categoría"}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="grid md:grid-cols-2 gap-0">
              {/* Imagen */}
              <div className="p-4 md:border-r">
                <button
                  type="button"
                  onClick={() => product.image_url && setZoom(true)}
                  className="relative w-full aspect-square rounded-lg bg-muted/50 border flex items-center justify-center overflow-hidden group"
                  aria-label="Ampliar imagen"
                >
                  {product.image_url ? (
                    <>
                      <img
                        src={proxyImageUrl(product.image_url)}
                        alt={product.name}
                        className="max-w-full max-h-full w-auto h-auto object-contain p-3"
                      />
                      <span className="absolute bottom-2 right-2 rounded-md bg-background/85 border p-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ImageOff className="h-10 w-10" />
                      <span className="text-xs">Sin imagen</span>
                    </div>
                  )}
                </button>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Badge variant={totalStock > 0 ? "default" : "destructive"}>
                    Stock {totalStock.toLocaleString("de-DE")} {product.unit}
                  </Badge>
                  {isLive && (
                    <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-600/40">
                      <Radio className="h-3 w-3" /> En vivo
                    </Badge>
                  )}
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Código</dt>
                  <dd className="text-right font-medium">{product.bims_code}</dd>
                  {product.barcode && (
                    <>
                      <dt className="text-muted-foreground">Código de barras</dt>
                      <dd className="text-right font-medium break-all">{product.barcode}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Unidad</dt>
                  <dd className="text-right font-medium">{product.unit}</dd>
                </dl>
              </div>

              {/* Datos */}
              <div className="p-4 space-y-4">
                {/* Stock por sucursal */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold">Cantidad por sucursal</h3>
                    <span className="text-xs text-muted-foreground">
                      {withStock.length} con stock
                    </span>
                  </div>
                  {visibleRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin stock en ninguna sucursal</p>
                  ) : (
                    <div className="rounded-lg border divide-y">
                      {visibleRows.map((row) => (
                        <div
                          key={row.key}
                          className="flex items-center justify-between px-3 py-1.5 text-sm"
                        >
                          <span className="truncate pr-2">{row.name}</span>
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              row.qty > 0 ? "text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {row.qty.toLocaleString("de-DE")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {stockRows.length > withStock.length && (
                    <Button
                      variant="link"
                      size="sm"
                      className="px-0 h-7 text-xs"
                      onClick={() => setShowAllBranches((v) => !v)}
                    >
                      {showAllBranches
                        ? "Ver solo sucursales con stock"
                        : `Ver todas las sucursales (${stockRows.length})`}
                    </Button>
                  )}
                </section>

                {/* Escalas */}
                {scales.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold mb-2">Precio por cantidad</h3>
                    <div className="flex flex-wrap gap-2">
                      {scales.map((s, idx) => {
                        const isActive = active?.min_quantity === s.min_quantity;
                        return (
                          <button
                            type="button"
                            key={idx}
                            onClick={() => setQuantity(s.min_quantity)}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs transition-colors",
                              isActive
                                ? "border-primary bg-primary/10 text-primary font-semibold"
                                : "hover:border-primary/50"
                            )}
                          >
                            desde {s.min_quantity} {product.unit}: {formatGs(s.price)}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Descripción */}
                {description && (
                  <section>
                    <h3 className="text-sm font-semibold mb-1">Descripción</h3>
                    <p
                      className={cn(
                        "text-sm text-muted-foreground whitespace-pre-line",
                        !expandDesc && isLongDesc && "line-clamp-4"
                      )}
                    >
                      {description}
                    </p>
                    {isLongDesc && (
                      <Button
                        variant="link"
                        size="sm"
                        className="px-0 h-7 text-xs"
                        onClick={() => setExpandDesc((v) => !v)}
                      >
                        {expandDesc ? "Ver menos" : "Ver más"}
                      </Button>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>

          {/* Barra de acción */}
          <div className="border-t bg-background px-4 py-3 shrink-0 space-y-2">
            {cartQuantity > 0 && (
              <p className="text-xs text-muted-foreground">
                Ya tenés {cartQuantity.toLocaleString("de-DE")} {product.unit} en el carrito
              </p>
            )}
            {quantity > totalStock && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                La cantidad supera el stock disponible ({totalStock.toLocaleString("de-DE")})
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 h-9 text-center"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuantity((q) => q + 1)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                {QUICK_STEPS.map((step) => (
                  <Button
                    key={step}
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setQuantity(step)}
                  >
                    {step}
                  </Button>
                ))}
              </div>
              <div className="ml-auto text-right">
                <p className="text-lg font-bold text-primary leading-tight">
                  {formatGs(unitPrice * quantity)}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {formatGs(unitPrice)} / {product.unit}
                  {saving > 0 && ` · ahorro ${formatGs(saving)}`}
                </p>
              </div>
            </div>
            <Button className="w-full" onClick={handleAdd} disabled={totalStock <= 0}>
              {totalStock > 0 ? "Agregar al carrito" : "Sin stock disponible"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Zoom de imagen */}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-3xl p-2">
          <DialogHeader className="sr-only">
            <DialogTitle>{product.name}</DialogTitle>
          </DialogHeader>
          {product.image_url && (
            <img
              src={proxyImageUrl(product.image_url)}
              alt={product.name}
              className="w-full max-h-[80vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
