import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Minus, Plus, Trash2, ShoppingCart } from "lucide-react";
import { formatGs } from "@/lib/ventas";
import type { CartItem, CartCustomer } from "@/hooks/use-sales-cart";

export function CarritoPanel({
  open,
  onOpenChange,
  items,
  customer,
  onUpdateQuantity,
  onUpdateNotes,
  onRemove,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CartItem[];
  customer: CartCustomer;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateNotes: (productId: string, notes: string) => void;
  onRemove: (productId: string) => void;
  onConfirm: () => void;
}) {
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Carrito ({items.reduce((s, i) => s + i.quantity, 0)})
          </SheetTitle>
        </SheetHeader>

        {customer.name && (
          <div className="text-sm bg-muted/50 rounded-lg p-2 mt-2">
            <p className="font-medium">{customer.name}</p>
            {customer.ruc && <p className="text-muted-foreground text-xs">RUC {customer.ruc}</p>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              El carrito está vacío
            </p>
          )}

          {items.map((item) => (
            <div key={item.productId} className="border rounded-lg p-3 space-y-3">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatGs(item.unitPrice)} / {item.unit}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => onRemove(item.productId)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      onUpdateQuantity(item.productId, Number(e.target.value) || 1)
                    }
                    className="h-7 w-16 text-center text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <span className="text-sm font-semibold">
                  {formatGs(item.quantity * item.unitPrice)}
                </span>
              </div>

              <Textarea
                placeholder="Nota del ítem..."
                value={item.notes}
                onChange={(e) => onUpdateNotes(item.productId, e.target.value)}
                className="text-xs min-h-[60px]"
              />
            </div>
          ))}
        </div>

        <div className="pt-4 border-t space-y-3">
          <div className="flex items-center justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatGs(total)}</span>
          </div>
          <Button
            className="w-full"
            disabled={items.length === 0 || !customer.name.trim()}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Confirmar pedido
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
