import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, FileDown, Send, Pencil, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { generatePreSalePdf } from "@/lib/pre-sale-pdf";
import { PreSaleCreateForm } from "./PreSaleCreateForm";

/**
 * Panel de detalle reducido para pre-ventas online (is_pre_sale=true).
 * Acciones: descargar PDF, enviar a operación.
 */
export function PreSaleDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
  const qc = useQueryClient();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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

  async function sendToOperation() {
    setSending(true);
    try {
      const { error } = await supabase.rpc("fn_send_presale_to_operation" as any, { p_request_id: requestId });
      if (error) throw error;
      toast.success("Pre-venta enviada a operación");
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      qc.invalidateQueries({ queryKey: ["branch-requests-counts"] });
      onUpdate();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
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

  function handleEditSuccess() {
    setEditOpen(false);
    qc.invalidateQueries({ queryKey: ["pre-sale-detail", requestId] });
    qc.invalidateQueries({ queryKey: ["pre-sale-items", requestId] });
    qc.invalidateQueries({ queryKey: ["branch-requests"] });
    onUpdate();
  }

  const preSaleStatus = (request as any).pre_sale_status ?? "draft";
  const isConfirmed = preSaleStatus === "confirmed";
  const statusLabel: Record<string, { label: string; cls: string }> = {
    draft: { label: "Borrador", cls: "bg-muted text-muted-foreground" },
    confirmed: { label: "Cliente confirmó", cls: "bg-success text-success-foreground" },
    sent_to_operation: { label: "Enviada a operación", cls: "bg-primary text-primary-foreground" },
  };
  const subStatus = statusLabel[preSaleStatus] ?? statusLabel.draft;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-lg">#{request.request_number}</span>
          <Badge className="bg-warning text-warning-foreground border-warning">Pre-Venta</Badge>
          <Badge className={subStatus.cls}>{subStatus.label}</Badge>
          {(request as any).pre_sale_confirmed_at && (
            <span className="text-[11px] text-muted-foreground">
              confirmada {new Date((request as any).pre_sale_confirmed_at).toLocaleString("es-PY")}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(request.created_at).toLocaleString("es-PY")}
        </div>
      </div>

      <Card>
        <CardContent className="p-3 space-y-1 text-sm">
          <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{request.client_name}</span></div>
          {(request as any).client_phone && <div><span className="text-muted-foreground">Tel:</span> {(request as any).client_phone}</div>}
          {(request as any).client_email && <div><span className="text-muted-foreground">Email:</span> {(request as any).client_email}</div>}
          {request.client_address && <div><span className="text-muted-foreground">Dirección:</span> {request.client_address}</div>}
          <div><span className="text-muted-foreground">Envío:</span> {request.shipping_method}</div>
          {(request as any).sales_channel && <div><span className="text-muted-foreground">Canal:</span> {(request as any).sales_channel}</div>}
          <div><span className="text-muted-foreground">Sucursal:</span> {(request as any).requesting_branch?.name ?? "—"}</div>
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

      <div className="flex flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={downloadPdf} disabled={pdfLoading} className="flex-1">
          {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
          Descargar PDF
        </Button>
        <Button onClick={sendToOperation} disabled={sending} className="flex-1">
          {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
          Enviar a operación
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Al enviar a operación, la pre-venta se convierte en pedido online y entra al flujo logístico estándar
        (mismo número, mismo ID).
      </p>
    </div>
  );
}
