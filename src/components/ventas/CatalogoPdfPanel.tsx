import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Share2, Download, X, ImageOff, Info, Zap, Save, FolderOpen, Trash2, RefreshCw } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";
import { formatGs, resolvePrice, ProductRow } from "@/lib/ventas";
import {
  buildCatalogPdfParts,
  sortCatalogProducts,
  CatalogAbortError,
  catalogPartSize,
  getCatalogImageFailures,
  getCatalogImageReport,
  resetCatalogImageFailures,
  CatalogImageQualityError,
  CatalogImageReport,
  CATALOG_SEC_PER_ITEM_WITH_IMG,
  CATALOG_SEC_PER_ITEM_NO_IMG,
  CATALOG_SUGGEST_NO_IMG_FROM,
  CatalogPart,
  CatalogSort,
} from "@/lib/catalogo-pdf";

import { useToast } from "@/hooks/use-toast";

const BATCH = 200;

function fmtEta(seconds: number): string {
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} seg`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

export function CatalogoPdfPanel({
  open,
  onOpenChange,
  selectedIds,
  onRemoveId,
  customer,
  salespersonName,
  userId,
  onRestoreIds,
  onClearSelection,
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
  userId: string;
  onRestoreIds: (ids: string[]) => void;
  onClearSelection: () => void;
}) {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPrices, setShowPrices] = useState(true);
  const [showScales, setShowScales] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [sortBy, setSortBy] = useState<CatalogSort>("category");
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; part?: string } | null>(
    null
  );
  const [parts, setParts] = useState<CatalogPart[] | null>(null);
  const [imgFailures, setImgFailures] = useState(0);
  const [imageReport, setImageReport] = useState<CatalogImageReport | null>(null);
  // Los productos sin foto en BIMS no deben frenar el catálogo.
  const [allowFailures] = useState(true);
  const [draftName, setDraftName] = useState("");
  const [drafts, setDrafts] = useState<Array<{ id: string; name: string; product_ids: string[]; updated_at: string }>>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const loadDrafts = async () => {
    const { data, error } = await supabase
      .from("sales_catalog_drafts")
      .select("id, name, product_ids, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    setDrafts((data ?? []).map((draft) => ({
      id: draft.id,
      name: draft.name,
      product_ids: draft.product_ids ?? [],
      updated_at: draft.updated_at,
    })));
  };

  useEffect(() => {
    if (!open) return;
    void loadDrafts().catch(() => {
      toast({ title: "No se pudieron cargar los borradores", variant: "destructive" });
    });
  }, [open, userId]);

  const saveDraft = async (name = draftName.trim() || `Catálogo ${new Date().toLocaleDateString("es-PY")}`) => {
    if (selectedIds.length === 0) return;
    setDraftBusy(true);
    try {
      const existing = drafts.find((draft) => draft.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const payload = {
        user_id: userId,
        name,
        product_ids: selectedIds,
        customer,
        filters: {},
        pdf_options: { showPrices, showScales, showImages, sortBy, note },
      };
      const result = existing
        ? await supabase.from("sales_catalog_drafts").update(payload).eq("id", existing.id)
        : await supabase.from("sales_catalog_drafts").insert(payload);
      if (result.error) throw result.error;
      setDraftName("");
      await loadDrafts();
      toast({ title: "Selección guardada", description: `${selectedIds.length.toLocaleString("de-DE")} productos` });
    } catch (error) {
      toast({ title: "No se pudo guardar", description: error instanceof Error ? error.message : "Intentá de nuevo", variant: "destructive" });
    } finally {
      setDraftBusy(false);
    }
  };

  const deleteDraft = async (id: string) => {
    const { error } = await supabase.from("sales_catalog_drafts").delete().eq("id", id);
    if (error) {
      toast({ title: "No se pudo borrar el borrador", variant: "destructive" });
      return;
    }
    await loadDrafts();
  };

  // Con muchos ítems, sugerir el modo sin fotos una sola vez
  const suggestedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      suggestedRef.current = false;
      return;
    }
    if (!suggestedRef.current && selectedIds.length >= CATALOG_SUGGEST_NO_IMG_FROM) {
      suggestedRef.current = true;
      setShowImages(false);
    }
  }, [open, selectedIds.length]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ids = selectedIds;
        const rows: ProductRow[] = [];
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = ids.slice(i, i + BATCH);
          const { data, error } = await supabase.from("products").select("*").in("id", chunk);
          if (error) throw error;
          rows.push(...((data ?? []) as ProductRow[]));
          if (cancelled) return;
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
      abortRef.current?.abort();
      abortRef.current = null;
      setParts(null);
      setProgress(null);
    }
  }, [open]);

  // invalidar PDFs ya generados si cambian las opciones
  useEffect(() => {
    setParts(null);
    setImgFailures(0);
    setImageReport(null);
  }, [products, showPrices, showScales, showImages, sortBy, note, customer.priceListId]);

  const sortedPreview = useMemo(
    () => sortCatalogProducts(products, sortBy, customer.priceListId),
    [products, sortBy, customer.priceListId]
  );

  const partSize = catalogPartSize(showImages);
  const partCount = Math.max(1, Math.ceil(sortedPreview.length / partSize));
  const partSizes = Array.from({ length: partCount }, (_, i) =>
    Math.max(0, Math.min(partSize, sortedPreview.length - i * partSize))
  );

  const etaSeconds =
    sortedPreview.length *
    (showImages ? CATALOG_SEC_PER_ITEM_WITH_IMG : CATALOG_SEC_PER_ITEM_NO_IMG);
  const etaNoImg = sortedPreview.length * CATALOG_SEC_PER_ITEM_NO_IMG;

  const generate = async (
    onPart?: (part: CatalogPart) => void
  ): Promise<CatalogPart[] | null> => {
    if (products.length === 0) return null;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: products.length });
    setImgFailures(0);
    resetCatalogImageFailures();
    try {
      // Autoguardado: la selección queda recuperable aunque se cierre la app durante la generación.
      await saveDraft("Autoguardado catálogo");

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
        showImages,
        sortBy,
        note,
        allowImageFailures: allowFailures,
        signal: controller.signal,
        onPart,
        onProgress: (done, total) => {
          const idx = Math.min(partCount, Math.floor(Math.max(0, done - 1) / partSize) + 1);
          setProgress({
            done,
            total,
            part: partCount > 1 ? `Parte ${idx} de ${partCount} · ` : undefined,
          });
        },
      });
      setParts(out);
      const failed = getCatalogImageFailures();
      setImgFailures(failed);
      setImageReport(getCatalogImageReport());
      if (failed > 0 && showImages) {
        toast({
          title: `${failed.toLocaleString("de-DE")} fotos no disponibles`,
          description: "Esos productos salen con el recuadro gris. Probá generar de nuevo.",
          variant: "destructive",
        });
      }
      return out;
    } catch (e: any) {
      if (e instanceof CatalogAbortError || e?.name === "CatalogAbortError") {
        toast({ title: "Generación cancelada" });
      } else if (e instanceof CatalogImageQualityError || e?.name === "CatalogImageQualityError") {
        const report = (e as CatalogImageQualityError).report;
        setImageReport(report);
        setImgFailures(report.failed.length);
        toast({
          title: "PDF detenido para cuidar la calidad",
          description: `${report.failed.length.toLocaleString("de-DE")} fotos fallaron. Reintentá o generá sin fotos.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error al generar el PDF",
          description: e?.message ?? "Probá desactivar las fotos",
          variant: "destructive",
        });
      }
      return null;
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const saveFile = (part: CatalogPart) => {
    const url = URL.createObjectURL(part.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = part.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  };

  const download = async () => {
    if (parts?.length) {
      parts.forEach((p, i) => setTimeout(() => saveFile(p), i * 700));
      toast({
        title: parts.length > 1 ? `Catálogo en ${parts.length} archivos` : "Catálogo generado",
        description: `${products.length.toLocaleString("de-DE")} productos`,
      });
      return;
    }
    // Generamos todas las partes primero. La compuerta de calidad evita que se
    // descargue una parte antes de detectar fallas de imagen en otra.
    const out = await generate();
    if (!out?.length) return;
    out.forEach((part, index) => setTimeout(() => saveFile(part), index * 700));
    toast({
      title: out.length > 1 ? `Catálogo en ${out.length} archivos` : "Catálogo generado",
      description: `${products.length.toLocaleString("de-DE")} productos`,
    });
  };

  const share = async () => {
    const out = parts ?? (await generate());
    if (!out?.length) return;
    const files = out.map((p) => new File([p.blob], p.fileName, { type: "application/pdf" }));
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

    if (files.length > 1 && nav.share && nav.canShare?.({ files: [files[0]] })) {
      try {
        await nav.share({ files: [files[0]], title: "Catálogo SANSEI", text });
        out.slice(1).forEach((p, i) => setTimeout(() => saveFile(p), i * 700));
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

        {imgFailures > 0 && showImages && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {imgFailures.toLocaleString("de-DE")} fotos no se pudieron cargar. El PDF se genera igual:
              esos productos salen con recuadro gris.
            </AlertDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setParts(null); void generate(); }} disabled={busy}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reintentar fotos
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowImages(false)} disabled={busy}>
                <ImageOff className="h-3.5 w-3.5 mr-1" /> Generar sin fotos
              </Button>
            </div>
          </Alert>
        )}

        {imageReport && showImages && (
          <p className="text-xs text-muted-foreground">
            {imageReport.ready.toLocaleString("de-DE")} fotos listas · {imageReport.missingSource.toLocaleString("de-DE")} productos sin foto de origen
          </p>
        )}



        {partCount > 1 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Se generarán {partCount} archivos de hasta {partSize.toLocaleString("de-DE")} productos (
              {partSizes.slice(0, 4).join(" + ")}
              {partSizes.length > 4 ? " + ..." : ""}). Cada uno indica "Parte X de {partCount}".
            </AlertDescription>
          </Alert>
        )}

        {showImages && sortedPreview.length >= CATALOG_SUGGEST_NO_IMG_FROM && (
          <Alert>
            <Zap className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Con fotos va a tardar ≈ {fmtEta(etaSeconds)}. Sin fotos son ≈ {fmtEta(etaNoImg)} y el
              archivo queda mucho más liviano para WhatsApp.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2 border rounded-md p-3">
            <div className="flex items-center gap-2">
              <Input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Nombre del borrador"
                maxLength={120}
              />
              <Button type="button" size="icon" variant="outline" onClick={() => void saveDraft()} disabled={draftBusy || selectedIds.length === 0} aria-label="Guardar selección">
                <Save className="h-4 w-4" />
              </Button>
            </div>
            {drafts.length > 0 && (
              <div className="max-h-28 overflow-y-auto divide-y">
                {drafts.map((draft) => (
                  <div key={draft.id} className="flex items-center gap-2 py-1.5">
                    <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => onRestoreIds(draft.product_ids)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                      <span className="truncate">{draft.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{draft.product_ids.length.toLocaleString("de-DE")}</span>
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void deleteDraft(draft.id)} aria-label={`Borrar ${draft.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClearSelection} disabled={selectedIds.length === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Limpiar selección actual
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="pdf-images" className="text-sm">
                Incluir fotos
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Sin fotos: lista compacta y rápida
              </p>
            </div>
            <Switch id="pdf-images" checked={showImages} onCheckedChange={setShowImages} />
          </div>

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
              Selección ({sortedPreview.length.toLocaleString("de-DE")} cargados) · tiempo estimado ≈{" "}
              {fmtEta(etaSeconds)}
            </p>
            <div className="max-h-52 overflow-y-auto border rounded-md divide-y">
              {loading && <p className="text-xs text-muted-foreground p-3">Cargando productos...</p>}
              {!loading &&
                sortedPreview.slice(0, 300).map((p, idx) => (
                  <Fragment key={p.id}>
                    {partCount > 1 && idx % partSize === 0 && (
                      <div className="sticky top-0 bg-muted/80 backdrop-blur px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Parte {Math.floor(idx / partSize) + 1} de {partCount}
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
                            crossOrigin="anonymous"
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
              {!loading && sortedPreview.length > 300 && (
                <p className="text-[11px] text-muted-foreground p-3">
                  + {(sortedPreview.length - 300).toLocaleString("de-DE")} productos más (se incluyen
                  todos en el PDF)
                </p>
              )}
              {!loading && sortedPreview.length === 0 && (
                <p className="text-xs text-muted-foreground p-3">Sin productos seleccionados</p>
              )}
            </div>
          </div>

          {progress && (
            <div className="space-y-1">
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {progress.part ?? ""}
                  {showImages ? "Preparando fotos" : "Armando lista"} {progress.done} /{" "}
                  {progress.total}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button className="flex-1" onClick={share} disabled={busy || sortedPreview.length === 0}>
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
