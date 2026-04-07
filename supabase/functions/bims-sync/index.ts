import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Md5 } from "https://deno.land/std@0.95.0/hash/md5.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function md5(message: string): string {
  return new Md5().update(message).toString();
}

type BimsSession = {
  authType: "bearer" | "cookie";
  credential: string;
  expiresAt: number;
};

function toText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const lowered = normalized.toLowerCase();
  if (lowered === "undefined" || lowered === "null") return null;
  return normalized;
}

function extractArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.warehouses)) return payload.warehouses;
  if (Array.isArray(payload?.Warehouses)) return payload.Warehouses;
  if (Array.isArray(payload?.data?.warehouses)) return payload.data.warehouses;
  if (Array.isArray(payload?.data?.Warehouses)) return payload.data.Warehouses;
  return [];
}

function normalizeWarehouse(raw: any) {
  const item = raw?.Warehouse ?? raw?.warehouse ?? raw;
  const idLike = item?.id ?? item?.warehouse_id ?? item?.code ?? item?.codigo ?? raw?.id ?? raw?.warehouse_id ?? raw?.code ?? raw?.codigo;
  if (idLike === undefined || idLike === null || String(idLike).trim() === "") return null;

  const code = String(item?.code ?? item?.codigo ?? idLike).trim();
  if (!code || code.toLowerCase() === "undefined" || code.toLowerCase() === "null") return null;

  return {
    code,
    name: String(item?.name ?? item?.description ?? item?.nombre ?? raw?.name ?? raw?.description ?? raw?.nombre ?? `Warehouse ${code}`).trim() || `Warehouse ${code}`,
    city: item?.city ?? item?.ciudad ?? raw?.city ?? raw?.ciudad ?? null,
    address: item?.address ?? item?.direccion ?? raw?.address ?? raw?.direccion ?? null,
  };
}

function normalizeProduct(raw: any) {
  const item = raw?.Product ?? raw?.product ?? raw;
  const bimsCode = toText(item?.id ?? item?._id ?? item?.product_id ?? raw?.id ?? raw?.product_id ?? raw?._id);
  if (!bimsCode) return null;

  const status = toText(item?.status ?? raw?.status)?.toLowerCase();
  const enabledValue = item?.enabled ?? item?.active ?? raw?.enabled ?? raw?.active;

  const code1 = toText(item?.code ?? raw?.code);
  const code2 = toText(item?.code2 ?? raw?.code2);
  const barcode = code1 || code2 || null;
  const sku = code2 || code1 || null;

  const description = toText(item?.notes ?? raw?.notes);
  const imageUrl = toText(item?.image_url ?? item?.image ?? raw?.image_url ?? raw?.image);

  const sellPrice = item?.sell_price != null ? parseFloat(String(item.sell_price)) : null;
  const buyPrice = item?.buy_price != null ? parseFloat(String(item.buy_price)) : null;

  const qprices = item?.Qprice ?? raw?.Qprice ?? [];
  const priceScales = Array.isArray(qprices) ? qprices.map((q: any) => ({
    min_quantity: parseFloat(String(q.min_quantity || 0)),
    price: parseFloat(String(q.price || 0)),
  })) : [];

  const pricings = item?.ProductsPricing ?? raw?.ProductsPricing ?? [];
  const priceLists = Array.isArray(pricings) ? pricings.map((p: any) => ({
    name: p?.Pricing?.name || `Lista ${p?.pricing_id}`,
    amount: parseFloat(String(p?.amount || 0)),
    pricing_id: p?.pricing_id,
  })) : [];

  const availability = item?.Availability ?? raw?.Availability ?? {};
  const stockByWarehouse: Record<string, number> = {};
  let totalStock = 0;
  if (typeof availability === "object" && availability !== null) {
    for (const [whId, qty] of Object.entries(availability)) {
      const numQty = parseFloat(String(qty));
      if (!isNaN(numQty)) {
        stockByWarehouse[whId] = numQty;
        totalStock += numQty;
      }
    }
  }

  return {
    bims_code: bimsCode,
    name: toText(item?.name ?? item?.description ?? raw?.name ?? raw?.description) ?? `Product ${bimsCode}`,
    sku,
    barcode,
    category: toText(raw?.Ptype?.name ?? raw?.ptype?.name ?? item?.category ?? item?.group ?? raw?.category ?? raw?.group),
    unit: toText(item?.um_id ?? item?.unit ?? item?.measure_unit ?? raw?.um_id ?? raw?.unit ?? raw?.measure_unit) ?? "UN",
    is_active: enabledValue !== false && enabledValue !== 0 && enabledValue !== "0" && status !== "inactive" && status !== "disabled",
    description,
    image_url: imageUrl,
    sell_price: isNaN(sellPrice as number) ? null : sellPrice,
    buy_price: isNaN(buyPrice as number) ? null : buyPrice,
    price_scales: priceScales,
    price_lists: priceLists,
    stock_by_warehouse: stockByWarehouse,
    total_stock: totalStock,
  };
}

let cachedSession: BimsSession | null = null;

const rawBimsUrl = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_URL = rawBimsUrl.replace(/\/users\/login\/?$/i, "").replace(/\/$/, "");
const BIMS_API_USER = Deno.env.get("BIMS_API_USER")!;
const BIMS_API_PASSWORD = Deno.env.get("BIMS_API_PASSWORD")!;

async function getBimsSession(): Promise<BimsSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 300_000) return cachedSession;

  const passwordMd5 = md5(BIMS_API_PASSWORD);
  const response = await fetch(`${BIMS_API_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: BIMS_API_USER, password: passwordMd5 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BIMS login failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const token = data?.token || data?.session || data?.access_token || data?.data?.token || data?.data?.access_token;
  if (token) {
    cachedSession = { authType: "bearer", credential: String(token), expiresAt: Date.now() + 3_600_000 };
    return cachedSession;
  }

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cachedSession = { authType: "cookie", credential: setCookie.split(",")[0], expiresAt: Date.now() + 3_600_000 };
    return cachedSession;
  }

  throw new Error(`BIMS login did not return token/cookie.`);
}

async function bimsRequest(method: string, path: string): Promise<unknown> {
  const session = await getBimsSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session.authType === "bearer") headers["Authorization"] = `Bearer ${session.credential}`;
  else headers["Cookie"] = session.credential;

  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, { method, headers });
  if (response.status === 401 || response.status === 403) {
    cachedSession = null;
    const newSession = await getBimsSession();
    if (newSession.authType === "bearer") { headers["Authorization"] = `Bearer ${newSession.credential}`; delete headers["Cookie"]; }
    else { headers["Cookie"] = newSession.credential; delete headers["Authorization"]; }
    const retry = await fetch(url, { method, headers });
    if (!retry.ok) throw new Error(`BIMS request failed after re-auth: ${retry.status}`);
    return await retry.json();
  }
  if (!response.ok) throw new Error(`BIMS request failed: ${response.status}`);
  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const results: Record<string, unknown> = {};

    // 1. Sync warehouses
    const warehouses = await bimsRequest("GET", `/warehouses`) as any;
    const whItems = extractArray(warehouses);
    let whSynced = 0;
    for (const w of whItems) {
      const normalized = normalizeWarehouse(w);
      if (!normalized) continue;
      const { data: existing } = await adminClient.from("branches").select("id").eq("code", normalized.code).maybeSingle();
      if (!existing) {
        await adminClient.from("branches").insert({
          code: normalized.code, name: normalized.name,
          city: normalized.city ? String(normalized.city) : null,
          address: normalized.address ? String(normalized.address) : null,
        });
      }
      whSynced++;
    }
    results.warehouses = { synced: whSynced };

    // 2. Sync products with full commercial data
    const PRODUCT_PAGE_SIZE = 250;
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;
    while (hasMore) {
      const products = await bimsRequest("GET", `/products?page=${page}&limit=${PRODUCT_PAGE_SIZE}`) as any;
      const items = extractArray(products);
      if (items.length === 0) { hasMore = false; break; }

      const mapped = Array.from(
        new Map(
          items
            .map((product: any) => normalizeProduct(product))
            .filter((p: any) => p !== null)
            .map((product: any) => [product.bims_code, product])
        ).values()
      );

      if (mapped.length > 0) {
        const { error } = await adminClient.from("products").upsert(mapped, { onConflict: "bims_code" });
        if (error) throw new Error(`Products page ${page} upsert failed: ${error.message}`);
        totalSynced += mapped.length;
      }

      page++;
      if (items.length < PRODUCT_PAGE_SIZE) hasMore = false;
    }
    results.products = { synced: totalSynced };

    console.log("BIMS auto-sync completed:", JSON.stringify(results));

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("BIMS auto-sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
