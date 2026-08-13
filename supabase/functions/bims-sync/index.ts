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

interface SyncStats {
  total_received: number;
  total_processed: number;
  total_inserted: number;
  total_updated: number;
  total_failed: number;
  total_skipped: number;
  errors: { code: string; message: string; stage: string; timestamp: string }[];
}

function newStats(): SyncStats {
  return { total_received: 0, total_processed: 0, total_inserted: 0, total_updated: 0, total_failed: 0, total_skipped: 0, errors: [] };
}

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

let LABEL_MAP: Record<string, string> = {};
let LABEL_MAP_AT = 0;

export async function loadLabelMap(): Promise<Record<string, string>> {
  if (Date.now() - LABEL_MAP_AT < 10 * 60 * 1000 && Object.keys(LABEL_MAP).length) return LABEL_MAP;
  const map: Record<string, string> = {};
  let offset = 0;
  while (true) {
    const payload = await bimsRequest("GET", `/labels?offset=${offset}&limit=250`) as any;
    const items = extractArray(payload);
    if (items.length === 0) break;
    for (const it of items) {
      const l = it?.Label ?? it?.label ?? it;
      const id = toText(l?.id);
      const name = toText(l?.name);
      if (id && name) map[id] = name.toUpperCase();
    }
    if (items.length < 250) break;
    offset += 250;
  }
  LABEL_MAP = map;
  LABEL_MAP_AT = Date.now();
  return map;
}

function normalizeProduct(raw: any): (any & { _bims_active: boolean }) | null {
  try {
    const item = raw?.Product ?? raw?.product ?? raw;
    const bimsCode = toText(item?.id ?? item?._id ?? item?.product_id ?? raw?.id ?? raw?.product_id ?? raw?._id);
    if (!bimsCode) return null;

    const name = toText(item?.name ?? item?.description ?? raw?.name ?? raw?.description);
    if (!name) return null;

    const status = toText(item?.status ?? raw?.status)?.toLowerCase();
    const enabledValue = item?.enabled ?? item?.active ?? raw?.enabled ?? raw?.active;

    const isActive = enabledValue !== false && enabledValue !== 0 && enabledValue !== "0" && status !== "inactive" && status !== "disabled";

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

    const unit = toText(item?.um_id ?? item?.unit ?? item?.measure_unit ?? raw?.um_id ?? raw?.unit ?? raw?.measure_unit) ?? "UN";
    if (unit.length > 20) return null;

    return {
      _bims_active: isActive,
      bims_code: bimsCode,
      name,
      sku,
      barcode,
      category: toText(raw?.Ptype?.name ?? raw?.ptype?.name ?? item?.category ?? item?.group ?? raw?.category ?? raw?.group),
      bims_label_id: toText(item?.label_id ?? raw?.label_id),
      brand: LABEL_MAP[String(toText(item?.label_id ?? raw?.label_id) ?? "")] ?? null,
      unit,
      is_active: isActive,
      description,
      image_url: imageUrl,
      sell_price: isNaN(sellPrice as number) ? null : sellPrice,
      buy_price: isNaN(buyPrice as number) ? null : buyPrice,
      price_scales: priceScales,
      price_lists: priceLists,
      stock_by_warehouse: stockByWarehouse,
      total_stock: totalStock,
    };
  } catch {
    return null;
  }
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


// BIMS no expone un campo de marca: se deriva del último token del nombre

// Anomaly threshold: if more than this % of products would be deactivated, require confirmation
const DEACTIVATION_THRESHOLD_PERCENT = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const action = url.searchParams.get("action");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const limit = parseInt(url.searchParams.get("limit") || "100");

  const syncStartTime = Date.now();
  const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // ── Deactivate missing products (called after full sync completes) ──
    if (entity === "products" && action === "deactivate_missing") {
      const body = await req.json();
      const activeBimsCodes: string[] = body.active_bims_codes || [];
      const forceConfirmed: boolean = body.force_confirmed === true;
      const syncCompleted: boolean = body.sync_completed === true;
      const totalPagesProcessed: number = body.total_pages_processed || 0;
      const totalErrors: number = body.total_errors || 0;

      // CRITICAL VALIDATION 1: Sync must have completed successfully
      if (!syncCompleted) {
        return new Response(JSON.stringify({
          success: false,
          error: "Sincronización incompleta. No se ejecuta desactivación para proteger datos.",
          reason: "sync_incomplete",
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // CRITICAL VALIDATION 2: There must have been no page errors
      if (totalErrors > 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `Sincronización tuvo ${totalErrors} error(es). No se ejecuta desactivación.`,
          reason: "sync_had_errors",
        }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // CRITICAL VALIDATION 3: Must have bims codes
      if (!activeBimsCodes.length) {
        return new Response(JSON.stringify({ success: false, error: "No bims codes provided" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get all active products from DB
      const { data: allActive, error: fetchErr } = await adminClient
        .from("products")
        .select("id, bims_code")
        .eq("is_active", true)
        .not("bims_code", "is", null);

      if (fetchErr) throw fetchErr;

      const activeSet = new Set(activeBimsCodes);
      const toDeactivate = (allActive || [])
        .filter(p => p.bims_code && !activeSet.has(p.bims_code));

      // CRITICAL VALIDATION 4: Anomaly threshold protection
      const totalCurrentActive = allActive?.length || 0;
      const deactivateCount = toDeactivate.length;
      const deactivatePercent = totalCurrentActive > 0 ? (deactivateCount / totalCurrentActive) * 100 : 0;

      if (deactivatePercent > DEACTIVATION_THRESHOLD_PERCENT && !forceConfirmed) {
        // Log the blocked attempt
        await adminClient.from("sync_logs").insert({
          entity: "products",
          status: "blocked",
          total_received: activeBimsCodes.length,
          total_processed: 0,
          total_updated: 0,
          completed_at: new Date().toISOString(),
          duration_seconds: (Date.now() - syncStartTime) / 1000,
          triggered_by: "deactivate_blocked_threshold",
          errors: [{
            code: "THRESHOLD",
            message: `${deactivateCount} de ${totalCurrentActive} productos (${deactivatePercent.toFixed(1)}%) superan umbral de ${DEACTIVATION_THRESHOLD_PERCENT}%`,
            stage: "validation",
            timestamp: new Date().toISOString(),
          }],
        });

        return new Response(JSON.stringify({
          success: false,
          reason: "threshold_exceeded",
          total_to_deactivate: deactivateCount,
          total_current_active: totalCurrentActive,
          deactivate_percent: Math.round(deactivatePercent * 10) / 10,
          threshold_percent: DEACTIVATION_THRESHOLD_PERCENT,
          requires_confirmation: true,
          products_to_deactivate: toDeactivate.slice(0, 50).map(p => ({ bims_code: p.bims_code })),
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Execute deactivation in batches
      let totalDeactivated = 0;
      const BATCH = 500;
      const deactivatedProducts: { bims_code: string; id: string }[] = [];

      for (let i = 0; i < toDeactivate.length; i += BATCH) {
        const batch = toDeactivate.slice(i, i + BATCH);
        const batchIds = batch.map(p => p.id);
        const { error } = await adminClient
          .from("products")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", batchIds);
        if (error) throw error;
        totalDeactivated += batch.length;
        deactivatedProducts.push(...batch.map(p => ({ bims_code: p.bims_code!, id: p.id })));
      }

      // Detailed log of deactivation
      await adminClient.from("sync_logs").insert({
        entity: "products",
        status: "success",
        total_received: activeBimsCodes.length,
        total_processed: totalDeactivated,
        total_updated: totalDeactivated,
        completed_at: new Date().toISOString(),
        duration_seconds: (Date.now() - syncStartTime) / 1000,
        triggered_by: forceConfirmed ? "deactivate_confirmed" : "deactivate_auto",
        errors: deactivatedProducts.slice(0, 200).map(p => ({
          code: p.bims_code,
          message: "Baja lógica: producto no presente en BIMS activos",
          stage: "deactivation",
          timestamp: new Date().toISOString(),
        })),
      });

      return new Response(JSON.stringify({
        success: true,
        total_deactivated: totalDeactivated,
        total_active_from_bims: activeBimsCodes.length,
        deactivated_bims_codes: deactivatedProducts.slice(0, 100).map(p => p.bims_code),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Warehouses only ──
    if (entity === "warehouses") {
      const stats = newStats();
      try {
        const warehouses = await bimsRequest("GET", `/warehouses`) as any;
        const whItems = extractArray(warehouses);
        stats.total_received = whItems.length;

        for (const w of whItems) {
          try {
            const normalized = normalizeWarehouse(w);
            if (!normalized || !normalized.code) { stats.total_skipped++; continue; }

            const { data: existing } = await adminClient.from("branches").select("id").eq("code", normalized.code).maybeSingle();
            if (existing) {
              stats.total_updated++;
            } else {
              const { error } = await adminClient.from("branches").insert({
                code: normalized.code, name: normalized.name,
                city: normalized.city ? String(normalized.city) : null,
                address: normalized.address ? String(normalized.address) : null,
              });
              if (error) throw error;
              stats.total_inserted++;
            }
            stats.total_processed++;
          } catch (e: any) {
            stats.total_failed++;
            stats.errors.push({ code: String(w?.code ?? w?.id ?? "unknown"), message: e.message, stage: "upsert", timestamp: new Date().toISOString() });
          }
        }
      } catch (e: any) {
        stats.total_failed = -1;
        stats.errors.push({ code: "GLOBAL", message: e.message, stage: "fetch", timestamp: new Date().toISOString() });
      }

      const duration = (Date.now() - syncStartTime) / 1000;
      await adminClient.from("sync_logs").insert({
        entity: "warehouses",
        status: stats.total_failed > 0 ? (stats.total_processed > 0 ? "partial" : "error") : "success",
        ...stats,
        errors: stats.errors.slice(0, 50),
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
      });

      return new Response(JSON.stringify({ success: true, entity: "warehouses", stats, duration_seconds: duration }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Products: single page (ONLY ACTIVE products are synced) ──
    if (entity === "products") {
      const stats = newStats();
      let hasMore = true;
      let bimsTotalCount: number | null = null;
      const activeBimsCodes: string[] = [];
      let totalInactiveSkipped = 0;

      try {
        await loadLabelMap().catch(() => ({}));
        const products = await bimsRequest("GET", `/products?offset=${offset}&limit=${limit}`) as any;
        const items = extractArray(products);
        stats.total_received = items.length;
        if (items.length < limit) hasMore = false;
        if (items.length === 0) hasMore = false;

        const rawTotal = products?.total ?? products?.total_count ?? products?.count
          ?? products?.data?.total ?? products?.data?.total_count ?? products?.data?.count
          ?? products?.meta?.total ?? products?.meta?.total_count
          ?? products?.pagination?.total ?? products?.pagination?.total_items;
        if (rawTotal != null && !isNaN(Number(rawTotal))) {
          bimsTotalCount = Number(rawTotal);
        }

        const batchMap = new Map<string, any>();
        for (const raw of items) {
          try {
            const normalized = normalizeProduct(raw);
            if (!normalized) { stats.total_skipped++; continue; }
            if (!normalized.bims_code || !normalized.name) {
              stats.total_skipped++;
              stats.errors.push({ code: String(raw?.id ?? "unknown"), message: "Missing mandatory fields", stage: "validation", timestamp: new Date().toISOString() });
              continue;
            }

            if (!normalized._bims_active) {
              totalInactiveSkipped++;
              stats.total_skipped++;
              continue;
            }

            const { _bims_active, ...productData } = normalized;
            activeBimsCodes.push(productData.bims_code);
            batchMap.set(productData.bims_code, productData);
          } catch (e: any) {
            stats.total_failed++;
            stats.errors.push({ code: String(raw?.id ?? "unknown"), message: e.message, stage: "transform", timestamp: new Date().toISOString() });
          }
        }

        const batch = Array.from(batchMap.values());
        if (batch.length > 0) {
          const bimsCodes = batch.map(p => p.bims_code);
          const { data: existing } = await adminClient.from("products").select("bims_code").in("bims_code", bimsCodes);
          const existingSet = new Set(existing?.map(e => e.bims_code) || []);

          const { error } = await adminClient.from("products").upsert(batch, { onConflict: "bims_code" });
          if (error) {
            for (const product of batch) {
              try {
                const { error: singleErr } = await adminClient.from("products").upsert(product, { onConflict: "bims_code" });
                if (singleErr) throw singleErr;
                if (existingSet.has(product.bims_code)) stats.total_updated++;
                else stats.total_inserted++;
                stats.total_processed++;
              } catch (e: any) {
                stats.total_failed++;
                stats.errors.push({ code: product.bims_code, message: e.message, stage: "upsert", timestamp: new Date().toISOString() });
              }
            }
          } else {
            for (const p of batch) {
              if (existingSet.has(p.bims_code)) stats.total_updated++;
              else stats.total_inserted++;
            }
            stats.total_processed += batch.length;
          }
        }
      } catch (e: any) {
        stats.errors.push({ code: "GLOBAL", message: e.message, stage: "fetch", timestamp: new Date().toISOString() });
      }

      const duration = (Date.now() - syncStartTime) / 1000;
      const status = stats.total_failed > 0
        ? (stats.total_processed > 0 ? "partial" : "error")
        : "success";

      await adminClient.from("sync_logs").insert({
        entity: "products",
        status,
        ...stats,
        errors: stats.errors.slice(0, 100),
        completed_at: new Date().toISOString(),
        duration_seconds: duration,
        triggered_by: `offset_${offset}`,
      });

      return new Response(JSON.stringify({
        success: true,
        entity: "products",
        offset,
        limit,
        has_more: hasMore,
        stats,
        duration_seconds: duration,
        active_bims_codes: activeBimsCodes,
        total_inactive_skipped: totalInactiveSkipped,
        ...(bimsTotalCount != null ? { bims_total_count: bimsTotalCount } : {}),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── No matching entity ──
    return new Response(JSON.stringify({ error: "Unknown entity. Use ?entity=products or ?entity=warehouses" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("BIMS sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
