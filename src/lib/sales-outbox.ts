import { supabase } from "@/integrations/supabase/client";
import { idbGet, idbSet } from "@/lib/offline-store";
import type { CartItem, CartCustomer } from "@/hooks/use-sales-cart";

const OUTBOX_KEY = "sales-outbox-v1";

export type OutboxStatus = "pending" | "sending" | "error" | "sent";

export type PreSalePayload = {
  customer: CartCustomer;
  items: CartItem[];
  branchId: string;
  shippingMethod: string;
  paymentMethod: string;
  shippingCost: number | null;
  notes: string;
  userId: string;
};

export type OutboxEntry = {
  clientUuid: string;
  payload: PreSalePayload;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  requestId?: string;
};

type Listener = (entries: OutboxEntry[]) => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function readAll(): Promise<OutboxEntry[]> {
  return (await idbGet<OutboxEntry[]>(OUTBOX_KEY)) ?? [];
}

async function writeAll(entries: OutboxEntry[]): Promise<void> {
  await idbSet(OUTBOX_KEY, entries);
  listeners.forEach((fn) => fn(entries));
}

export async function getOutbox(): Promise<OutboxEntry[]> {
  return readAll();
}

/** Pedidos que todavía no llegaron al servidor */
export function isUnsent(e: OutboxEntry): boolean {
  return e.status !== "sent";
}

export async function enqueuePreSale(payload: PreSalePayload): Promise<OutboxEntry> {
  const now = new Date().toISOString();
  const entry: OutboxEntry = {
    clientUuid: crypto.randomUUID(),
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  const all = await readAll();
  await writeAll([...all, entry]);
  return entry;
}

async function patchEntry(clientUuid: string, patch: Partial<OutboxEntry>): Promise<void> {
  const all = await readAll();
  await writeAll(
    all.map((e) =>
      e.clientUuid === clientUuid ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e
    )
  );
}

export async function removeEntry(clientUuid: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((e) => e.clientUuid !== clientUuid));
}

export async function clearSentEntries(): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter(isUnsent));
}

/**
 * Crea la pre-venta en el servidor de forma idempotente por client_uuid.
 * Si el pedido ya existe (reintento tras un timeout), devuelve el id existente.
 */
export async function submitPreSale(clientUuid: string, payload: PreSalePayload): Promise<string> {
  const { customer, items, branchId, shippingMethod, paymentMethod, shippingCost, notes, userId } =
    payload;

  if (!branchId) throw new Error("Falta la sucursal de origen");
  if (items.length === 0) throw new Error("Carrito vacío");
  if (!customer.name.trim()) throw new Error("Falta el cliente");

  // Idempotencia: si ya se creó en un intento anterior, no duplicar
  const { data: existingOrder, error: existingError } = await supabase
    .from("branch_requests")
    .select("id")
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingOrder?.id) return existingOrder.id;

  // Cliente manual: crear si no existe
  let customerId = customer.id;
  if (!customerId) {
    const { data: existing, error: searchError } = await supabase
      .from("sales_customers")
      .select("id")
      .eq("name", customer.name.trim())
      .eq("source", "manual")
      .maybeSingle();
    if (searchError) throw searchError;

    if (existing?.id) {
      customerId = existing.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from("sales_customers")
        .insert({
          name: customer.name.trim(),
          ruc: customer.ruc || null,
          phone: customer.phone || null,
          email: customer.email || null,
          address: customer.address || null,
          source: "manual",
          created_by: userId,
        })
        .select("id")
        .single();
      if (createError) throw createError;
      customerId = created.id;
    }
  }

  const { data: order, error: orderError } = await supabase
    .from("branch_requests")
    .insert({
      client_uuid: clientUuid,
      request_type: "pre_sale_online",
      requesting_branch_id: branchId,
      source_branch_id: branchId,
      delivery_target: "client",
      shipping_method: shippingMethod as any,
      shipping_cost: shippingCost,
      client_name: customer.name.trim(),
      client_phone: customer.phone || null,
      client_email: customer.email || null,
      client_address: customer.address || null,
      is_pre_sale: true,
      pre_sale_status: "confirmed",
      pre_sale_confirmed_at: new Date().toISOString(),
      sales_channel: "vendedor_externo",
      commercial_terms: `Pago: ${paymentMethod}. Notas: ${notes || "-"}`,
      notes: notes || null,
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();
  if (orderError) throw orderError;

  const orderItems = items.map((item) => ({
    request_id: order.id,
    product_id: item.productId,
    quantity_requested: item.quantity,
    quantity_unfulfilled: 0,
    quantity_accepted: 0,
    quantity_picked: 0,
    quantity_received: 0,
    quantity_shipped: 0,
    local_supply_qty: 0,
    item_purpose: "client" as const,
    notes: item.notes || null,
  }));

  const { error: itemsError } = await supabase.from("branch_request_items").insert(orderItems);
  if (itemsError) throw itemsError;

  // Trazabilidad del vendedor (idempotente por client_uuid)
  await supabase.from("sales_carts").upsert(
    {
      client_uuid: clientUuid,
      salesperson_id: userId,
      customer_id: customerId,
      client_name: customer.name.trim(),
      client_phone: customer.phone || null,
      client_email: customer.email || null,
      client_address: customer.address || null,
      notes: notes || null,
      sales_channel: "vendedor_externo",
      status: "submitted",
    },
    { onConflict: "client_uuid" }
  );

  return order.id;
}

/** Envía una entrada puntual. Nunca borra el registro ante error. */
export async function processEntry(entry: OutboxEntry): Promise<{ ok: boolean; error?: string }> {
  await patchEntry(entry.clientUuid, { status: "sending" });
  try {
    const requestId = await submitPreSale(entry.clientUuid, entry.payload);
    await patchEntry(entry.clientUuid, { status: "sent", requestId, lastError: null });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error desconocido";
    await patchEntry(entry.clientUuid, {
      status: "error",
      lastError: message,
      attempts: entry.attempts + 1,
    });
    return { ok: false, error: message };
  }
}

let processing = false;

/** Procesa la cola completa, una entrada por vez. */
export async function processOutbox(): Promise<{ sent: number; failed: number }> {
  if (processing || !navigator.onLine) return { sent: 0, failed: 0 };
  processing = true;
  let sent = 0;
  let failed = 0;
  try {
    const all = await readAll();
    for (const entry of all.filter(isUnsent)) {
      const result = await processEntry(entry);
      if (result.ok) sent++;
      else failed++;
    }
  } finally {
    processing = false;
  }
  return { sent, failed };
}
