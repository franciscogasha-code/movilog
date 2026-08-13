import { useState, useCallback } from "react";

export type CartItem = {
  productId: string;
  code: string;
  name: string;
  imageUrl: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  notes: string;
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

export function useSalesCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  const addItem = useCallback((item: CartItem) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === item.productId);
      if (existing) {
        return prev.map((i) =>
          i.productId === item.productId
            ? { ...i, quantity: i.quantity + item.quantity, notes: item.notes || i.notes }
            : i
        );
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
      prev.map((i) => (i.productId === productId ? { ...i, quantity } : i))
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
    addItem,
    updateQuantity,
    updateNotes,
    removeItem,
    clearCart,
    total,
    count: items.reduce((sum, i) => sum + i.quantity, 0),
  };
}
