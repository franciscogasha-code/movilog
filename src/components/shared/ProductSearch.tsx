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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  /** Busca por código exacto (barcode / bims_code / sku) para el escáner. */
  const lookupByCode = useCallback(
    async (code: string): Promise<ProductResult[]> => {
      const select =
        "id, name, sku, bims_code, barcode, category, unit, description, image_url, sell_price, price_scales, price_lists, stock_by_warehouse, total_stock";
      const exact = await supabase
        .from("products")
        .select(select)
        .eq("is_active", true)
        .or(`barcode.eq.${code},bims_code.eq.${code},sku.eq.${code}`)
        .limit(20);

      let rows = (exact.data || []) as unknown as ProductResult[];

      if (!exact.error && rows.length === 0) {
        // Fallback: ceros a la izquierda o dígito verificador distinto en BIMS
        const suffix = code.replace(/^0+/, "");
        const loose = await supabase
          .from("products")
          .select(select)
          .eq("is_active", true)
          .or(`barcode.ilike.%${suffix},bims_code.ilike.%${suffix}`)
          .limit(20);
        rows = (loose.data || []) as unknown as ProductResult[];
      }

      return rows.filter((p) => !excludeIds.includes(p.id));
    },
    [excludeIds]
  );

  const handleDetected = useCallback(
    async (code: string) => {
      try {
        const found = await lookupByCode(code);

        if (found.length === 0) {
          notify.warning("No se encontró producto con ese código", { description: code });
          return;
        }

        if (found.length > 1) {
          setQuery(code);
          setResults(found);
          setOpen(true);
          setScannerOpen(false);
          notify.info(`${found.length} productos con ese código`, {
            description: "Elegí el correcto en la lista",
          });
          return;
        }

        const product = found[0];
        let enriched = product;
        if (product.bims_code) {
          try {
            const live = await revalidateLiveStock([product.bims_code]);
            const entry = live[product.bims_code];
            if (entry) {
              enriched = {
                ...product,
                stock_by_warehouse: entry.stock_by_warehouse,
                total_stock: entry.total_stock,
              };
            }
          } catch {
            /* stock referencial */
          }
        }
        onSelect(enriched);
        setScanCount((n) => n + 1);
        notify.success(`Agregado: ${product.name}`);
      } catch (err) {
        console.error("Barcode lookup error:", err);
        notify.error("No se pudo buscar el código", {
          description: (err as Error)?.message,
        });
      }
    },
    [lookupByCode, onSelect]
  );

  const openScanner = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      notify.warning("La cámara no está disponible en este dispositivo");
      return;
    }
    setScanCount(0);
    setScannerOpen(true);
  };


  const closeScanner = (next: boolean) => {
    setScannerOpen(next);
    if (!next && scanCount > 0) {
      notify.info(`${scanCount} producto${scanCount === 1 ? "" : "s"} agregado${scanCount === 1 ? "" : "s"}`);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-20"
        />

        {(loading || isLoadingStock) && (
          <Loader2
            className={cn(
              "absolute top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground",
              "right-12"
            )}
          />
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Escanear código de barras"
          title="Escanear código de barras"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
          onClick={openScanner}
        >
          <ScanLine className="h-4 w-4" />
        </Button>

      </div>

      <BarcodeScanner
        open={scannerOpen}
        onOpenChange={closeScanner}
        onDetected={handleDetected}
        continuous
        statusText={scanCount > 0 ? `${scanCount} agregado${scanCount === 1 ? "" : "s"}` : "Escaneo continuo"}
        onManualSearch={() => inputRef.current?.focus()}
      />


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
