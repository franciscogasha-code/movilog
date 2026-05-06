import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, FileDown, ArrowRightCircle, Pencil, CheckCircle2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useBranches } from "@/hooks/use-branches";
import { generatePreSalePdf } from "@/lib/pre-sale-pdf";
import { SolicitudCreateForm } from "./SolicitudCreateForm";

/**
 * Panel de detalle para pre-ventas (is_pre_sale=true).
 *
 * Acciones disponibles según pre_sale_status:
 *  - draft        → editar, descargar PDF, marcar "Cliente confirmó"
 *  - confirmed    → editar (revierte a draft), PDF, convertir a pedido
 *  - converted    → solo lectura + link al pedido generado (NO se puede re-convertir,
 *                   garantizado por idempotencia de fn_convert_presale_to_order)
 *
 * La pre-venta NO genera fulfillment, ruteo, ni stock comprometido.
 * La conversión crea un pedido NUEVO (request_type=online) y deja la pre-venta
 * como histórico con `converted_to_request_id` apuntando al pedido.
 */
export function PreSaleDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: branches = [] } = useBranches();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertSourceId, setConvertSourceId] = useState<string>("");

  const { data: request, isLoading } = useQuery({
    queryKey: ["pre-sale-detail", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`*, requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)`)
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["pre-sale-items", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select(`*, product:products(name, sku, bims_code, image_url, sell_price)`)
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
  });

  // Si está convertida, traemos el número del pedido generado para mostrar el link
  const convertedToId = (request as any)?.converted_to_request_id ?? null;
  const { data: convertedRequest } = useQuery({
    queryKey: ["pre-sale-converted-target", convertedToId],
    enabled: !!convertedToId,
    queryFn: async () => {
      const { data } = await supabase
        .from("branch_requests")
        .select("id, request_number, status")
        .eq("id", convertedToId!)
        .maybeSingle();
      return data;
    },
  });

  const preSaleStatus = (request as any)?.pre_sale_status ?? "draft";
  const isConfirmed = preSaleStatus === "confirmed";
  const isConverted = preSaleStatus === "converted";

  const defaultSourceId = useMemo(
    () => (request as any)?.source_branch_id ?? (request as any)?.requesting_branch_id ?? "",
    [request],
  );

  if (isLoading || !request) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;
  }

  async function downloadPdf() {
    if (!request) return;
    setPdfLoading(true);
    try {
      await generatePreSalePdf({
        request_number: request.request_number,
        client_name: request.client_name,
        client_phone: (request as any).client_phone,
        client_email: (request as any).client_email,
        client_address: request.client_address,
        sales_channel: (request as any).sales_channel,
        shipping_method: request.shipping_method,
        notes: request.notes,
        created_at: request.created_at,
        items: items as any,
      });
      await supabase
        .from("branch_requests")
        .update({ pre_sale_pdf_generated_at: new Date().toISOString() } as any)
        .eq("id", requestId);
      toast.success("PDF generado");
    } catch (e: any) {
      toast.error(`Error generando PDF: ${e.message}`);
    } finally {
      setPdfLoading(false);
    }
  }

  async function markAsConfirmed() {
    setConfirming(true);
    try {
      const { error } = await supabase
        .from("branch_requests")
        .update({
          pre_sale_status: "confirmed",
          pre_sale_confirmed_at: new Date().toISOString(),
        } as any)
        .eq("id", requestId);
      if (error) throw error;
      toast.success("Cliente confirmó la pre-venta");
      qc.invalidateQueries({ queryKey: ["pre-sale-detail", requestId] });
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      onUpdate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConfirming(false);
    }
  }

  function openConvertDialog() {
    setConvertSourceId(defaultSourceId);
    setConvertOpen(true);
  }

  async function convertToOrder() {
    setConverting(true);
    try {
      const { data, error } = await supabase.rpc("fn_convert_presale_to_order" as any, {
        p_request_id: requestId,
        p_source_branch_id: convertSourceId || null,
      });
      if (error) throw error;
      const newId = data as string;
      toast.success("Pre-venta convertida a pedido");
      setConvertOpen(false);
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      qc.invalidateQueries({ queryKey: ["branch-requests-counts"] });
      qc.invalidateQueries({ queryKey: ["pre-sale-detail", requestId] });
      onUpdate();
      // Abrir el pedido generado
      if (newId) navigate(`/solicitudes?detail=${newId}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setConverting(false);
    }
  }

  function handleEditSuccess() {
    setEditOpen(false);
    qc.invalidateQueries({ queryKey: ["pre-sale-detail", requestId] });
    qc.invalidateQueries({ queryKey: ["pre-sale-items", requestId] });
    qc.invalidateQueries({ queryKey: ["branch-requests"] });
    onUpdate();
  }

  const statusLabel: Record<string, { label: string; cls: string }> = {
    draft: { label: "Borrador", cls: "bg-muted text-muted-foreground" },
    confirmed: { label: "Cliente confirmó", cls: "bg-success text-success-foreground" },
    converted: { label: "Convertida a pedido", cls: "bg-primary text-primary-foreground" },
    sent_to_operation: { label: "Enviada a operación", cls: "bg-primary text-primary-foreground" },
  };
  const subStatus = statusLabel[preSaleStatus] ?? statusLabel.draft;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-semibold text-lg">#{request.request_number}</span>
          <Badge className="bg-warning text-warning-foreground border-warning">Pre-Venta</Badge>
          <Badge className={subStatus.cls}>{subStatus.label}</Badge>
          {(request as any).pre_sale_confirmed_at && !isConverted && (
            <span className="text-[11px] text-muted-foreground">
              confirmada {new Date((request as any).pre_sale_confirmed_at).toLocaleString("es-PY")}
            </span>
          )}
          {(request as any).converted_at && (
            <span className="text-[11px] text-muted-foreground">
              convertida {new Date((request as any).converted_at).toLocaleString("es-PY")}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(request.created_at).toLocaleString("es-PY")}
        </div>
      </div>

      {isConverted && convertedRequest && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-3 flex items-center justify-between gap-2">
            <div className="text-sm">
              Esta pre-venta fue convertida en el pedido{" "}
              <span className="font-mono font-semibold">#{convertedRequest.request_number}</span>.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/solicitudes?detail=${convertedRequest.id}`)}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Ver pedido
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-3 space-y-1 text-sm">
          <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{request.client_name}</span></div>
          {(request as any).client_phone && <div><span className="text-muted-foreground">Tel:</span> {(request as any).client_phone}</div>}
          {(request as any).client_email && <div><span className="text-muted-foreground">Email:</span> {(request as any).client_email}</div>}
          {request.client_address && <div><span className="text-muted-foreground">Dirección:</span> {request.client_address}</div>}
          <div><span className="text-muted-foreground">Envío:</span> {request.shipping_method}</div>
          {(request as any).sales_channel && <div><span className="text-muted-foreground">Canal:</span> {(request as any).sales_channel}</div>}
          <div><span className="text-muted-foreground">Sucursal vendedora:</span> {(request as any).requesting_branch?.name ?? "—"}</div>
        </CardContent>
      </Card>

      <div>
        <div className="text-sm font-medium mb-2">Productos ({items.length})</div>
        <div className="space-y-1">
          {(items as any[]).map((it: any) => (
            <div key={it.id} className="flex items-center gap-2 rounded border border-border/50 p-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.product?.name}</div>
                <div className="text-[11px] text-muted-foreground">{it.product?.bims_code || it.product?.sku || "—"}</div>
              </div>
              <div className="text-xs">×{Number(it.quantity_requested).toLocaleString("de-DE")}</div>
              {it.product?.sell_price && (
                <div className="text-xs text-muted-foreground">₲ {Math.round(it.product.sell_price).toLocaleString("de-DE")}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {!isConverted && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" />
            Editar pre-venta
          </Button>
          <Button variant="outline" onClick={downloadPdf} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
            Descargar PDF
          </Button>
          <Button
            variant={isConfirmed ? "secondary" : "default"}
            onClick={markAsConfirmed}
            disabled={confirming || isConfirmed}
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {isConfirmed ? "Cliente confirmó ✓" : "Cliente confirmó"}
          </Button>
          <Button onClick={openConvertDialog} disabled={converting}>
            <ArrowRightCircle className="h-4 w-4 mr-2" />
            Convertir a pedido
          </Button>
        </div>
      )}

      {isConverted && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button variant="outline" onClick={downloadPdf} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
            Descargar PDF
          </Button>
        </div>
      )}

      {!isConverted && (
        <p className="text-[11px] text-muted-foreground">
          Editá libremente mientras esté en borrador. Marcá <strong>Cliente confirmó</strong> cuando el cliente
          acepte la cotización. Al <strong>Convertir a pedido</strong> se genera un pedido nuevo (online) en la
          bandeja operativa, y esta pre-venta queda como histórico.
        </p>
      )}

      {/* Editar */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Pre-Venta #{request.request_number}</DialogTitle>
          </DialogHeader>
          <SolicitudCreateForm editingPreSaleId={requestId} defaultRequestType="pre_sale_online" onSuccess={handleEditSuccess} />
        </DialogContent>
      </Dialog>

      {/* Convertir → elegir sucursal de origen */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convertir a pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Se va a crear un pedido nuevo (Pedido Online) a partir de esta pre-venta.
              Elegí la sucursal que va a abastecer el stock.
            </p>
            <div>
              <Label>Sucursal origen del stock</Label>
              <Select value={convertSourceId} onValueChange={setConvertSourceId}>
                <SelectTrigger><SelectValue placeholder="Sucursal" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setConvertOpen(false)} disabled={converting}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={convertToOrder} disabled={!convertSourceId || converting}>
                {converting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRightCircle className="h-4 w-4 mr-2" />}
                Convertir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
