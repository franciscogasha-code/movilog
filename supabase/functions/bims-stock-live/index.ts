import { Md5 } from "https://deno.land/std@0.95.0/hash/md5.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

  throw new Error("BIMS login did not return token/cookie.");
}

async function bimsGet(path: string): Promise<unknown> {
  const session = await getBimsSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session.authType === "bearer") headers["Authorization"] = `Bearer ${session.credential}`;
  else headers["Cookie"] = session.credential;

  const url = `${BIMS_API_URL}${path}`;
  const response = await fetch(url, { method: "GET", headers });

  if (response.status === 401 || response.status === 403) {
    cachedSession = null;
    const newSession = await getBimsSession();
    if (newSession.authType === "bearer") { headers["Authorization"] = `Bearer ${newSession.credential}`; delete headers["Cookie"]; }
    else { headers["Cookie"] = newSession.credential; delete headers["Authorization"]; }
    const retry = await fetch(url, { method: "GET", headers });
    if (!retry.ok) throw new Error(`BIMS request failed after re-auth: ${retry.status}`);
    return await retry.json();
  }

  if (!response.ok) throw new Error(`BIMS request failed: ${response.status}`);
  return await response.json();
}

function extractAvailability(raw: any): { stock_by_warehouse: Record<string, number>; total_stock: number } {
  const item = raw?.Product ?? raw?.product ?? raw;
  const availability = item?.Availability ?? raw?.Availability ?? {};
  const stock_by_warehouse: Record<string, number> = {};
  let total_stock = 0;

  if (typeof availability === "object" && availability !== null) {
    for (const [whId, qty] of Object.entries(availability)) {
      const numQty = parseFloat(String(qty));
      if (!isNaN(numQty)) {
        stock_by_warehouse[whId] = numQty;
        total_stock += numQty;
      }
    }
  }

  return { stock_by_warehouse, total_stock };
}

function extractArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const bimsCodes: string[] = body?.bims_codes;

    if (!Array.isArray(bimsCodes) || bimsCodes.length === 0) {
      return new Response(JSON.stringify({ error: "bims_codes array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (bimsCodes.length > 20) {
      return new Response(JSON.stringify({ error: "Max 20 codes per request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: Record<string, { stock_by_warehouse: Record<string, number>; total_stock: number }> = {};

    // Fetch each product individually. Try /products/{id} first, fall back to /products?id={id}
    const promises = bimsCodes.map(async (code) => {
      try {
        let data: any;
        try {
          data = await bimsGet(`/products/${code}`);
        } catch {
          // Fallback: try query param approach
          data = await bimsGet(`/products?id=${code}`);
        }
        
        // Handle array or single response
        const items = extractArray(data);
        if (items.length > 0) {
          result[code] = extractAvailability(items[0]);
        } else if (data && typeof data === "object") {
          const stock = extractAvailability(data);
          if (stock.total_stock > 0 || Object.keys(stock.stock_by_warehouse).length > 0) {
            result[code] = stock;
          }
        }
      } catch (err) {
        console.error(`Failed to fetch stock for ${code}:`, err);
      }
    });

    await Promise.all(promises);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("bims-stock-live error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
