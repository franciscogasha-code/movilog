import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { RequestProgressBar } from "@/components/solicitudes/RequestProgressBar";
import { RequestDocuments } from "@/components/solicitudes/RequestDocuments";
import {
  REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS,
  ITEM_PURPOSE_LABELS, REJECTION_REASONS, REQUEST_TYPE_LABELS, FULFILLMENT_STATUS_CONFIG,
} from "@/lib/constants";
import { Package, AlertTriangle, Check, X, Loader2, Truck, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

// Small helper to resolve operational responsible name
function OperationalResponsibleName({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["profile-name", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
      return data?.full_name || "—";
    },
  });
  return (
    <div>
      <span className="text-muted-foreground">Resp. operativo:</span>{" "}
      <span className="font-medium">{data || "..."}</span>
    </div>
  );
}

// ─── Action definitions per status ───────────────────────────────────
type ActionDef = {
  label: string;
  newStatus: string;
  variant: "default" | "destructive" | "outline";
  icon: React.ReactNode;
  actor: "origin" | "destination" | "admin" | "driver";
  requiresReason?: boolean;
};

const STATUS_ACTIONS: Record<string, ActionDef[]> = {
  pending: [
    { label: "Aceptar", newStatus: "in_preparation", variant: "default", icon: <Check className="h-4 w-4" />, actor: "origin" },
    { label: "Rechazar", newStatus: "rejected", variant: "destructive", icon: <X className="h-4 w-4" />, actor: "origin", requiresReason: true },
  ],
  in_preparation: [
    { label: "Enviar a tránsito", newStatus: "in_transit", variant: "default", icon: <Truck className="h-4 w-4" />, actor: "origin" },
  ],
  in_transit: [
    { label: "Confirmar entrega", newStatus: "delivered", variant: "default", icon: <Check className="h-4 w-4" />, actor: "driver" },
  ],
  delivered: [
    { label: "Confirmar recepción", newStatus: "received", variant: "default", icon: <Check className="h-4 w-4" />, actor: "destination" },
  ],
  received: [
    { label: "Cierre logístico", newStatus: "logistic_closed", variant: "outline", icon: <Check className="h-4 w-4" />, actor: "destination" },
  ],
};

export function SolicitudDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
  const { hasBranch, hasRole, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const [transitioning, setTransitioning] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionReasonType, setRejectionReasonType] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const { data: request, isLoading } = useQuery({
    queryKey: ["branch-request-detail", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          *,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code)
        `)
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["branch-request-items", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select(`*, product:products(name, sku, bims_code)`)
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: fulfillments } = useQuery({
    queryKey: ["request-fulfillments", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id, status, bims_transfer_number, bims_invoice_number, shipping_method, dispatched_at, received_at")
        .eq("branch_request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: events } = useQuery({
    queryKey: ["request-events", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("reference_id", requestId)
        .eq("reference_type", "branch_request")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: documents } = useQuery({
    queryKey: ["request-bims-documents", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_bims_documents")
        .select("*")
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  if (!request) return <div className="p-4 text-muted-foreground">No encontrada</div>;

  const r = request as any;

  // ─── Determine actor permissions ────────────────────────────────
  const isAdmin = hasRole("admin") || hasRole("supervisor") || isOwner;
  const isOrigin = hasBranch(r.source_branch_id);
  const isDestination = hasBranch(r.requesting_branch_id);

  const availableActions = (STATUS_ACTIONS[r.status] || []).filter((action) => {
    if (isAdmin) return true;
    if (action.actor === "origin") return isOrigin;
    if (action.actor === "destination") return isDestination;
    if (action.actor === "driver") return isOrigin || hasRole("driver");
    return false;
  });

  // Block "in_transit" transition if no documents
  const hasDocuments = (documents?.length || 0) > 0;
  const isTransitBlocked = r.status === "in_preparation" && !hasDocuments;

  // ─── Transition handler ─────────────────────────────────────────
  const handleTransition = async (newStatus: string, reason?: string, reasonType?: string) => {
    setTransitioning(true);
    try {
      const { data, error } = await supabase.rpc("fn_transition_request_status", {
        p_request_id: requestId,
        p_new_status: newStatus,
        p_reason: reason || null,
        p_rejection_reason_type: reasonType || null,
      });
      if (error) throw error;

      const result = data as any;
      toast.success(`Pedido #${result.request_number}: ${result.old_status} → ${result.new_status}`);

      queryClient.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-fulfillments", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-events", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-bims-documents", requestId] });
      onUpdate();
      setShowRejectForm(false);
      setRejectionReason("");
      setRejectionReasonType("");
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar estado");
    } finally {
      setTransitioning(false);
    }
  };

  // ─── Build progress bar events ─────────────────────────────────
  const progressEvents = (events || [])
    .filter((ev: any) => ev.new_status)
    .map((ev: any) => ({
      status: ev.new_status,
      date: new Date(ev.created_at).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    }));

  // ─── Warnings ───────────────────────────────────────────────────
  const warnings: string[] = [];
  if (isTransitBlocked && r.status === "in_preparation") {
    warnings.push("Se requiere al menos un documento BIMS para avanzar a tránsito");
  }
  const hasQtyMismatch = items?.some((item: any) =>
    item.quantity_accepted != null && item.quantity_accepted > 0 &&
    item.quantity_accepted !== item.quantity_requested
  );
  if (hasQtyMismatch) warnings.push("Diferencia entre cantidad solicitada y enviada");

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <RequestProgressBar currentStatus={r.status} events={progressEvents} />

      {/* Warning panel */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-foreground font-medium">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-display text-xl font-bold">Pedido #{r.request_number}</h3>
            <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(r.created_at).toLocaleString("es-PY")}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
        </Badge>
      </div>

      {/* ─── ACTION PANEL ──────────────────────────────────────────── */}
      {availableActions.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Acciones disponibles</p>
            {showRejectForm ? (
              <div className="space-y-3">
                <Select value={rejectionReasonType} onValueChange={setRejectionReasonType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Motivo de rechazo" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REJECTION_REASONS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Detalle del rechazo (opcional)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!rejectionReasonType || transitioning}
                    onClick={() => handleTransition("rejected", rejectionReason, rejectionReasonType)}
                  >
                    {transitioning && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Confirmar rechazo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowRejectForm(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableActions.map((action) => {
                  const isBlocked = action.newStatus === "in_transit" && isTransitBlocked;
                  return (
                    <Button
                      key={action.newStatus}
                      variant={action.variant}
                      size="sm"
                      disabled={transitioning || isBlocked}
                      title={isBlocked ? "Vincule un documento BIMS primero" : undefined}
                      onClick={() => {
                        if (action.requiresReason) {
                          setShowRejectForm(true);
                        } else {
                          handleTransition(action.newStatus);
                        }
                      }}
                    >
                      {transitioning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : action.icon}
                      <span className="ml-1">{action.label}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Route info */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Sucursal origen (abastecedora)</p>
            <p className="font-semibold">{r.source_branch?.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Sucursal solicitante (destino)</p>
            <p className="font-semibold">{r.requesting_branch?.name}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Destino:</span>{" "}
          <span className="font-medium">{DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Envío:</span>{" "}
          <span className="font-medium">{SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}</span>
        </div>
        {r.client_name && (
          <div>
            <span className="text-muted-foreground">Cliente:</span>{" "}
            <span className="font-medium">{r.client_name}</span>
          </div>
        )}
        {r.delivery_payer && (
          <div>
            <span className="text-muted-foreground">Paga envío:</span>{" "}
            <span className="font-medium">{r.delivery_payer === "company" ? "Empresa" : "Cliente"}</span>
          </div>
        )}
        {r.shipping_cost != null && r.shipping_cost > 0 && (
          <div>
            <span className="text-muted-foreground">Costo envío:</span>{" "}
            <span className="font-medium">Gs. {Number(r.shipping_cost).toLocaleString("es-PY")}</span>
          </div>
        )}
        {r.courier_billing_mode && (
          <div>
            <span className="text-muted-foreground">Cobro encomienda:</span>{" "}
            <span className="font-medium">{r.courier_billing_mode === "on_invoice" ? "En factura" : "Cobro en destino"}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Cierre logístico:</span>{" "}
          <span className="font-medium">{r.logistic_closed_at ? "✓" : "Pendiente"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Cierre admin:</span>{" "}
          <span className="font-medium">{r.admin_closed_at ? "✓" : r.request_type === "reposition" ? "N/A" : "Pendiente"}</span>
        </div>
        {r.operational_responsible_id && (
          <OperationalResponsibleName userId={r.operational_responsible_id} />
        )}
      </div>

      {/* BIMS Documents */}
      <RequestDocuments
        requestId={requestId}
        requestType={r.request_type}
        deliveryTarget={r.delivery_target}
        currentStatus={r.status}
        isOrigin={isOrigin}
        isAdmin={isAdmin}
      />

      {/* Items */}
      <div>
        <h4 className="font-display font-semibold mb-3">Ítems ({items?.length || 0})</h4>
        <div className="space-y-2">
          {items?.map((item: any) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{item.product?.name}</p>
                <p className="text-xs text-muted-foreground">{item.product?.sku || item.product?.bims_code}</p>
              </div>
              <Badge variant="outline" className="text-xs">
                {ITEM_PURPOSE_LABELS[item.item_purpose] || item.item_purpose}
              </Badge>
              <div className="text-right min-w-[120px]">
                <span className="font-mono font-semibold">{item.quantity_requested}</span>
                {item.quantity_shipped != null && item.quantity_shipped > 0 && item.quantity_shipped !== item.quantity_requested && (
                  <span className="text-xs ml-1 text-destructive font-semibold">
                    / {item.quantity_shipped} enviados
                  </span>
                )}
                {item.quantity_accepted != null && item.quantity_accepted > 0 && (
                  <span className={`text-xs ml-1 ${item.quantity_accepted !== item.quantity_requested ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                    / {item.quantity_accepted} aceptados
                  </span>
                )}
              </div>
              {item.rejection_reason_type && (
                <Badge variant="destructive" className="text-xs">
                  {REJECTION_REASONS[item.rejection_reason_type] || item.rejection_reason_type}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ─── FULFILLMENT / LOGISTICS EXECUTION ─────────────────────── */}
      {fulfillments && fulfillments.length > 0 && (
        <div>
          <h4 className="font-display font-semibold mb-3">Ejecución logística</h4>
          <div className="space-y-2">
            {fulfillments.map((f: any) => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30 text-sm">
                <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${FULFILLMENT_STATUS_CONFIG[f.status]?.color || "bg-muted text-muted-foreground"}`}>
                      {FULFILLMENT_STATUS_CONFIG[f.status]?.label || f.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {SHIPPING_METHOD_LABELS[f.shipping_method] || f.shipping_method}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h4 className="font-display font-semibold mb-3">Timeline de eventos</h4>
        {!events?.length ? (
          <p className="text-sm text-muted-foreground">Sin eventos registrados</p>
        ) : (
          <div className="space-y-0">
            {events.map((ev: any, idx: number) => (
              <div key={ev.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                  {idx < events.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium">{ev.event_description || ev.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString("es-PY")}
                    {ev.new_status && <span className="ml-2">→ {ev.new_status}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {r.notes && (
        <div>
          <h4 className="font-display font-semibold mb-1">Notas</h4>
          <p className="text-sm text-muted-foreground">{r.notes}</p>
        </div>
      )}
    </div>
  );
}
