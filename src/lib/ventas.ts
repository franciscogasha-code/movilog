import type { Database } from "@/integrations/supabase/types";

export type ProductRow = Database["public"]["Tables"]["products"]["Row"];

export function resolvePrice(
  product: ProductRow,
  customerPriceListId?: string | null,
  quantity: number = 1
): number {
  // 1. Lista de precios del cliente si existe
  const priceLists = Array.isArray(product.price_lists) ? product.price_lists : [];
  const customerListPrice = priceLists.find(
    (p: any) => p.pricing_id === customerPriceListId || p.name === customerPriceListId
  )?.amount;

  if (customerListPrice != null && !isNaN(customerListPrice)) {
    return customerListPrice;
  }

  // 2. Escalas por cantidad
  const scales = Array.isArray(product.price_scales) ? product.price_scales : [];
  const matchingScale = scales
    .filter((s: any) => typeof s.min_quantity === "number" && quantity >= s.min_quantity)
    .sort((a: any, b: any) => b.min_quantity - a.min_quantity)[0];

  if (matchingScale?.price != null && !isNaN(matchingScale.price)) {
    return matchingScale.price;
  }

  // 3. Precio de venta base
  return product.sell_price ?? 0;
}

export function resolveStock(product: ProductRow): number {
  if (typeof product.total_stock === "number") return product.total_stock;
  const stock = product.stock_by_warehouse as Record<string, number> | null;
  if (!stock || typeof stock !== "object") return 0;
  return Object.values(stock).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function formatGs(amount: number): string {
  return "₲ " + Math.round(amount).toLocaleString("de-DE");
}
