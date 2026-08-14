import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Share2, Download, X, AlertTriangle, ImageOff } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";
import { formatGs, resolvePrice, ProductRow } from "@/lib/ventas";
import {
  buildCatalogPdf,
  catalogFileName,
  CATALOG_PDF_MAX_ITEMS,
  CatalogSort,
} from "@/lib/catalogo-pdf";
import { useToast } from "@/hooks/use-toast";

const BATCH = 100;

export function CatalogoPdfPanel({
  open,
  onOpenChange,
  selectedIds,
  onRemoveId,
  customer,
  salespersonName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onRemoveId: (id: string) => void;
  customer: {
    name: string;
    phone?: string;
    address?: string;
    ruc?: string;
    priceListId: string | null;
  };
  salespersonName?: string | null;
}) {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPrices, setShowPrices] = useState(true);
  const [showScales, setShowScales] = useState(true);
  const [sortBy, setSortBy] = useState<CatalogSort>("category");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const overLimit = selectedIds.length > CATALOG_PDF_MAX_ITEMS;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = selectedIds.slice(0, CATALOG_PDF_MAX_ITEMS);
        const rows: ProductRow[] = [];
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = ids.slice(i, i + BATCH);
          const { data, error } = await supabase
            .from("products")
            .select("*")
            .in("id", chunk);
          if (error) throw error;
          rows.push(...((data ?? []) as ProductRow[]));
        }
        if (!cancelled) setProducts(rows);
      } catch (e: any) {
        if (!cancelled)
          toast({
            title: "No se pudieron cargar los productos",
            description: e?.message ?? "Intentá de nuevo",
            variant: "destructive",
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedIds, toast]);

  useEffect(() => {
    if (!open) {
      setBlob(null);
      setProgress(null);
    }
  }, [open]);

  const sortedPreview = useMemo(() => products, [products]);

  const generate = async (): Promise<Blob | null> => {
    if (products.length === 0) return null;
    setProgress({ done: 0, total: products.length });
    try {
      const out = await buildCatalogPdf({
        products,
        customer: customer.name.trim()
          ? {
              name: customer.name,
              phone: customer.phone,
              address: customer.address,
              ruc: customer.ruc,
              priceListId: customer.priceListId,
            }
          : { priceListId: customer.priceListId },
        salespersonName,
        showPrices,
        showScales,
        sortBy,
        note,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setBlob(out);
      return out;
    } catch (e: any) {
      toast({
        title: "Error al generar el PDF",
        description: e?.message ?? "Intentá con menos productos",
        variant: "destructive",
      });
      return null;
    } finally {
      setProgress(null);
    }
  };

  const download = async () => {
    const out = blob ?? (await generate());
    if (!out) return;
    const url = URL.createObjectURL(out);
    const a = document.createElement("a");
    a.href = url;
    a.download = catalogFileName(customer.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast({ title: "Catálogo generado", description: `${products.length} productos` });
  };

  const share = async () => {
    const out = blob ?? (await generate());
    if (!out) return;
    const file = new File([out], catalogFileName(customer.name), { type: "application/pdf" });
    const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({
          files: [file],
          title: "Catálogo SANSEI",
          text: customer.name ? `Catálogo para ${customer.name}` : "Catálogo SANSEI",
        });
        return;
      } catch {
        /* usuario canceló o falló: caemos a descarga */
      }
    }
    await download();
  };

  const busy = loading || progress !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Generar catálogo PDF
          </DialogTitle>
          <DialogDescription>
            {selectedIds.length.toLocaleString("de-DE")} productos seleccionados
            {customer.name ? ` · para ${customer.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {overLimit && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Seleccionaste {selectedIds.length.toLocaleString("de-DE")} productos. El catálogo
              incluye los primeros {CATALOG_PDF_MAX_ITEMS} según el orden elegido.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="pdf-prices" className="text-sm">
              Mostrar precios
            </Label>
            <Switch id="pdf-prices" checked={showPrices} onCheckedChange={setShowPrices} />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="pdf-scales" className="text-sm">
              Mostrar escalas por cantidad
            </Label>
            <Switch
              id="pdf-scales"
              checked={showScales}
              disabled={!showPrices}
              onCheckedChange={setShowScales}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Ordenar por</Label>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as CatalogSort)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="category">Categoría y marca</SelectItem>
                <SelectItem value="name">Nombre (A-Z)</SelectItem>
                <SelectItem value="price">Precio (menor a mayor)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pdf-note" className="text-sm">
              Nota para el cliente (opcional)
            </Label>
            <Textarea
              id="pdf-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej.: Precios válidos por 7 días."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Selección ({sortedPreview.length.toLocaleString("de-DE")} cargados)
            </p>
            <div className="max-h-52 overflow-y-auto border rounded-md divide-y">
              {loading && <p className="text-xs text-muted-foreground p-3">Cargando productos...</p>}
              {!loading &&
                sortedPreview.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 p-2">
                    <div className="h-9 w-9 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
                      {p.image_url ? (
                        <img
                          src={proxyImageUrl(p.image_url)}
                          alt={p.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <ImageOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium line-clamp-1">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {p.bims_code} · {formatGs(resolvePrice(p, customer.priceListId, 1))}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={`Quitar ${p.name}`}
                      onClick={() => onRemoveId(p.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              {!loading && sortedPreview.length === 0 && (
                <p className="text-xs text-muted-foreground p-3">Sin productos seleccionados</p>
              )}
            </div>
          </div>

          {progress && (
            <div className="space-y-1">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <p className="text-xs text-muted-foreground">
                Preparando imágenes {progress.done} / {progress.total}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={share}
              disabled={busy || sortedPreview.length === 0}
            >
              <Share2 className="h-4 w-4 mr-1.5" />
              Compartir
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={download}
              disabled={busy || sortedPreview.length === 0}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Descargar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
