import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Minus,
  Plus,
  Trash2,
  ShoppingCart,
  StickyNote,
  TrendingDown,
  Check,
  AlertCircle,
  User,
} from "lucide-react";
import { formatGs } from "@/lib/ventas";
import { priceForQuantity, type CartItem, type CartCustomer } from "@/hooks/use-sales-cart";
import { cn } from "@/lib/utils";

export function CartItemRow({
  item,
  onUpdateQuantity,
  onUpdateNotes,
  onRemove,
}: {
  item: CartItem;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onUpdateNotes: (productId: string, notes: string) => void;
  onRemove: (productId: string) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);

  const scales = item.hasFixedListPrice ? [] : item.priceScales;
  const next = scales.find((s) => s.min_quantity > item.quantity) ?? null;
  const atBest =
    scales.length > 0 && !next && item.quantity >= scales[scales.length - 1].min_quantity;
  const nextPrice = next ? priceForQuantity(item, next.min_quantity) : 0;
  const saving = next ? (item.unitPrice - nextPrice) * next.min_quantity : 0;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium line-clamp-2">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatGs(item.unitPrice)} / {item.unit}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", item.notes && "text-primary", notesOpen && "bg-muted")}
            aria-label={item.notes ? "Editar nota" : "Agregar nota"}
            aria-pressed={notesOpen}
            title={item.notes ? "Editar nota" : "Agregar nota"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setNotesOpen((v) => !v)}
          >
            <StickyNote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Quitar producto"
            onClick={() => onRemove(item.productId)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Restar unidad"
            onClick={() => onUpdateQuantity(item.productId, item.quantity - 1)}
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            type="number"
            min={1}
            value={item.quantity}
            onChange={(e) => onUpdateQuantity(item.productId, Number(e.target.value) || 1)}
            className="h-7 w-16 text-center text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Sumar unidad"
            onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <span className="text-sm font-semibold">
          {formatGs(item.quantity * item.unitPrice)}
        </span>
      </div>

      {next && saving > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-amber-500 bg-amber-500/15 px-2 py-1.5 text-xs animate-fade-in">
          <TrendingDown className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="flex-1 min-w-[150px] text-amber-900 dark:text-amber-200">
            Agregá <strong>{next.min_quantity - item.quantity}</strong> más →{" "}
            <strong>{formatGs(nextPrice)}</strong> c/u{" "}
            <strong className="text-amber-700 dark:text-amber-300">
              (ahorrás {formatGs(saving)})
            </strong>
          </span>
          <Button
            size="sm"
            className="h-6 px-2 text-[11px] bg-amber-500 text-white hover:bg-amber-600"
            onClick={() => onUpdateQuantity(item.productId, next.min_quantity)}
          >
            Aplicar
          </Button>
        </div>
      )}

      {atBest && (
        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="h-3 w-3" /> Mejor precio aplicado
        </div>
      )}

      {notesOpen ? (
        <Textarea
          autoFocus
          placeholder="Nota del ítem..."
          value={item.notes}
          onChange={(e) => onUpdateNotes(item.productId, e.target.value)}
          onBlur={() => {
            setNotesOpen(false);
            if (item.notes && !item.notes.trim()) onUpdateNotes(item.productId, "");
          }}
          className="text-xs min-h-[56px]"
        />
      ) : (
        item.notes && (
          <p
            className="text-xs text-muted-foreground line-clamp-1 cursor-pointer"
            onClick={() => setNotesOpen(true)}
          >
            <StickyNote className="inline h-3 w-3 mr-1" />
            {item.notes}
          </p>
        )
      )}
    </div>
  );
}

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

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              El carrito está vacío
            </p>
          )}

          {items.map((item) => (
            <CartItemRow
              key={item.productId}
              item={item}
              onUpdateQuantity={onUpdateQuantity}
              onUpdateNotes={onUpdateNotes}
              onRemove={onRemove}
            />
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
