import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

type NormalizedProduct = {
  bims_code: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  is_active: boolean;
  description: string | null;
  image_url: string | null;
  sell_price: number | null;
  buy_price: number | null;
  price_scales: any[];
  price_lists: any[];
  stock_by_warehouse: Record<string, number>;
  total_stock: number;
};

type NormalizedContact = {
  bims_contact_id: string;
  name: string;
  ruc: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  price_list_id: string | null;
  price_list_name: string | null;
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
  if (Array.isArray(payload?.contacts)) return payload.contacts;
  if (Array.isArray(payload?.Contacts)) return payload.Contacts;
  if (Array.isArray(payload?.data?.contacts)) return payload.data.contacts;
  if (Array.isArray(payload?.data?.Contacts)) return payload.data.Contacts;
  return [];
}

function normalizeWarehouse(raw: any) {
  const item = raw?.Warehouse ?? raw?.warehouse ?? raw;
  const idLike =
    item?.id ?? item?.warehouse_id ?? item?.code ?? item?.codigo ??
    raw?.id ?? raw?.warehouse_id ?? raw?.code ?? raw?.codigo;

  if (idLike === undefined || idLike === null || String(idLike).trim() === "") return null;

  const code = String(item?.code ?? item?.codigo ?? idLike).trim();
  if (!code || code.toLowerCase() === "undefined" || code.toLowerCase() === "null") return null;

  const name = String(
    item?.name ?? item?.description ?? item?.nombre ?? raw?.name ?? raw?.description ?? raw?.nombre ?? `Warehouse ${code}`
  ).trim();

  return {
    code,
    name: name || `Warehouse ${code}`,
    city: item?.city ?? item?.ciudad ?? raw?.city ?? raw?.ciudad ?? null,
    address: item?.address ?? item?.direccion ?? raw?.address ?? raw?.direccion ?? null,
  };
}

function normalizeProduct(raw: any): NormalizedProduct | null {
  const item = raw?.Product ?? raw?.product ?? raw;

  const bimsCode = toText(
    item?.id ?? item?._id ?? item?.product_id ??
    raw?.id ?? raw?.product_id ?? raw?._id
  );
  if (!bimsCode) return null;

  const status = toText(item?.status ?? raw?.status)?.toLowerCase();
  const enabledValue = item?.enabled ?? item?.active ?? raw?.enabled ?? raw?.active;

  // Extract barcode from code/code2
  const code1 = toText(item?.code ?? raw?.code);
  const code2 = toText(item?.code2 ?? raw?.code2);
  const barcode = code1 || code2 || null;
  const sku = code2 || code1 || null;

  // Extract description from notes
  const description = toText(item?.notes ?? raw?.notes);

  // Extract image
  const imageUrl = toText(item?.image_url ?? item?.image ?? raw?.image_url ?? raw?.image);

  // Extract prices
  const sellPrice = item?.sell_price != null ? parseFloat(String(item.sell_price)) : null;
  const buyPrice = item?.buy_price != null ? parseFloat(String(item.buy_price)) : null;

  // Extract price scales (Qprice)
  const qprices = item?.Qprice ?? raw?.Qprice ?? [];
  const priceScales = Array.isArray(qprices) ? qprices.map((q: any) => ({
    min_quantity: parseFloat(String(q.min_quantity || 0)),
    price: parseFloat(String(q.price || 0)),
  })) : [];

  // Extract price lists (ProductsPricing)
  const pricings = item?.ProductsPricing ?? raw?.ProductsPricing ?? [];
  const priceLists = Array.isArray(pricings) ? pricings.map((p: any) => ({
    name: p?.Pricing?.name || `Lista ${p?.pricing_id}`,
    amount: parseFloat(String(p?.amount || 0)),
    pricing_id: p?.pricing_id,
  })) : [];

  // Extract stock by warehouse (Availability)
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

  // Category from Ptype
  const category = toText(raw?.Ptype?.name ?? raw?.ptype?.name ?? item?.category ?? item?.group ?? raw?.category ?? raw?.group);


// BIMS no expone marca: se deriva del último token del nombre del producto.
const BRAND_STOPWORDS = new Set(["ALTO","AMARILLA","AMARILLO","AZUL","BAJO","BEIGE","BLANCA","BLANCO","BOLSA","BRILLO","CAJA","CELESTE","CENTIMETROS","CHICA","CHICO","CLARA","CLARO","COLOR","COLORES","CORAL","CORTO","CREMA","CUADRADO","DOBLE","DORADA","DORADO","FINO","FUCSIA","GRAMOS","GRANDE","GRIS","GRUESO","JUEGO","KILO","KILOS","KRAFT","LARGO","LILA","LISO","LITRO","LITROS","LUJO","MARRON","MATE","MEDIANA","MEDIANO","MENTA","METRO","METROS","MODELO","NARANJA","NATURAL","NEGRA","NEGRO","OLIVA","OSCURA","OSCURO","PACK","PARA","PARES","PEQUENA","PEQUENO","PEQUEÑA","PEQUEÑO","PIEZAS","PLAST","PLASTICA","PLASTICO","PLATA","PLATEADA","PLATEADO","PURPURA","REDONDO","REF","ROJA","ROJO","ROLLO","ROSA","ROSADA","ROSADO","SALMON","SET","SIMPLE","SURTIDA","SURTIDAS","SURTIDO","SURTIDOS","TAPA","TEJA","TIFFANY","TIPO","TRANSP","TRANSPARENTE","TURQUESA","UNID","UNIDAD","UNIDADES","VERDE","VINO","VIOLETA"]);

function deriveBrand(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = String(name).toUpperCase().replace(/[/,()]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0 && i >= tokens.length - 3; i--) {
    const t = tokens[i].replace(/[.\-]+$/, "");
    if (t.length < 4) continue;
    if (/[0-9]/.test(t)) continue;
    if (!/^[A-ZÁÉÍÓÚÑ&.\-]+$/.test(t)) continue;
    if (BRAND_STOPWORDS.has(t)) continue;
    return t;
  }
  return null;
}

  // Brand
  const brand = deriveBrand(
    toText(item?.name ?? item?.description ?? raw?.name ?? raw?.description)
  );

  // Unit
  const unit = toText(item?.um_id ?? item?.unit ?? item?.measure_unit ?? raw?.um_id ?? raw?.unit ?? raw?.measure_unit) ?? "UN";

  return {
    bims_code: bimsCode,
    name: toText(item?.name ?? item?.description ?? raw?.name ?? raw?.description) ?? `Product ${bimsCode}`,
    sku,
    barcode,
    category,
    brand,
    unit,
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

function normalizeContact(raw: any): NormalizedContact | null {
  const item = raw?.Contact ?? raw?.contact ?? raw?.Client ?? raw?.client ?? raw;
  const bimsId = toText(item?.id ?? item?._id ?? raw?.id ?? raw?._id);
  if (!bimsId) return null;

  const name = toText(item?.name ?? item?.nombre ?? item?.business_name ?? item?.razon_social ?? raw?.name ?? raw?.business_name);
  if (!name) return null;

  const ruc = toText(item?.ruc ?? item?.tax_id ?? item?.cuit ?? item?.document ?? raw?.ruc ?? raw?.tax_id);
  const address = toText(item?.address ?? item?.direccion ?? raw?.address);
  const phone = toText(item?.phone ?? item?.telefono ?? item?.mobile ?? raw?.phone);
  const email = toText(item?.email ?? item?.correo ?? raw?.email);

  const priceList = item?.PriceList ?? item?.price_list ?? item?.Price ?? raw?.price_list ?? raw?.PriceList;
  const priceListId = toText(priceList?.id ?? priceList?.price_list_id ?? priceList?.list_id);
  const priceListName = toText(priceList?.name ?? priceList?.nombre);

  const status = toText(item?.status ?? raw?.status)?.toLowerCase();
  const isActive = status !== "inactive" && status !== "disabled" && status !== "bloqueado";

  return {
    bims_contact_id: bimsId,
    name,
    ruc,
    address,
    phone,
    email,
    price_list_id: priceListId,
    price_list_name: priceListName,
    is_active: isActive,
  };
}

let cachedSession: BimsSession | null = null;

const rawBimsUrl = Deno.env.get("BIMS_API_URL")!;
const BIMS_API_URL = rawBimsUrl.replace(/\/users\/login\/?$/i, "").replace(/\/$/, "");
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

async function bimsRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const session = await getBimsSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

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

      case "sync-brands": {
        // Marca real en BIMS = entidad Label (campo "Marca" de la ficha)
        const labelMap: Record<string, string> = {};
        let lOffset = 0;
        while (true) {
          const payload = await bimsRequest("GET", `/labels?offset=${lOffset}&limit=250`) as any;
          const items = extractArray(payload);
          if (items.length === 0) break;
          for (const it of items) {
            const l = it?.Label ?? it?.label ?? it;
            const id = l?.id != null ? String(l.id).trim() : null;
            const name = l?.name != null ? String(l.name).trim() : null;
            if (id && name) labelMap[id] = name.toUpperCase();
          }
          if (items.length < 250) break;
          lOffset += 250;
        }

        let offset = 0;
        let updated = 0;
        const PAGE = 250;
        while (true) {
          const payload = await bimsRequest("GET", `/products?offset=${offset}&limit=${PAGE}`) as any;
          const items = extractArray(payload);
          if (items.length === 0) break;

          const byBrand = new Map<string, { labelId: string | null; brand: string | null; codes: string[] }>();
          for (const raw of items) {
            const item = raw?.Product ?? raw?.product ?? raw;
            const code = item?.id != null ? String(item.id).trim() : null;
            if (!code) continue;
            const labelId = item?.label_id != null ? String(item.label_id).trim() : null;
            const brand = labelId ? labelMap[labelId] ?? null : null;
            const key = `${labelId ?? ""}|${brand ?? ""}`;
            if (!byBrand.has(key)) byBrand.set(key, { labelId, brand, codes: [] });
            byBrand.get(key)!.codes.push(code);
          }

          for (const group of byBrand.values()) {
            const { error } = await supabase
              .from("products")
              .update({ brand: group.brand, bims_label_id: group.labelId })
              .in("bims_code", group.codes);
            if (error) throw new Error(`Brand update failed: ${error.message}`);
            updated += group.codes.length;
          }

          offset += PAGE;
          if (items.length < PAGE) break;
        }

        result = { success: true, labels: Object.keys(labelMap).length, products_updated: updated };
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

      case "sync-contacts": {
        const CONTACT_PAGE_SIZE = 250;
        let offset = 0;
        let totalSynced = 0;
        let hasMore = true;

        while (hasMore) {
          const contacts = await bimsRequest("GET", `/contacts?offset=${offset}&limit=${CONTACT_PAGE_SIZE}`) as any;
          const items = extractArray(contacts);

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          const mapped = Array.from(
            new Map(
              items
                .map((contact: any) => normalizeContact(contact))
                .filter((contact): contact is NormalizedContact => contact !== null)
                .map((contact) => [contact.bims_contact_id, contact])
            ).values()
          );

          if (mapped.length > 0) {
            const { error } = await supabase.from("sales_customers").upsert(mapped, {
              onConflict: "bims_contact_id",
            });

            if (error) {
              throw new Error(`Contacts offset ${offset} upsert failed: ${error.message}`);
            }

            totalSynced += mapped.length;
          }

          offset += CONTACT_PAGE_SIZE;
          if (items.length < CONTACT_PAGE_SIZE) hasMore = false;
        }

        result = { success: true, synced: totalSynced };
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
        const PRODUCT_PAGE_SIZE = 250;
        let offset = 0;
        let totalSynced = 0;
        let hasMore = true;

        while (hasMore) {
          const products = await bimsRequest("GET", `/products?offset=${offset}&limit=${PRODUCT_PAGE_SIZE}`) as any;
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
            const { error } = await supabase.from("products").upsert(mapped, {
              onConflict: "bims_code",
            });

            if (error) {
              throw new Error(`Products offset ${offset} upsert failed: ${error.message}`);
            }

            totalSynced += mapped.length;
          }

          offset += PRODUCT_PAGE_SIZE;
          if (items.length < PRODUCT_PAGE_SIZE) hasMore = false;
        }

        result = { success: true, synced: totalSynced };
        break;
      }

      case "sync-warehouses": {
        const warehouses = await bimsRequest("GET", `/warehouses`) as any;
        const items = extractArray(warehouses);
        
        let synced = 0;
        for (const w of items) {
          const normalized = normalizeWarehouse(w);
          if (!normalized) continue;

          const { data: existing } = await supabase
            .from("branches")
            .select("id")
            .eq("code", normalized.code)
            .maybeSingle();

          if (!existing) {
            await supabase.from("branches").insert({
              code: normalized.code,
              name: normalized.name,
              city: normalized.city ? String(normalized.city) : null,
              address: normalized.address ? String(normalized.address) : null,
            });
          }
          synced++;
        }

        result = { success: true, synced };
        break;
      }

      case "test-pagination": {
        const testLimit = 3;
        const results: Record<string, { ids: string[]; count?: string }> = {};
        const formats = [
          { name: "page_1", path: `/products?page=1&limit=${testLimit}` },
          { name: "page_2", path: `/products?page=2&limit=${testLimit}` },
          { name: "page_3", path: `/products?page=3&limit=${testLimit}` },
          { name: "offset_0", path: `/products?offset=0&limit=${testLimit}` },
          { name: "offset_3", path: `/products?offset=${testLimit}&limit=${testLimit}` },
          { name: "offset_6", path: `/products?offset=${testLimit * 2}&limit=${testLimit}` },
          { name: "start_0", path: `/products?start=0&limit=${testLimit}` },
          { name: "start_3", path: `/products?start=${testLimit}&limit=${testLimit}` },
          { name: "p_1", path: `/products?p=1&limit=${testLimit}` },
          { name: "p_2", path: `/products?p=2&limit=${testLimit}` },
          { name: "index_page_2", path: `/products/index?page=2&limit=${testLimit}` },
          { name: "json_page_2", path: `/products.json?page=2&limit=${testLimit}` },
          { name: "pagina_2", path: `/products?pagina=2&limit=${testLimit}` },
          { name: "sort_id_page_2", path: `/products?page=2&limit=${testLimit}&sort=id&direction=asc` },
          { name: "order_id_page_2", path: `/products?page=2&limit=${testLimit}&order=id` },
        ];
        for (const fmt of formats) {
          try {
            const resp = await bimsRequest("GET", fmt.path) as any;
            const items = extractArray(resp);
            const ids = items.map((i: any) => {
              const p = i?.Product ?? i?.product ?? i;
              return String(p?.id ?? "?");
            });
            results[fmt.name] = { ids, count: resp?.count ?? resp?.total ?? "?" };
          } catch (e: any) {
            results[fmt.name] = { ids: [`ERROR: ${e.message}`] };
          }
        }
        result = { success: true, pagination_test: results };
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
