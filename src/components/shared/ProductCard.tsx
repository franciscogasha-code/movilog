import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, MapPin, AlertTriangle } from "lucide-react";
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
  onSelectSourceBranch,
  className,
  compact = false,
}: ProductCardProps) {
  const { data: branches } = useBranches();

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
              {productBarcode && (
                <Badge variant="outline" className="text-xs font-mono">CB: {productBarcode}</Badge>
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

        {/* Stock disclaimer - honest about limitations */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Stock en tiempo real no disponible</p>
              <p>La API de BIMS no expone stock por depósito de forma directa. Los datos de imagen, descripción comercial, precios y precios por escala tampoco están disponibles en la sincronización actual.</p>
              <p>Seleccioná una sucursal origen basándote en el conocimiento operativo del equipo o consultá disponibilidad.</p>
            </div>
          </div>
        </div>

        {/* Branch selector for origin */}
        {onSelectSourceBranch && branches && branches.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Seleccionar sucursal origen
            </h4>
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
