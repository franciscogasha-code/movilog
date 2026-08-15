import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { REQUEST_COLUMNS, fetchRequestClientContact } from "@/lib/branch-requests-query";
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
  const [convertExecBranchId, setConvertExecBranchId] = useState<string>("");

  const { data: request, isLoading } = useQuery({
    queryKey: ["pre-sale-detail", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`${REQUEST_COLUMNS}, requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)`)
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: clientContact } = useQuery({
    queryKey: ["pre-sale-contact", requestId],
    enabled: !!requestId,
    queryFn: () => fetchRequestClientContact(requestId),
  });

  const createdBy = (request as any)?.created_by ?? null;
  const { data: salesperson } = useQuery({
    queryKey: ["pre-sale-salesperson", createdBy],
    enabled: !!createdBy,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", createdBy!)
        .maybeSingle();
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
        client_phone: clientContact?.client_phone ?? null,
        client_email: clientContact?.client_email ?? null,
        client_address: request.client_address,
        notes: request.notes,
        commercial_terms: (request as any).commercial_terms,
        salesperson_name: (salesperson as any)?.full_name ?? null,
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
    setConvertExecBranchId("");
    setConvertOpen(true);
  }

  const canConvert = !!convertExecBranchId;

  async function convertToOrder() {
    if (!canConvert || converting) return;
    setConverting(true);
    try {
      const { data, error } = await supabase.rpc("fn_send_presale_to_operation" as any, {
        p_request_id: requestId,
        p_requesting_branch_id: convertExecBranchId,
      });
      if (error) throw error;
      const newId = (data as string) || requestId;
      toast.success("Pedido creado en abastecimiento. Resolvé el stock antes de iniciar operación.");
      setConvertOpen(false);
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      qc.invalidateQueries({ queryKey: ["branch-requests-counts"] });
      qc.invalidateQueries({ queryKey: ["pre-sale-detail", requestId] });
      onUpdate();
      if (newId && newId !== requestId) navigate(`/solicitudes?detail=${newId}`);
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
          {clientContact?.client_phone && <div><span className="text-muted-foreground">Tel:</span> {clientContact.client_phone}</div>}
          {clientContact?.client_email && <div><span className="text-muted-foreground">Email:</span> {clientContact.client_email}</div>}
          {request.client_address && <div><span className="text-muted-foreground">Dirección:</span> {request.client_address}</div>}
          {(request as any).sales_channel && <div><span className="text-muted-foreground">Canal:</span> <span className="capitalize">{(request as any).sales_channel}</span></div>}
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">Productos ({items.length})</div>
          <div className="text-xs text-muted-foreground">
            {(items as any[]).reduce((acc: number, it: any) => acc + Number(it.quantity_requested || 0), 0)} unidades
          </div>
        </div>
        <div className="rounded border border-border/50 overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_70px_110px_110px] gap-2 px-3 py-1.5 bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
            <div>Producto</div>
            <div className="text-right">Cant.</div>
            <div className="text-right">P. Unit.</div>
            <div className="text-right">Subtotal</div>
          </div>
          {(items as any[]).map((it: any) => {
            const price = Number(it.product?.sell_price ?? 0);
            const qty = Number(it.quantity_requested || 0);
            const sub = price * qty;
            return (
              <div key={it.id} className="grid grid-cols-[1fr_70px_110px_110px] gap-2 px-3 py-2 text-sm border-t border-border/40 first:border-t-0 items-center">
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.product?.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{it.product?.bims_code || it.product?.sku || "—"}</div>
                </div>
                <div className="text-right tabular-nums text-sm">{qty.toLocaleString("de-DE")}</div>
                <div className="text-right tabular-nums text-sm text-muted-foreground">{price ? `₲ ${Math.round(price).toLocaleString("de-DE")}` : "—"}</div>
                <div className="text-right tabular-nums text-sm font-medium">{price ? `₲ ${Math.round(sub).toLocaleString("de-DE")}` : "—"}</div>
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2.5 bg-muted/30 border-t border-border">
            <span className="text-sm font-semibold">Total estimado</span>
            <span className="text-base font-bold tabular-nums">
              ₲ {Math.round(
                (items as any[]).reduce((acc: number, it: any) => acc + Number(it.product?.sell_price ?? 0) * Number(it.quantity_requested || 0), 0),
              ).toLocaleString("de-DE")}
            </span>
          </div>
        </div>
      </div>

      {((request as any).commercial_terms?.trim() || request.notes?.trim()) && (
        <Card>
          <CardContent className="p-3 space-y-3 text-sm">
            {(request as any).commercial_terms?.trim() && (
              <div>
                <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">Condiciones comerciales</div>
                <ul className="list-disc pl-5 space-y-0.5 whitespace-pre-wrap">
                  {(request as any).commercial_terms
                    .split(/\r?\n/)
                    .map((l: string) => l.replace(/^[-•*]\s?/, "").trim())
                    .filter((l: string) => l.length > 0)
                    .map((l: string, i: number) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
            {request.notes?.trim() && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notas internas</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{request.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Convertir → elegir sucursal origen, destino y método */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Convertir a pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs space-y-1">
              <p>• Se creará un <strong>pedido operativo nuevo</strong> en estado <strong>En abastecimiento</strong>.</p>
              <p>• La pre-venta quedará <strong>bloqueada</strong> con estado "Convertida".</p>
              <p>• El operador resolverá el stock (local o pedidos internos) y luego iniciará la operación logística.</p>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Resumen heredado (solo lectura)</div>
              <div><span className="text-muted-foreground">Cliente:</span> {request.client_name} · {clientContact?.client_phone ?? "—"}</div>
              {request.client_address && <div><span className="text-muted-foreground">Dirección:</span> {request.client_address}</div>}
              <div><span className="text-muted-foreground">Productos:</span> {items.length} ítem(s) · {(items as any[]).reduce((a:number,it:any)=>a+Number(it.quantity_requested||0),0)} unidades</div>
              {((request as any).commercial_terms?.trim()) && (
                <div className="line-clamp-2"><span className="text-muted-foreground">Condiciones:</span> {(request as any).commercial_terms}</div>
              )}
            </div>

            <div>
              <Label>Sucursal ejecutora *</Label>
              <Select value={convertExecBranchId} onValueChange={setConvertExecBranchId}>
                <SelectTrigger><SelectValue placeholder="¿Qué sucursal abastece y ejecuta?" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">El pedido quedará a cargo de esta sucursal hasta que se inicie la operación.</p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setConvertOpen(false)} disabled={converting}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={convertToOrder} disabled={!canConvert || converting}>
                {converting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRightCircle className="h-4 w-4 mr-2" />}
                Crear pedido en abastecimiento
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
