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

let cachedSession: BimsSession | null = null;

const BIMS_API_URL = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_USER = Deno.env.get("BIMS_API_USER")!;
const BIMS_API_PASSWORD = Deno.env.get("BIMS_API_PASSWORD")!;

async function getBimsSession(): Promise<BimsSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 300_000) {
    return cachedSession;
  }

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

  throw new Error(`BIMS login did not return token/cookie. Response: ${JSON.stringify(data)}`);
}

async function bimsRequest(method: string, path: string): Promise<unknown> {
  const session = await getBimsSession();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session.authType === "bearer") {
    headers["Authorization"] = `Bearer ${session.credential}`;
  } else {
    headers["Cookie"] = session.credential;
  }

  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, { method, headers });
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
