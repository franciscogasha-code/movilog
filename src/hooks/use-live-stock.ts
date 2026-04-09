import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LiveStockData = Record<string, { stock_by_warehouse: Record<string, number>; total_stock: number }>;

async function fetchLiveStock(bimsCodes: string[]): Promise<LiveStockData> {
  if (!bimsCodes.length) return {};

  const { data, error } = await supabase.functions.invoke("bims-stock-live", {
    body: { bims_codes: bimsCodes },
  });

  if (error) {
    console.error("Live stock fetch error:", error);
    return {};
  }

  return (data as LiveStockData) || {};
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
