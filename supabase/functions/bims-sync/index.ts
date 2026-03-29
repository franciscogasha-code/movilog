import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function md5(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("MD5", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

let cachedSession: { token: string; expiresAt: number } | null = null;

const BIMS_API_URL = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_USER = Deno.env.get("BIMS_API_USER")!;
const BIMS_API_PASSWORD = Deno.env.get("BIMS_API_PASSWORD")!;

async function getBimsSession(): Promise<string> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 300_000) {
    return cachedSession.token;
  }
  const passwordMd5 = await md5(BIMS_API_PASSWORD);
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
  const token = data.token || data.session || data.access_token || data.id;
  if (!token) throw new Error(`BIMS login response missing token: ${JSON.stringify(data)}`);
  cachedSession = { token, expiresAt: Date.now() + 3_600_000 };
  return token;
}

async function bimsRequest(method: string, path: string): Promise<unknown> {
  const token = await getBimsSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, { method, headers });
  if (response.status === 401) {
    cachedSession = null;
    const newToken = await getBimsSession();
    headers["Authorization"] = `Bearer ${newToken}`;
    const retry = await fetch(url, { method, headers });
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
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const results: Record<string, unknown> = {};

    // 1. Sync warehouses → branches
    const warehouses = await bimsRequest("GET", `/warehouses`) as any;
    const whItems = Array.isArray(warehouses) ? warehouses : warehouses?.data || warehouses?.results || [];
    let whSynced = 0;
    for (const w of whItems) {
      const code = String(w.id || w.code);
      const name = w.name || w.description || `Warehouse ${w.id}`;
      const { data: existing } = await adminClient
        .from("branches").select("id").eq("code", code).maybeSingle();
      if (!existing) {
        await adminClient.from("branches").insert({
          code, name,
          city: w.city || null,
          address: w.address || null,
        });
      }
      whSynced++;
    }
    results.warehouses = { synced: whSynced };

    // 2. Sync products
    let page = 1;
    let totalSynced = 0;
    let hasMore = true;
    while (hasMore) {
      const products = await bimsRequest("GET", `/products?page=${page}&limit=100`) as any;
      const items = Array.isArray(products) ? products : products?.data || products?.results || [];
      if (items.length === 0) { hasMore = false; break; }
      for (const p of items) {
        const bims_code = String(p.id || p.code || p.product_id);
        const mapped = {
          bims_code,
          name: p.name || p.description || `Product ${p.id}`,
          sku: p.sku || p.code || null,
          category: p.category || p.group || null,
          unit: p.unit || p.measure_unit || 'UN',
          is_active: p.active !== false && p.status !== 'inactive',
        };
        const { data: existing } = await adminClient
          .from("products").select("id").eq("bims_code", bims_code).maybeSingle();
        if (existing) {
          await adminClient.from("products")
            .update({ name: mapped.name, sku: mapped.sku, category: mapped.category, unit: mapped.unit, is_active: mapped.is_active })
            .eq("id", existing.id);
        } else {
          await adminClient.from("products").insert(mapped);
        }
        totalSynced++;
      }
      page++;
      if (items.length < 100) hasMore = false;
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
