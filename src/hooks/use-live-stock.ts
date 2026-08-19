import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LiveStockData = Record<string, { stock_by_warehouse: Record<string, number>; total_stock: number }>;

const CHUNK_SIZE = 20;
/** Tiempo máximo de espera por lote. Si BIMS no responde, caemos al stock sincronizado. */
const BATCH_TIMEOUT_MS = 8_000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function fetchBatch(batch: string[]): Promise<LiveStockData> {
  try {
    const { data, error } = await supabase.functions.invoke("bims-stock-live", {
      body: { bims_codes: batch },
    });
    if (error) {
      console.warn("Stock en vivo no disponible (lote):", error?.message ?? error);
      return {};
    }
    return (data as LiveStockData) || {};
  } catch (err) {
    console.warn("Stock en vivo no disponible (lote):", err);
    return {};
  }
}

async function fetchLiveStock(bimsCodes: string[]): Promise<LiveStockData> {
  if (!bimsCodes.length) return {};

  const batches = chunk(bimsCodes, CHUNK_SIZE);

  // Nunca propagamos el error: si BIMS falla o tarda, devolvemos parcial/vacío
  // y la UI usa el stock sincronizado (referencial).
  const results = await Promise.all(
    batches.map((batch) => withTimeout(fetchBatch(batch), BATCH_TIMEOUT_MS, {} as LiveStockData))
  );

  return results.reduce<LiveStockData>((acc, part) => Object.assign(acc, part), {});
}

/**
 * Hook to fetch real-time stock from BIMS for a list of product bims_codes.
 * Returns a map of bims_code -> { stock_by_warehouse, total_stock }.
 * Falls back silently to empty (local data should be used as fallback).
 */
export function useLiveStock(bimsCodes: string[]) {
  // Filter out nulls/empty and deduplicate
  const validCodes = [...new Set(bimsCodes.filter(Boolean))];
  const queryKey = ["live-stock", ...validCodes.sort()];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => fetchLiveStock(validCodes),
    enabled: validCodes.length > 0,
    staleTime: 30_000, // 30s cache
    gcTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return {
    liveStock: data || null,
    isLoadingStock: isLoading && validCodes.length > 0,
    isLive: !!data && !isError && Object.keys(data).length > 0,
  };
}

/**
 * Direct function to revalidate stock from BIMS (for pre-submit checks).
 * Not a hook — call imperatively.
 */
export async function revalidateLiveStock(bimsCodes: string[]): Promise<LiveStockData> {
  const validCodes = [...new Set(bimsCodes.filter(Boolean))];
  if (!validCodes.length) return {};
  return fetchLiveStock(validCodes);
}
