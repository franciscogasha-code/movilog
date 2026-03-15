import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Package, AlertTriangle } from "lucide-react";
import { SHIPPING_METHOD_LABELS } from "@/lib/constants";
import { toast } from "sonner";

export function CorteDetalle({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();

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

  // Fulfillments assigned to this trip
  const { data: fulfillments } = useQuery({
    queryKey: ["trip-fulfillments", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target)
        `)
        .eq("trip_id", tripId);
      if (error) throw error;
      return data;
    },
    enabled: !!tripId,
  });

  // Fulfillments ready for pickup at the branch (not yet assigned to a trip)
  const { data: availableFulfillments } = useQuery({
    queryKey: ["available-fulfillments", trip?.origin_branch_id],
    queryFn: async () => {
      if (!trip?.origin_branch_id) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target)
        `)
        .eq("source_branch_id", trip.origin_branch_id)
        .in("status", ["waiting_for_cut", "waiting_for_courier"])
        .is("trip_id", null);
      if (error) throw error;
      return data;
    },
    enabled: !!trip?.origin_branch_id,
  });

  const confirmPickup = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Validate BIMS
      const { data: validation } = await supabase.rpc("fn_validate_driver_pickup", {
        p_fulfillment_id: fulfillmentId,
      });

      const result = validation as any;
      if (!result?.allowed) {
        toast.error(result?.reason || "No se puede retirar esta carga");
        return;
      }

      // Update fulfillment
      const { error } = await supabase
        .from("fulfillment_orders")
        .update({
          status: "dispatched" as any,
          trip_id: tripId,
          dispatched_at: new Date().toISOString(),
          dispatched_by: user.id,
          current_custody_holder_id: user.id,
        })
        .eq("id", fulfillmentId);

      if (error) throw error;

      // Log event
      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_pickup",
        category: "logistics" as any,
        event_description: "Chofer confirmó retiro",
        new_status: "dispatched",
        new_custody_holder_id: user.id,
        triggered_by: user.id,
        metadata: { trip_id: tripId, out_of_cutoff: !trip || trip.status !== "in_progress" },
      });

      toast.success("Retiro confirmado");
      queryClient.invalidateQueries({ queryKey: ["trip-fulfillments"] });
      queryClient.invalidateQueries({ queryKey: ["available-fulfillments"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const rejectPickup = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_pickup_rejected",
        category: "logistics" as any,
        event_description: "Chofer rechazó carga",
        triggered_by: user.id,
        metadata: { trip_id: tripId, reason: "rejected_by_driver" },
      });

      toast.info("Carga rechazada — se notificará a la sucursal");
      queryClient.invalidateQueries({ queryKey: ["available-fulfillments"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!trip) return <div className="p-4 text-muted-foreground">Cargando...</div>;

  return (
    <div className="space-y-6">
      {/* Trip info */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-muted-foreground">Sucursal: </span>
          <span className="font-semibold">{(trip as any).origin_branch?.code}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Inicio: </span>
          <span className="font-semibold">
            {trip.cutoff_started_at
              ? new Date(trip.cutoff_started_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })
              : "—"}
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
            {fulfillments.map((f: any) => (
              <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-4 w-4 text-accent" />
                  <div>
                    <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
                    <span className="text-muted-foreground ml-2">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
                  {f.bims_invoice_number && <Badge variant="outline" className="text-xs">F: {f.bims_invoice_number}</Badge>}
                  {f.package_count > 0 && <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>}
                </div>
              </div>
            ))}
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
            <div className="p-4 text-center text-muted-foreground text-sm">
              No hay cargas preparadas esperando retiro
            </div>
          ) : (
            <div className="space-y-2">
              {availableFulfillments.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
                  <div className="flex items-center gap-3">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
                      <span className="text-muted-foreground ml-2">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
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
                    <Button size="sm" variant="outline" onClick={() => rejectPickup(f.id)} className="h-7 text-xs text-destructive">
                      <XCircle className="h-3 w-3 mr-1" /> Rechazar
                    </Button>
                    <Button size="sm" onClick={() => confirmPickup(f.id)} className="h-7 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Retirar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
