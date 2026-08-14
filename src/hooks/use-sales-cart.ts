import { useCallback } from "react";
import type { PriceScale } from "@/lib/ventas";
import { useIdbState } from "@/hooks/use-idb-state";

export type CartItem = {
  productId: string;
  code: string;
  name: string;
  imageUrl: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  notes: string;
  /** Escalas por cantidad del producto (vacío si no tiene) */
  priceScales: PriceScale[];
  /** Precio base de venta, usado cuando ninguna escala aplica */
  basePrice: number;
  /** True cuando el cliente tiene lista de precios fija: no se recalcula por escalas */
  hasFixedListPrice: boolean;
};

export type CartCustomer = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  ruc: string;
  priceListId: string | null;
};

/** Precio unitario según cantidad, respetando lista de precios fija */
export function priceForQuantity(item: CartItem, quantity: number): number {
  if (item.hasFixedListPrice) return item.unitPrice;
  const scale = [...item.priceScales]
    .filter((s) => quantity >= s.min_quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity)[0];
  return scale?.price ?? item.basePrice;
}

export function useSalesCart(storageKey = "sales-cart") {
  const [items, setItems, hydrated] = useIdbState<CartItem[]>(storageKey, []);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === item.productId);
      if (existing) {
        return prev.map((i) => {
          if (i.productId !== item.productId) return i;
          const quantity = i.quantity + item.quantity;
          const merged = { ...i, ...item, quantity, notes: item.notes || i.notes };
          return { ...merged, unitPrice: priceForQuantity(merged, quantity) };
        });
      }
      return [...prev, item];
    });
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.productId === productId
          ? { ...i, quantity, unitPrice: priceForQuantity(i, quantity) }
          : i
      )
    );
  }, []);

  const updateNotes = useCallback((productId: string, notes: string) => {
    setItems((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, notes } : i))
    );
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  return {
    items,
    hydrated,
    addItem,
    updateQuantity,
    updateNotes,
    removeItem,
    clearCart,
    total,
    count: items.reduce((sum, i) => sum + i.quantity, 0),
  };
}
