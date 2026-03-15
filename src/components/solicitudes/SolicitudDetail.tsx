import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS, ITEM_PURPOSE_LABELS, REJECTION_REASONS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import { Package, AlertTriangle } from "lucide-react";

export function SolicitudDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
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
        .select("id, status, bims_transfer_number, bims_invoice_number")
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

  // Anomalies related to this request's fulfillments
  const { data: relatedAnomalies } = useQuery({
    queryKey: ["request-anomalies", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_anomalies")
        .select("*")
        .eq("is_acknowledged", false)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      // Filter client-side for anomalies referencing this request or its fulfillments
      const fulfillmentIds = fulfillments?.map(f => f.id) || [];
      return data?.filter((a: any) => {
        const entities = a.affected_entities || [];
        return entities.some((e: any) =>
          (e.type === "branch_request" && e.id === requestId) ||
          (e.type === "fulfillment_order" && fulfillmentIds.includes(e.id))
        );
      }) || [];
    },
    enabled: !!requestId && !!fulfillments,
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  if (!request) return <div className="p-4 text-muted-foreground">No encontrada</div>;

  const r = request as any;

  // Compute warnings
  const warnings: { type: string; message: string }[] = [];

  // Missed cutoff: dispatched status items created > 4h ago still waiting
  const hasMissedCutoffEvent = events?.some((e: any) => e.event_type === "missed_cutoff") || false;
  const hasWaitingFulfillment = fulfillments?.some((f: any) => {
    const age = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
    return (f.status === "waiting_for_cut" || f.status === "waiting_for_courier") && age > 4;
  });
  if (hasMissedCutoffEvent || hasWaitingFulfillment) {
    warnings.push({ type: "missed_cutoff", message: "Este pedido perdió el corte programado" });
  }

  // Prepared without BIMS
  const hasFulfillmentWithoutBims = fulfillments?.some((f: any) =>
    (f.status === "waiting_for_cut" || f.status === "waiting_for_courier") &&
    !f.bims_transfer_number && !f.bims_invoice_number
  );
  if (hasFulfillmentWithoutBims) {
    warnings.push({ type: "missing_bims", message: "Preparado sin documento BIMS vinculado" });
  }

  // Qty mismatch
  const hasQtyMismatch = items?.some((item: any) =>
    item.quantity_accepted != null && item.quantity_accepted > 0 &&
    item.quantity_accepted !== item.quantity_requested
  );
  if (hasQtyMismatch) {
    warnings.push({ type: "qty_mismatch", message: "Diferencia entre cantidad solicitada y enviada" });
  }

  // Pickup rejection
  const hasRejection = events?.some((e: any) => e.event_type === "driver_pickup_rejected") || false;
  if (hasRejection) {
    warnings.push({ type: "pickup_rejected", message: "Un chofer rechazó el retiro de este pedido" });
  }

  return (
    <div className="space-y-6">
      {/* Warning panel */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-foreground font-medium">{w.message}</span>
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

      {/* Route info */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Origen</p>
            <p className="font-semibold">{r.source_branch?.code} — {r.source_branch?.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Destino</p>
            <p className="font-semibold">{r.requesting_branch?.code} — {r.requesting_branch?.name}</p>
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
        <div>
          <span className="text-muted-foreground">Cierre logístico:</span>{" "}
          <span className="font-medium">{r.logistic_closed_at ? "✓" : "Pendiente"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Cierre admin:</span>{" "}
          <span className="font-medium">{r.admin_closed_at ? "✓" : r.request_type === "reposition" ? "N/A" : "Pendiente"}</span>
        </div>
      </div>

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

      {/* Timeline */}
      <div>
        <h4 className="font-display font-semibold mb-3">Timeline de eventos</h4>
        {!events?.length ? (
          <p className="text-sm text-muted-foreground">Sin eventos registrados</p>
        ) : (
          <div className="space-y-0">
            {events.map((ev, idx) => (
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
