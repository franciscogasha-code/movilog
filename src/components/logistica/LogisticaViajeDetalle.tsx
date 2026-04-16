import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Package, ArrowRight, Truck, MapPin, Plus, Trash2, Calendar, User } from "lucide-react";
import { TRIP_TYPE_LABELS, REQUEST_TYPE_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";
import { toast } from "sonner";

interface Props {
  tripId: string;
}

export function LogisticaViajeDetalle({ tripId }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [assigning, setAssigning] = useState(false);

  // Trip info
  const { data: trip } = useQuery({
    queryKey: ["trip-detail", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id, profiles:user_id(full_name))
        `)
        .eq("id", tripId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fulfillments linked to this trip
  const { data: linkedFulfillments } = useQuery({
    queryKey: ["trip-fulfillments", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          id, status, package_count, bims_transfer_number, bims_invoice_number, branch_request_id,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests!fulfillment_orders_branch_request_id_fkey(request_number, request_type, flow_type, client_name)
        `)
        .eq("trip_id", tripId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // Available requests for adding (in_consolidation + interurban)
  const { data: availableRequests } = useQuery({
    queryKey: ["available-for-trip"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, client_name,
          source_branch:branches!branch_requests_source_branch_id_fkey(code),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(code)
        `)
        .eq("status", "in_consolidation" as any)
        .eq("flow_type", "interurban");
      if (error) throw error;
      return data;
    },
    enabled: addOpen,
  });

  const addLoad = async () => {
    if (!selectedRequestId) return;
    setAssigning(true);
    try {
      const { error } = await supabase.rpc("fn_transition_request_status", {
        p_request_id: selectedRequestId,
        p_new_status: "assigned_to_trip",
        p_trip_id: tripId,
      });
      if (error) throw error;
      toast.success("Carga asignada al viaje");
      queryClient.invalidateQueries({ queryKey: ["trip-fulfillments", tripId] });
      queryClient.invalidateQueries({ queryKey: ["consolidation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
      setAddOpen(false);
      setSelectedRequestId("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAssigning(false);
    }
  };

  const removeLoad = async (fulfillment: any) => {
    if (!fulfillment.branch_request_id) {
      toast.error("No se puede desvincular: sin pedido asociado");
      return;
    }
    try {
      const { error } = await supabase.rpc("fn_transition_request_status", {
        p_request_id: fulfillment.branch_request_id,
        p_new_status: "in_consolidation",
      });
      if (error) throw error;
      toast.success("Carga desvinculada del viaje");
      queryClient.invalidateQueries({ queryKey: ["trip-fulfillments", tripId] });
      queryClient.invalidateQueries({ queryKey: ["consolidation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!trip) return <div className="p-4 text-center text-muted-foreground text-sm">Cargando...</div>;

  const driverName = (trip.driver as any)?.profiles?.full_name || "Sin chofer";
  const isPlanned = trip.status === "planned";

  return (
    <div className="space-y-4">
      {/* Trip info */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Viaje #{trip.trip_number}</span>
          <Badge variant="outline">{TRIP_TYPE_LABELS[trip.trip_type] || trip.trip_type}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span>{driverName}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          <span>{(trip.origin_branch as any)?.code} — {(trip.origin_branch as any)?.name}</span>
        </div>
        {(trip as any).scheduled_departure && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>{new Date((trip as any).scheduled_departure).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}
        {(trip as any).destination_description && (
          <div className="col-span-2 flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">Destino: {(trip as any).destination_description}</span>
          </div>
        )}
        {(trip.vehicle as any)?.plate_number && (
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            <span>{(trip.vehicle as any).plate_number} {(trip.vehicle as any).brand || ""}</span>
          </div>
        )}
      </div>

      {/* Loads */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-display font-semibold text-sm">Cargas asignadas ({linkedFulfillments?.length || 0})</h4>
          {isPlanned && (
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Agregar carga
            </Button>
          )}
        </div>

        {!linkedFulfillments?.length ? (
          <Card className="glass-card">
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              <Package className="h-6 w-6 mx-auto mb-2 opacity-50" />
              Sin cargas asignadas
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {linkedFulfillments.map((f: any) => {
              const req = f.branch_request as any;
              const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
              const doc = f.bims_transfer_number || f.bims_invoice_number || "—";
              return (
                <div key={f.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 border border-border/50 text-sm">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    {req && <span className="font-mono text-xs">#{req.request_number}</span>}
                    <span className="text-muted-foreground">{(f.source_branch as any)?.code}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>{(f.destination_branch as any)?.code || req?.client_name || "—"}</span>
                    {req && <Badge variant="outline" className="text-xs">{REQUEST_TYPE_LABELS[req.request_type] || req.request_type}</Badge>}
                    <span className="text-xs text-muted-foreground">{doc}</span>
                    {f.package_count > 0 && <span className="text-xs text-muted-foreground">{f.package_count} bultos</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
                    {isPlanned && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => removeLoad(f)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add load dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar carga al viaje</DialogTitle>
          </DialogHeader>
          <Select value={selectedRequestId} onValueChange={setSelectedRequestId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar pedido en consolidación..." />
            </SelectTrigger>
            <SelectContent>
              {availableRequests?.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  #{r.request_number} — {(r.source_branch as any)?.code} → {(r.requesting_branch as any)?.code}
                  {r.client_name ? ` (${r.client_name})` : ""}
                </SelectItem>
              ))}
              {(!availableRequests || availableRequests.length === 0) && (
                <SelectItem value="none" disabled>No hay cargas disponibles</SelectItem>
              )}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            <Button onClick={addLoad} disabled={assigning || !selectedRequestId}>
              {assigning ? "Asignando..." : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
