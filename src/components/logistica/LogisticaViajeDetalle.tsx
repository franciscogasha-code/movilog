import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Package, ArrowRight, Truck, MapPin, Plus, Trash2, Calendar, User, ShoppingBag } from "lucide-react";
import { TRIP_TYPE_LABELS, REQUEST_TYPE_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";
import { branchLabel, branchName } from "@/lib/branch-format";
import { toast } from "sonner";

interface Props {
  tripId: string;
}

export function LogisticaViajeDetalle({ tripId }: Props) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const { data: trip } = useQuery({
    queryKey: ["trip-detail", tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id)
        `)
        .eq("id", tripId)
        .single();
      if (error) throw error;
      let driver_name = "Sin chofer";
      const uid = (data as any)?.driver?.user_id;
      if (uid) {
        const { data: prof } = await supabase
          .from("profiles").select("full_name").eq("user_id", uid).maybeSingle();
        if (prof?.full_name) driver_name = prof.full_name;
      }
      return { ...data, driver_name } as any;
    },
  });

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

  const { data: availableRequests } = useQuery({
    queryKey: ["available-for-trip"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, client_name, delivery_target, created_at,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(code, name)
        `)
        .eq("status", "in_consolidation" as any)
        .eq("flow_type", "interurban")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: addOpen,
  });

  // Group fulfillments by source
  const bySource = useMemo(() => {
    if (!linkedFulfillments?.length) return {};
    const groups: Record<string, typeof linkedFulfillments> = {};
    linkedFulfillments.forEach(f => {
      const src = branchName(f.source_branch as any);
      if (!groups[src]) groups[src] = [];
      groups[src].push(f);
    });
    return groups;
  }, [linkedFulfillments]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["trip-fulfillments", tripId] });
    queryClient.invalidateQueries({ queryKey: ["consolidation-requests"] });
    queryClient.invalidateQueries({ queryKey: ["consolidation-count"] });
    queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
    queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
    queryClient.invalidateQueries({ queryKey: ["assigned-today-count"] });
  };

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
      invalidateAll();
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
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!trip) return <div className="p-4 text-center text-muted-foreground text-sm">Cargando...</div>;

  const driverName = (trip as any).driver_name || "Sin chofer";
  const isPlanned = trip.status === "planned";
  const isSupplier = trip.trip_type === "supplier_pickup";
  const totalLoads = linkedFulfillments?.length || 0;
  const totalBultos = linkedFulfillments?.reduce((sum, f) => sum + ((f as any).package_count || 0), 0) || 0;

  return (
    <div className="space-y-4">
      {/* Trip header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-lg">Viaje #{trip.trip_number}</span>
          <Badge variant={isSupplier ? "secondary" : "outline"} className="text-xs">
            {isSupplier && <ShoppingBag className="h-3 w-3 mr-0.5" />}
            {TRIP_TYPE_LABELS[trip.trip_type] || trip.trip_type}
          </Badge>
          <Badge variant={isPlanned ? "outline" : "default"} className="text-xs">
            {isPlanned ? "Planificado" : "En curso"}
          </Badge>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{totalLoads} <span className="text-sm font-normal text-muted-foreground">carga(s)</span></p>
          {totalBultos > 0 && <p className="text-xs text-muted-foreground">{totalBultos} bultos</p>}
        </div>
      </div>

      {/* Trip info grid */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{driverName}</span>
        </div>
        <div className="flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{branchLabel(trip.origin_branch as any)}</span>
        </div>
        {(trip as any).planned_departure && (
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{new Date((trip as any).planned_departure).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        )}
        {(trip.vehicle as any)?.plate && (
          <div className="flex items-center gap-2">
            <Truck className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{(trip.vehicle as any).plate} {(trip.vehicle as any).brand || ""}</span>
          </div>
        )}
        {(trip as any).destination_description && (
          <div className="col-span-2 flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">Destino: {(trip as any).destination_description}</span>
          </div>
        )}
      </div>

      {/* Loads section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-display font-semibold text-sm">Cargas asignadas</h4>
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
              <p>Sin cargas asignadas</p>
              {isPlanned && <p className="text-xs mt-1">Agregue cargas desde consolidación o con el botón de arriba</p>}
            </CardContent>
          </Card>
        ) : Object.keys(bySource).length > 1 ? (
          /* Grouped by source when multiple origins */
          <div className="space-y-3">
            {Object.entries(bySource).map(([src, items]) => (
              <div key={src} className="p-2 rounded-lg bg-muted/10 border border-border/30">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Origen: {src} ({items!.length})</p>
                <div className="space-y-1">
                  {items!.map((f: any) => (
                    <FulfillmentRow key={f.id} f={f} isPlanned={isPlanned} onRemove={removeLoad} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {linkedFulfillments.map((f: any) => (
              <FulfillmentRow key={f.id} f={f} isPlanned={isPlanned} onRemove={removeLoad} />
            ))}
          </div>
        )}
      </div>

      {/* Add load dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar carga al viaje #{trip.trip_number}</DialogTitle>
          </DialogHeader>
          <Select value={selectedRequestId} onValueChange={setSelectedRequestId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar pedido en consolidación..." />
            </SelectTrigger>
            <SelectContent>
              {availableRequests?.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  #{r.request_number} — {branchName(r.source_branch as any)} → {branchName(r.requesting_branch as any)}
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

function FulfillmentRow({ f, isPlanned, onRemove }: { f: any; isPlanned: boolean; onRemove: (f: any) => void }) {
  const req = f.branch_request as any;
  const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
  const doc = f.bims_transfer_number || f.bims_invoice_number || "—";
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {req && <span className="font-mono text-xs">#{req.request_number}</span>}
        <span className="text-muted-foreground text-xs">{branchName(f.source_branch as any)}</span>
        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium">{branchName(f.destination_branch as any, req?.client_name || "—")}</span>
        {req && (
          <Badge variant="outline" className="text-[10px] shrink-0">
            {REQUEST_TYPE_LABELS[req.request_type] || req.request_type}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{doc}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge className={`text-[10px] ${statusCfg.color}`}>{statusCfg.label}</Badge>
        {isPlanned && (
          <Button
            variant="ghost" size="icon" className="h-7 w-7"
            onClick={() => onRemove(f)}
            title="Quitar del viaje"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
}
