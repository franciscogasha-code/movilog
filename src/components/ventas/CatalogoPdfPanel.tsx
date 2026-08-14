import { Fragment, useEffect, useMemo, useState } from "react";
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
import { FileText, Share2, Download, X, AlertTriangle, ImageOff, Info } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";
import { formatGs, resolvePrice, ProductRow } from "@/lib/ventas";
import {
  buildCatalogPdfParts,
  sortCatalogProducts,
  CATALOG_PDF_PART_SIZE,
  CATALOG_PDF_HARD_MAX,
  CatalogPart,
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
  const [progress, setProgress] = useState<{ done: number; total: number; part?: string } | null>(
    null
  );
  const [parts, setParts] = useState<CatalogPart[] | null>(null);

  const overLimit = selectedIds.length > CATALOG_PDF_HARD_MAX;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = selectedIds.slice(0, CATALOG_PDF_HARD_MAX);
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
      setParts(null);
      setProgress(null);
    }
  }, [open]);

  // invalidar PDFs ya generados si cambian las opciones
  useEffect(() => {
    setParts(null);
  }, [products, showPrices, showScales, sortBy, note, customer.priceListId]);

  const sortedPreview = useMemo(
    () => sortCatalogProducts(products, sortBy, customer.priceListId),
    [products, sortBy, customer.priceListId]
  );

  const partCount = Math.max(1, Math.ceil(sortedPreview.length / CATALOG_PDF_PART_SIZE));
  const partSizes = Array.from({ length: partCount }, (_, i) =>
    Math.max(0, Math.min(CATALOG_PDF_PART_SIZE, sortedPreview.length - i * CATALOG_PDF_PART_SIZE))
  );

  const generate = async (): Promise<CatalogPart[] | null> => {
    if (products.length === 0) return null;
    setProgress({ done: 0, total: products.length });
    try {
      const out = await buildCatalogPdfParts({
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
        onProgress: (done, total) => {
          const idx = Math.min(partCount, Math.floor((done - 1) / CATALOG_PDF_PART_SIZE) + 1);
          setProgress({
            done,
            total,
            part: partCount > 1 ? `Parte ${idx} de ${partCount} · ` : undefined,
          });
        },
      });
      setParts(out);
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

  const downloadParts = (list: CatalogPart[]) => {
    list.forEach((part, i) => {
      setTimeout(() => {
        const url = URL.createObjectURL(part.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = part.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, i * 700);
    });
  };

  const download = async () => {
    const out = parts ?? (await generate());
    if (!out?.length) return;
    downloadParts(out);
    toast({
      title: out.length > 1 ? `Catálogo en ${out.length} archivos` : "Catálogo generado",
      description: `${products.length} productos`,
    });
  };

  const share = async () => {
    const out = parts ?? (await generate());
    if (!out?.length) return;
    const files = out.map(
      (p) => new File([p.blob], p.fileName, { type: "application/pdf" })
    );
    const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
    const text = customer.name ? `Catálogo para ${customer.name}` : "Catálogo SANSEI";

    if (nav.share && nav.canShare?.({ files })) {
      try {
        await nav.share({ files, title: "Catálogo SANSEI", text });
        return;
      } catch {
        /* usuario canceló o falló: caemos a descarga */
      }
    }

    // El dispositivo no soporta compartir varios archivos: comparto el primero y descargo el resto
    if (files.length > 1 && nav.share && nav.canShare?.({ files: [files[0]] })) {
      try {
        await nav.share({ files: [files[0]], title: "Catálogo SANSEI", text });
        downloadParts(out.slice(1));
        toast({
          title: "Compartida la Parte 1",
          description: `Las otras ${out.length - 1} parte(s) se descargaron para enviarlas aparte.`,
        });
        return;
      } catch {
        /* fallback general */
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
              Seleccionaste {selectedIds.length.toLocaleString("de-DE")} productos. El máximo es{" "}
              {CATALOG_PDF_HARD_MAX}: se incluyen los primeros según el orden elegido. Afiná el
              filtro por categoría o marca para no dejar productos afuera.
            </AlertDescription>
          </Alert>
        )}

        {!overLimit && partCount > 1 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Se generarán {partCount} archivos ({partSizes.join(" + ")} productos). Cada uno indica
              "Parte X de {partCount}".
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
                sortedPreview.map((p, idx) => (
                  <Fragment key={p.id}>
                  {partCount > 1 && idx % CATALOG_PDF_PART_SIZE === 0 && (
                    <div className="sticky top-0 bg-muted/80 backdrop-blur px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Parte {Math.floor(idx / CATALOG_PDF_PART_SIZE) + 1} de {partCount}
                    </div>
                  )}
                  <div className="flex items-center gap-2 p-2">
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
                  </Fragment>
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
                {progress.part ?? ""}Preparando imágenes {progress.done} / {progress.total}
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
              {partCount > 1 ? `Descargar ${partCount} archivos` : "Descargar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
