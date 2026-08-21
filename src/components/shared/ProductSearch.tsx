import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, Loader2, Zap, Clock, ScanLine } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLiveStock } from "@/hooks/use-live-stock";
import { BarcodeScanner } from "@/components/shared/BarcodeScanner";
import { notify } from "@/lib/notify";
import { revalidateLiveStock } from "@/hooks/use-live-stock";


export type ProductResult = {
  id: string;
  name: string;
  sku: string | null;
  bims_code: string | null;
  barcode: string | null;
  category: string | null;
  unit: string | null;
  description: string | null;
  image_url: string | null;
  sell_price: number | null;
  price_scales: unknown;
  price_lists: unknown;
  stock_by_warehouse: Record<string, number> | null;
  total_stock: number | null;
};

interface ProductSearchProps {
  onSelect: (product: ProductResult) => void;
  placeholder?: string;
  className?: string;
  excludeIds?: string[];
}

function SearchThumbnail({ url, name }: { url?: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const safeUrl = url ? proxyImageUrl(url) : null;
  if (safeUrl && !failed) {
    return (
      <img
        src={safeUrl}
        alt={name}
        className="h-8 w-8 rounded object-cover shrink-0 border border-border"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
      <Package className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

export function ProductSearch({ onSelect, placeholder = "Buscar producto por nombre, código, SKU o código de barras...", className, excludeIds = [] }: ProductSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (term: string) => {
    if (term.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const likeTerm = `%${term}%`;
      
      const orFilters = [
        `name.ilike.${likeTerm}`,
        `sku.ilike.${likeTerm}`,
        `bims_code.ilike.${likeTerm}`,
        `barcode.ilike.${likeTerm}`,
      ];
      
      if (/^\d{3,4}$/.test(term)) {
        orFilters.push(`barcode.ilike.%${term}`);
      }

      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, bims_code, barcode, category, unit, description, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock")
        .eq("is_active", true)
        .or(orFilters.join(","))
        .limit(20);

      if (error) throw error;
      const filtered = ((data || []) as unknown as ProductResult[]).filter(p => !excludeIds.includes(p.id));
      setResults(filtered);
      setOpen(filtered.length > 0);
    } catch (err) {
      console.error("Product search error:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [excludeIds]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Live stock from BIMS
  const bimsCodes = results.map(p => p.bims_code).filter(Boolean) as string[];
  const { liveStock, isLoadingStock, isLive } = useLiveStock(bimsCodes);

  // Merge live stock into results for display
  const enrichedResults = results.map(p => {
    if (isLive && p.bims_code && liveStock?.[p.bims_code]) {
      const live = liveStock[p.bims_code];
      return { ...p, stock_by_warehouse: live.stock_by_warehouse, total_stock: live.total_stock };
    }
    return p;
  });

  const handleSelect = (product: ProductResult) => {
    // Pass the enriched (live) version to the consumer
    const enriched = enrichedResults.find(p => p.id === product.id) || product;
    onSelect(enriched);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9"
        />
        {(loading || isLoadingStock) && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-[300px] overflow-y-auto">
          {/* Live stock indicator */}
          {results.length > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-b border-border/30 bg-muted/20">
              {isLive ? (
                <><Zap className="h-3 w-3 text-green-500" /><span className="text-green-600 font-medium">Stock en vivo</span></>
              ) : isLoadingStock ? (
                <><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Consultando stock...</span></>
              ) : (
                <><Clock className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Stock sincronizado</span></>
              )}
            </div>
          )}
          {enrichedResults.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left text-sm hover:bg-accent/10 transition-colors border-b border-border/30 last:border-0"
              onClick={() => handleSelect(p)}
            >
              <SearchThumbnail url={p.image_url} name={p.name} />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.sku && <span>SKU: {p.sku}</span>}
                  {p.bims_code && <span className="ml-2">Cód: {p.bims_code}</span>}
                  {p.barcode && <span className="ml-2">CB: {p.barcode}</span>}
                  {p.category && <span className="ml-2">• {p.category}</span>}
                </p>
              </div>
              <span className={cn(
                "text-xs font-medium shrink-0 tabular-nums",
                p.total_stock != null && p.total_stock > 0 ? "text-foreground" : "text-destructive"
              )}>
                x{p.total_stock != null ? Math.floor(p.total_stock) : 0}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
