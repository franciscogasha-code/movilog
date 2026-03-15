import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, CheckCircle2, AlertTriangle, XCircle, Truck, MapPin } from "lucide-react";
import { toast } from "sonner";

const REJECTION_REASONS = [
  { value: "no_space", label: "No entra en el móvil" },
  { value: "priority", label: "Prioricé otra carga" },
  { value: "not_ready", label: "No estaba realmente listo" },
  { value: "missing_bims", label: "Falta documento BIMS" },
  { value: "other", label: "Otro" },
];

export function CargasDisponibles() {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Get current user's active trip
  const { data: myDriver } = useQuery({
    queryKey: ["my-driver-record"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("drivers").select("id, assigned_branch_id").eq("user_id", user.id).single();
      return data;
    },
  });

  const { data: myActiveTrip } = useQuery({
    queryKey: ["my-active-trip", myDriver?.id],
    queryFn: async () => {
      if (!myDriver?.id) return null;
      const { data } = await supabase
        .from("trips")
        .select("id, trip_number, trip_type, origin_branch_id")
        .eq("driver_id", myDriver.id)
        .eq("status", "in_progress" as any)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!myDriver?.id,
  });

  // A) Cargas asignadas a mi viaje
  const { data: assignedLoads } = useQuery({
    queryKey: ["assigned-loads", myActiveTrip?.id],
    queryFn: async () => {
      if (!myActiveTrip?.id) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, delivery_target)`)
        .eq("trip_id", myActiveTrip.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!myActiveTrip?.id,
  });

  // B) Cargas disponibles en mi sucursal (no asignadas a viaje)
  const branchId = myActiveTrip?.origin_branch_id || myDriver?.assigned_branch_id;
  const { data: availableLoads } = useQuery({
    queryKey: ["available-loads", branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, delivery_target)`)
        .eq("source_branch_id", branchId)
        .in("status", ["waiting_for_cut", "waiting_for_courier", "picking"])
        .is("trip_id", null)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!branchId,
  });

  // C) Movimientos fuera de corte recientes (últimas 24h)
  const { data: outOfCutoffEvents } = useQuery({
    queryKey: ["out-of-cutoff-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("event_type", "driver_pickup")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data?.filter((e: any) => e.metadata?.out_of_cutoff === true) || [];
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["assigned-loads"] });
    queryClient.invalidateQueries({ queryKey: ["available-loads"] });
    queryClient.invalidateQueries({ queryKey: ["out-of-cutoff-events"] });
  };

  const pickupOutOfCutoff = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: validation } = await supabase.rpc("fn_validate_driver_pickup", { p_fulfillment_id: fulfillmentId });
      const result = validation as any;
      if (!result?.allowed) {
        toast.error(result?.reason || "No se puede retirar esta carga");
        return;
      }

      const { error } = await supabase
        .from("fulfillment_orders")
        .update({
          status: "dispatched" as any,
          dispatched_at: new Date().toISOString(),
          dispatched_by: user.id,
          current_custody_holder_id: user.id,
          trip_id: myActiveTrip?.id || null,
        })
        .eq("id", fulfillmentId);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_pickup",
        category: "logistics" as any,
        event_description: myActiveTrip ? "Retiro dentro de viaje/corte" : "Retiro fuera de corte formal",
        new_status: "dispatched",
        new_custody_holder_id: user.id,
        triggered_by: user.id,
        metadata: { out_of_cutoff: !myActiveTrip, trip_id: myActiveTrip?.id || null },
      });

      toast.success(myActiveTrip ? "Retiro confirmado" : "Retiro confirmado (fuera de corte)");
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const rejectPickup = async (fulfillmentId: string, reason: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Log rejection event — does NOT change fulfillment status
      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_pickup_rejected",
        category: "logistics" as any,
        event_description: `Chofer rechazó retiro: ${REJECTION_REASONS.find(r => r.value === reason)?.label || reason}`,
        triggered_by: user.id,
        metadata: { rejection_reason: reason },
      });

      // Generate alert
      await supabase.from("ai_anomalies").insert({
        anomaly_type: "driver_pickup_rejected",
        area: "logistics" as any,
        severity: "warning" as any,
        alert_level: "branch_operational" as any,
        title: "Chofer rechazó retiro de carga",
        description: `Motivo: ${REJECTION_REASONS.find(r => r.value === reason)?.label || reason}`,
        affected_entities: [{ type: "fulfillment_order", id: fulfillmentId }],
      });

      toast.info("Carga rechazada — queda disponible para próximo corte");
      setRejectingId(null);
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const FulfillmentRow = ({ f, showPickup = true }: { f: any; showPickup?: boolean }) => (
    <div className="flex items-center justify-between p-3 text-sm">
      <div className="flex items-center gap-3">
        <div>
          <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
          <span className="text-muted-foreground ml-2">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!f.bims_transfer_number && !f.bims_invoice_number && (
          <Badge variant="outline" className="text-xs text-secondary border-secondary/30">Sin doc. BIMS</Badge>
        )}
        {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
        {(f.branch_request?.delivery_target === "client" || f.shipping_method === "courier") && f.package_count > 0 && (
          <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {f.status === "waiting_for_cut" ? "Esperando corte" : f.status === "waiting_for_courier" ? "Esperando transporte" : f.status === "dispatched" ? "Retirado" : f.status}
        </Badge>
        {showPickup && (
          <>
            <Button size="sm" variant="outline" onClick={() => setRejectingId(f.id)} className="h-7 text-xs text-destructive">
              <XCircle className="h-3 w-3 mr-1" /> Rechazar
            </Button>
            <Button size="sm" onClick={() => pickupOutOfCutoff(f.id)} className="h-7 text-xs gap-1">
              <CheckCircle2 className="h-3 w-3" /> Retirar
            </Button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {!myActiveTrip && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-sm">
          <AlertTriangle className="h-4 w-4 text-secondary shrink-0" />
          <span>
            Sin corte/viaje activo. Los retiros se registran como <strong>movimiento fuera de corte</strong>.
          </span>
        </div>
      )}

      {/* A) Cargas asignadas a mi viaje */}
      {myActiveTrip && (
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              Asignadas a mi viaje #{myActiveTrip.trip_number}
              <Badge variant="default" className="text-xs">{assignedLoads?.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!assignedLoads?.length ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Sin cargas asignadas a este viaje</div>
            ) : (
              <div className="divide-y divide-border/50">
                {assignedLoads.map((f: any) => <FulfillmentRow key={f.id} f={f} showPickup={false} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* B) Cargas disponibles en el punto */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Disponibles para retiro
            <Badge variant="secondary" className="text-xs">{availableLoads?.length || 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!availableLoads?.length ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              <Package className="h-6 w-6 mx-auto mb-1 opacity-50" />
              No hay cargas pendientes de retiro
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {availableLoads.map((f: any) => <FulfillmentRow key={f.id} f={f} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* C) Movimientos fuera de corte recientes */}
      {(outOfCutoffEvents?.length ?? 0) > 0 && (
        <Card className="glass-card border-secondary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-secondary" />
              Movimientos fuera de corte (24h)
              <Badge variant="outline" className="text-xs">{outOfCutoffEvents?.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {outOfCutoffEvents?.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <span className="font-medium">{e.event_description}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {new Date(e.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs text-secondary border-secondary/30">Fuera de corte</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rejection dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Motivo del rechazo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {REJECTION_REASONS.map((r) => (
              <Button
                key={r.value}
                variant="outline"
                className="w-full justify-start text-sm h-auto py-3"
                onClick={() => rejectingId && rejectPickup(rejectingId, r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
