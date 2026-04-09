import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Package, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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
      
      // Build OR filter: name, sku, bims_code, barcode (full & partial)
      // Also support last-4-digits barcode search
      const orFilters = [
        `name.ilike.${likeTerm}`,
        `sku.ilike.${likeTerm}`,
        `bims_code.ilike.${likeTerm}`,
        `barcode.ilike.${likeTerm}`,
      ];
      
      // If term is 4 digits, also match last 4 of barcode
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

  const handleSelect = (product: ProductResult) => {
    onSelect(product);
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
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-[300px] overflow-y-auto">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left text-sm hover:bg-accent/10 transition-colors border-b border-border/30 last:border-0"
              onClick={() => handleSelect(p)}
            >
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.sku && <span>SKU: {p.sku}</span>}
                  {p.bims_code && <span className="ml-2">Cód: {p.bims_code}</span>}
                  {p.barcode && <span className="ml-2">CB: {p.barcode}</span>}
                  {p.category && <span className="ml-2">• {p.category}</span>}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{p.unit}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
