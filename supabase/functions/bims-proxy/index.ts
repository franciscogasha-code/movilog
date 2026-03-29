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

let cachedSession: BimsSession | null = null;

const BIMS_API_URL = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_USER = Deno.env.get("BIMS_API_USER")!;
const BIMS_API_PASSWORD = Deno.env.get("BIMS_API_PASSWORD")!;

async function getBimsSession(): Promise<string> {
  // Reuse cached session if still valid (5 min buffer)
  if (cachedSession && cachedSession.expiresAt > Date.now() + 300_000) {
    return cachedSession.token;
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
  
  // Extract token from response - adjust based on actual BIMS response structure
  const token = data.token || data.session || data.access_token || data.id;
  if (!token) {
    throw new Error(`BIMS login response missing token: ${JSON.stringify(data)}`);
  }

  // Cache for 1 hour (adjust based on actual BIMS session duration)
  cachedSession = {
    token,
    expiresAt: Date.now() + 3_600_000,
  };

  return token;
}

async function bimsRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const token = await getBimsSession();
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };

  const options: RequestInit = { method, headers };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, options);

  // If 401, try re-auth once
  if (response.status === 401) {
    cachedSession = null;
    const newToken = await getBimsSession();
    headers["Authorization"] = `Bearer ${newToken}`;
    const retry = await fetch(url, { ...options, headers });
    if (!retry.ok) {
      const errorText = await retry.text();
      throw new Error(`BIMS request failed after re-auth: ${retry.status} - ${errorText}`);
    }
    return retry.json();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BIMS request failed: ${response.status} - ${errorText}`);
  }

  return response.json();
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
        // Fetch all products from BIMS and upsert into SLIS
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        let page = 1;
        let totalSynced = 0;
        let hasMore = true;

        while (hasMore) {
          const products = await bimsRequest("GET", `/products?page=${page}&limit=100`) as any;
          const items = Array.isArray(products) ? products : products?.data || products?.results || [];
          
          if (items.length === 0) {
            hasMore = false;
            break;
          }

          const mapped = items.map((p: any) => ({
            bims_code: String(p.id || p.code || p.product_id),
            name: p.name || p.description || `Product ${p.id}`,
            sku: p.sku || p.code || null,
            category: p.category || p.group || null,
            unit: p.unit || p.measure_unit || 'UN',
            is_active: p.active !== false && p.status !== 'inactive',
          }));

          // Upsert by bims_code
          for (const product of mapped) {
            const { data: existing } = await adminClient
              .from("products")
              .select("id")
              .eq("bims_code", product.bims_code)
              .maybeSingle();

            if (existing) {
              await adminClient
                .from("products")
                .update({ name: product.name, sku: product.sku, category: product.category, unit: product.unit, is_active: product.is_active })
                .eq("id", existing.id);
            } else {
              await adminClient.from("products").insert(product);
            }
            totalSynced++;
          }

          page++;
          if (items.length < 100) hasMore = false;
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
        const items = Array.isArray(warehouses) ? warehouses : warehouses?.data || warehouses?.results || [];
        
        let synced = 0;
        for (const w of items) {
          const code = String(w.id || w.code);
          const name = w.name || w.description || `Warehouse ${w.id}`;

          const { data: existing } = await adminClient
            .from("branches")
            .select("id")
            .eq("code", code)
            .maybeSingle();

          if (!existing) {
            // Only create if no matching branch - don't overwrite manually configured branches
            await adminClient.from("branches").insert({
              code,
              name,
              city: w.city || null,
              address: w.address || null,
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
