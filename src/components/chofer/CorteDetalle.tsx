import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const REJECTION_REASONS = [
  { value: "no_space", label: "No entra en el móvil" },
  { value: "priority", label: "Prioricé otra carga" },
  { value: "not_ready", label: "No estaba realmente listo" },
  { value: "missing_bims", label: "Falta documento BIMS" },
  { value: "other", label: "Otro" },
];

const REQUEST_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  client: { label: "Cliente", className: "bg-primary/10 text-primary border-primary/20" },
  online: { label: "Online", className: "bg-accent/10 text-accent border-accent/20" },
  reposition: { label: "Reposición", className: "bg-muted text-muted-foreground border-border" },
  redistribution: { label: "Redistribución", className: "bg-secondary/10 text-secondary border-secondary/20" },
};

export function CorteDetalle({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const { data: trip } = useQuery({
    queryKey: ["trip-detail", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`*, origin_branch:branches!trips_origin_branch_id_fkey(name, code)`)
        .eq("id", tripId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: fulfillments } = useQuery({
    queryKey: ["trip-fulfillments", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, request_type, delivery_target)`)
        .eq("trip_id", tripId);
      if (error) throw error;
      return data;
    },
    enabled: !!tripId,
  });

  const { data: availableFulfillments } = useQuery({
    queryKey: ["available-fulfillments", trip?.origin_branch_id],
    queryFn: async () => {
      if (!trip?.origin_branch_id) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, request_type, delivery_target)`)
        .eq("source_branch_id", trip.origin_branch_id)
        .in("status", ["waiting_for_cut", "waiting_for_courier"])
        .is("trip_id", null);
      if (error) throw error;
      return data;
    },
    enabled: !!trip?.origin_branch_id,
  });

  // Recent rejection events
  const { data: rejectionEvents } = useQuery({
    queryKey: ["rejection-events-trip", tripId],
    queryFn: async () => {
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("operational_events")
        .select("reference_id, created_at, metadata")
        .eq("event_type", "driver_pickup_rejected")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rejectionByFulfillment: Record<string, { at: string; reason: string }> = {};
  rejectionEvents?.forEach((e: any) => {
    if (!rejectionByFulfillment[e.reference_id]) {
      rejectionByFulfillment[e.reference_id] = { at: e.created_at, reason: e.metadata?.rejection_reason || "" };
    }
  });

  const getTypeBadge = (f: any) => {
    const reqType = f.branch_request?.request_type;
    if (reqType && REQUEST_TYPE_BADGES[reqType]) return REQUEST_TYPE_BADGES[reqType];
    return { label: "Transferencia", className: "bg-muted text-muted-foreground border-border" };
  };

  const isMissedCutoff = (f: any) => {
    const age = (Date.now() - new Date(f.created_at).getTime()) / (1000 * 60 * 60);
    return age > 4 && (f.status === "waiting_for_cut" || f.status === "waiting_for_courier");
  };

  const confirmPickup = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: validation } = await supabase.rpc("fn_validate_driver_pickup", { p_fulfillment_id: fulfillmentId });
      const result = validation as any;
      if (!result?.allowed) { toast.error(result?.reason || "No se puede retirar"); return; }

      const { error } = await supabase
        .from("fulfillment_orders")
        .update({ status: "dispatched" as any, trip_id: tripId, dispatched_at: new Date().toISOString(), dispatched_by: user.id, current_custody_holder_id: user.id })
        .eq("id", fulfillmentId);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order", reference_id: fulfillmentId, event_type: "driver_pickup",
        category: "logistics" as any, event_description: "Chofer confirmó retiro", new_status: "dispatched",
        new_custody_holder_id: user.id, triggered_by: user.id,
        metadata: { trip_id: tripId, out_of_cutoff: !trip || trip.status !== "in_progress" },
      });

      toast.success("Retiro confirmado");
      queryClient.invalidateQueries({ queryKey: ["trip-fulfillments"] });
      queryClient.invalidateQueries({ queryKey: ["available-fulfillments"] });
    } catch (err: any) { toast.error(err.message); }
  };

  const rejectPickup = async (fulfillmentId: string, reason: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order", reference_id: fulfillmentId,
        event_type: "driver_pickup_rejected", category: "logistics" as any,
        event_description: `Chofer rechazó retiro: ${REJECTION_REASONS.find(r => r.value === reason)?.label || reason}`,
        triggered_by: user.id, metadata: { trip_id: tripId, rejection_reason: reason },
      });

      await supabase.from("ai_anomalies").insert({
        anomaly_type: "driver_pickup_rejected", area: "logistics" as any, severity: "warning" as any,
        alert_level: "branch_operational" as any,
        title: "Chofer rechazó retiro de carga",
        description: `Motivo: ${REJECTION_REASONS.find(r => r.value === reason)?.label || reason}`,
        affected_entities: [{ type: "fulfillment_order", id: fulfillmentId }],
      });

      toast.info("Carga rechazada — queda disponible para próximo corte");
      setRejectingId(null);
      queryClient.invalidateQueries({ queryKey: ["available-fulfillments"] });
      queryClient.invalidateQueries({ queryKey: ["rejection-events-trip"] });
    } catch (err: any) { toast.error(err.message); }
  };

  if (!trip) return <div className="p-4 text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-muted-foreground">Sucursal: </span>
          <span className="font-semibold">{(trip as any).origin_branch?.code}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Inicio: </span>
          <span className="font-semibold">
            {trip.cutoff_started_at ? new Date(trip.cutoff_started_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" }) : "—"}
          </span>
        </div>
        <Badge variant={trip.status === "in_progress" ? "default" : "outline"}>
          {trip.status === "in_progress" ? "En curso" : "Completado"}
        </Badge>
      </div>

      {/* Already picked up */}
      {fulfillments && fulfillments.length > 0 && (
        <div>
          <h4 className="font-display font-semibold mb-3 text-sm uppercase text-muted-foreground tracking-wider">
            Cargas retiradas ({fulfillments.length})
          </h4>
          <div className="space-y-2">
            {fulfillments.map((f: any) => {
              const typeBadge = getTypeBadge(f);
              return (
                <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-accent" />
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
                      <span className="text-muted-foreground">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
                      <Badge variant="outline" className={`text-xs ${typeBadge.className}`}>{typeBadge.label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
                    {f.bims_invoice_number && <Badge variant="outline" className="text-xs">F: {f.bims_invoice_number}</Badge>}
                    {f.package_count > 0 && <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available for pickup */}
      {trip.status === "in_progress" && (
        <div>
          <h4 className="font-display font-semibold mb-3 text-sm uppercase text-muted-foreground tracking-wider">
            Disponibles para retiro ({availableFulfillments?.length || 0})
          </h4>
          {!availableFulfillments?.length ? (
            <div className="p-4 text-center text-muted-foreground text-sm">No hay cargas esperando retiro</div>
          ) : (
            <div className="space-y-2">
              {availableFulfillments.map((f: any) => {
                const typeBadge = getTypeBadge(f);
                const missedCutoff = isMissedCutoff(f);
                const rejection = rejectionByFulfillment[f.id];

                return (
                  <div key={f.id} className={`flex items-center justify-between p-3 rounded-lg border text-sm ${missedCutoff ? "bg-destructive/5 border-destructive/20" : "bg-muted/30 border-border/30"}`}>
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
                        <span className="text-muted-foreground">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
                        <Badge variant="outline" className={`text-xs ${typeBadge.className}`}>{typeBadge.label}</Badge>
                        {missedCutoff && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="h-3 w-3" /> Perdió corte
                          </Badge>
                        )}
                        {rejection && (
                          <Badge variant="outline" className="text-xs text-destructive border-destructive/30 gap-1">
                            <XCircle className="h-3 w-3" /> Rechazado {new Date(rejection.at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!f.bims_transfer_number && !f.bims_invoice_number && (
                        <Badge variant="outline" className="text-xs text-secondary border-secondary/30">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Sin doc. BIMS
                        </Badge>
                      )}
                      {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
                      {(f.branch_request?.delivery_target === "client" || f.shipping_method === "courier") && f.package_count > 0 && (
                        <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setRejectingId(f.id)} className="h-7 text-xs text-destructive">
                        <XCircle className="h-3 w-3 mr-1" /> Rechazar
                      </Button>
                      <Button size="sm" onClick={() => confirmPickup(f.id)} className="h-7 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Retirar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Rejection dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Motivo del rechazo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {REJECTION_REASONS.map((r) => (
              <Button key={r.value} variant="outline" className="w-full justify-start text-sm h-auto py-3"
                onClick={() => rejectingId && rejectPickup(rejectingId, r.value)}>
                {r.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
