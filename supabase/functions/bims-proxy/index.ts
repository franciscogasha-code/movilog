import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Md5 } from "https://deno.land/std@0.95.0/hash/md5.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function md5(message: string): string {
  return new Md5().update(message).toString();
}

// Session cache (in-memory, per function instance)
type BimsSession = {
  authType: "bearer" | "cookie";
  credential: string;
  expiresAt: number;
};

type NormalizedProduct = {
  bims_code: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  is_active: boolean;
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
  const idLike =
    item?.id ??
    item?.warehouse_id ??
    item?.code ??
    item?.codigo ??
    raw?.id ??
    raw?.warehouse_id ??
    raw?.code ??
    raw?.codigo;

  if (idLike === undefined || idLike === null || String(idLike).trim() === "") {
    return null;
  }

  const code = String(item?.code ?? item?.codigo ?? idLike).trim();
  if (!code || code.toLowerCase() === "undefined" || code.toLowerCase() === "null") {
    return null;
  }

  const name = String(
    item?.name ?? item?.description ?? item?.nombre ?? raw?.name ?? raw?.description ?? raw?.nombre ?? `Warehouse ${code}`
  ).trim();

  const city = item?.city ?? item?.ciudad ?? raw?.city ?? raw?.ciudad ?? null;
  const address = item?.address ?? item?.direccion ?? raw?.address ?? raw?.direccion ?? null;

  return {
    code,
    name: name || `Warehouse ${code}`,
    city: city ? String(city) : null,
    address: address ? String(address) : null,
  };
}

function normalizeProduct(raw: any): NormalizedProduct | null {
  const item = raw?.Product ?? raw?.product ?? raw;

  const bimsCode = toText(
    item?.id ??
    item?.product_id ??
    item?._id ??
    item?.code ??
    raw?.id ??
    raw?.product_id ??
    raw?._id ??
    raw?.code
  );

  if (!bimsCode) return null;

  const status = toText(item?.status ?? raw?.status)?.toLowerCase();
  const enabledValue = item?.enabled ?? item?.active ?? raw?.enabled ?? raw?.active;

  return {
    bims_code: bimsCode,
    name: toText(item?.name ?? item?.description ?? raw?.name ?? raw?.description) ?? `Product ${bimsCode}`,
    sku: toText(item?.code2 ?? item?.code ?? item?.sku ?? raw?.code2 ?? raw?.code ?? raw?.sku),
    category: toText(raw?.Ptype?.name ?? raw?.ptype?.name ?? item?.category ?? item?.group ?? raw?.category ?? raw?.group),
    unit: toText(item?.unit ?? item?.measure_unit ?? item?.um_id ?? raw?.unit ?? raw?.measure_unit) ?? "UN",
    is_active: enabledValue !== false && enabledValue !== 0 && enabledValue !== "0" && status !== "inactive" && status !== "disabled",
  };
}

let cachedSession: BimsSession | null = null;

const rawBimsUrl = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_URL = rawBimsUrl.replace(/\/users\/login\/?$/i, "").replace(/\/$/, "");
const BIMS_API_USER = Deno.env.get("BIMS_API_USER")!;
const BIMS_API_PASSWORD = Deno.env.get("BIMS_API_PASSWORD")!;

async function getBimsSession(): Promise<BimsSession> {
  // Reuse cached session if still valid (5 min buffer)
  if (cachedSession && cachedSession.expiresAt > Date.now() + 300_000) {
    return cachedSession;
  }

  const passwordMd5 = md5(BIMS_API_PASSWORD);

  const response = await fetch(`${BIMS_API_URL}/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: BIMS_API_USER,
      password: passwordMd5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BIMS login failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  const token = data?.token || data?.session || data?.access_token || data?.data?.token || data?.data?.access_token;
  if (token) {
    cachedSession = {
      authType: "bearer",
      credential: String(token),
      expiresAt: Date.now() + 3_600_000,
    };
    return cachedSession;
  }

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cachedSession = {
      authType: "cookie",
      credential: setCookie.split(",")[0],
      expiresAt: Date.now() + 3_600_000,
    };
    return cachedSession;
  }

  throw new Error(`BIMS login did not return token/cookie. Response: ${JSON.stringify(data)}`);
}

async function bimsRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const session = await getBimsSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (session.authType === "bearer") {
    headers["Authorization"] = `Bearer ${session.credential}`;
  } else {
    headers["Cookie"] = session.credential;
  }

  const options: RequestInit = { method, headers };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, options);

  // If auth error, try re-auth once
  if (response.status === 401 || response.status === 403) {
    cachedSession = null;
    const newSession = await getBimsSession();
    if (newSession.authType === "bearer") {
      headers["Authorization"] = `Bearer ${newSession.credential}`;
      delete headers["Cookie"];
    } else {
      headers["Cookie"] = newSession.credential;
      delete headers["Authorization"];
    }
    const retry = await fetch(url, { ...options, headers });
    if (!retry.ok) {
      const errorText = await retry.text();
      throw new Error(`BIMS request failed after re-auth: ${retry.status} - ${errorText}`);
    }
    const retryPayload = await retry.json();
    if (retryPayload?.status === "error") {
      throw new Error(`BIMS business error after re-auth: ${retryPayload.code ?? "unknown"} - ${retryPayload.message ?? "Unknown error"}`);
    }
    return retryPayload;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BIMS request failed: ${response.status} - ${errorText}`);
  }

  const payload = await response.json();
  if (payload?.status === "error") {
    throw new Error(`BIMS business error: ${payload.code ?? "unknown"} - ${payload.message ?? "Unknown error"}`);
  }

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Create supabase client for DB operations (no auth required)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let result: unknown;

    switch (action) {
      case "test-connection": {
        await getBimsSession();
        result = { success: true, message: "BIMS connection successful" };
        break;
      }

      case "get-products": {
        const page = url.searchParams.get("page") || "1";
        const limit = url.searchParams.get("limit") || "100";
        result = await bimsRequest("GET", `/products?page=${page}&limit=${limit}`);
        break;
      }

      case "get-product": {
        const productId = url.searchParams.get("product_id");
        if (!productId) throw new Error("product_id required");
        result = await bimsRequest("GET", `/products/${productId}`);
        break;
      }

      case "get-warehouses": {
        result = await bimsRequest("GET", `/warehouses`);
        break;
      }

      case "get-contacts": {
        const page = url.searchParams.get("page") || "1";
        const limit = url.searchParams.get("limit") || "100";
        result = await bimsRequest("GET", `/contacts?page=${page}&limit=${limit}`);
        break;
      }

      case "get-transfers": {
        const warehouseId = url.searchParams.get("warehouse_id");
        if (!warehouseId) throw new Error("warehouse_id required");
        result = await bimsRequest("GET", `/invtransferences?warehouse_id=${warehouseId}`);
        break;
      }

      case "get-transfer": {
        const transferId = url.searchParams.get("transfer_id");
        if (!transferId) throw new Error("transfer_id required");
        result = await bimsRequest("GET", `/invtransferences/${transferId}`);
        break;
      }

      case "get-sales": {
        const warehouseId = url.searchParams.get("warehouse_id");
        if (!warehouseId) throw new Error("warehouse_id required");
        result = await bimsRequest("GET", `/sales?warehouse_id=${warehouseId}`);
        break;
      }

      case "get-stock": {
        const warehouseId = url.searchParams.get("warehouse_id");
        if (!warehouseId) throw new Error("warehouse_id required");
        result = await bimsRequest("GET", `/stock?warehouse_id=${warehouseId}`);
        break;
      }

      case "sync-products": {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const PRODUCT_PAGE_SIZE = 250;
        let page = 1;
        let totalSynced = 0;
        let hasMore = true;

        while (hasMore) {
          const products = await bimsRequest("GET", `/products?page=${page}&limit=${PRODUCT_PAGE_SIZE}`) as any;
          const items = extractArray(products);

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          const mapped = Array.from(
            new Map(
              items
                .map((product: any) => normalizeProduct(product))
                .filter((product): product is NormalizedProduct => product !== null)
                .map((product) => [product.bims_code, product])
            ).values()
          );

          if (mapped.length > 0) {
            const { error } = await adminClient.from("products").upsert(mapped, {
              onConflict: "bims_code",
            });

            if (error) {
              throw new Error(`Products page ${page} upsert failed: ${error.message}`);
            }

            totalSynced += mapped.length;
          }

          page++;
          if (items.length < PRODUCT_PAGE_SIZE) hasMore = false;
        }

        result = { success: true, synced: totalSynced };
        break;
      }

      case "sync-warehouses": {
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const warehouses = await bimsRequest("GET", `/warehouses`) as any;
        const items = extractArray(warehouses);
        
        let synced = 0;
        for (const w of items) {
          const normalized = normalizeWarehouse(w);
          if (!normalized) continue;

          const { data: existing } = await adminClient
            .from("branches")
            .select("id")
            .eq("code", normalized.code)
            .maybeSingle();

          if (!existing) {
            // Only create if no matching branch - don't overwrite manually configured branches
            await adminClient.from("branches").insert({
              code: normalized.code,
              name: normalized.name,
              city: normalized.city,
              address: normalized.address,
            });
          }
          synced++;
        }

        result = { success: true, synced };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("BIMS proxy error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
