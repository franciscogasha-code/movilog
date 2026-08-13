import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ImageOff } from "lucide-react";
import { resolvePrice, resolveStock, formatGs, ProductRow } from "@/lib/ventas";

export function ProductoFicha({
  product,
  customerPriceListId,
  open,
  onOpenChange,
  onAdd,
}: {
  product: ProductRow | null;
  customerPriceListId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: ProductRow, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);

  if (!product) return null;

  const price = resolvePrice(product, customerPriceListId, quantity);
  const stock = resolveStock(product);
  const scales = Array.isArray(product.price_scales) ? (product.price_scales as any[]) : [];

  const handleAdd = () => {
    onAdd(product, quantity);
    setQuantity(1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-tight">{product.name}</DialogTitle>
        </DialogHeader>

        <div className="aspect-video bg-muted rounded-lg flex items-center justify-center overflow-hidden">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <ImageOff className="h-12 w-12 text-muted-foreground" />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{product.category ?? "Sin categoría"}</Badge>
            <Badge variant={stock > 0 ? "default" : "destructive"}>
              Stock {stock.toLocaleString("de-DE")} {product.unit}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">Código: {product.bims_code}</p>
          {product.description && (
            <p className="text-sm text-foreground">{product.description}</p>
          )}
        </div>

        {scales.length > 0 && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">Escalas por cantidad</p>
            <div className="flex flex-wrap gap-2">
              {scales.map((s: any, idx: number) => (
                <Badge key={idx} variant="secondary">
                  ≥ {s.min_quantity} {product.unit}: {formatGs(Number(s.price || 0))}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <span className="text-lg font-bold text-primary">{formatGs(price * quantity)}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </Button>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 text-center"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => q + 1)}
            >
              +
            </Button>
          </div>
        </div>

        <Button className="w-full" onClick={handleAdd} disabled={stock <= 0}>
          {stock > 0 ? "Agregar al carrito" : "Sin stock disponible"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
