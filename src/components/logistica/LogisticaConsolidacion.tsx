import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Package, MapPin, ArrowRight, Truck, Plus, AlertTriangle } from "lucide-react";
import { REQUEST_TYPE_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import { CrearViajeForm } from "./CrearViajeForm";

export function LogisticaConsolidacion() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignMode, setAssignMode] = useState<"existing" | "new" | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  // Source of truth: branch_requests.status = 'in_consolidation' + flow_type = 'interurban'
  const { data: requests, isLoading } = useQuery({
    queryKey: ["consolidation-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, flow_type, created_at, priority, 
          bims_invoice_number, bims_sale_reference, client_name, delivery_target, notes,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
          fulfillment_orders!fulfillment_orders_branch_request_id_fkey(id, trip_id, package_count, bims_transfer_number, bims_invoice_number)
        `)
        .eq("status", "in_consolidation" as any)
        .eq("flow_type", "interurban")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Inconsistent requests: in_consolidation but NOT interurban (or null flow_type)
  const { data: inconsistentRequests } = useQuery({
    queryKey: ["consolidation-inconsistent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, flow_type, created_at,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)
        `)
        .eq("status", "in_consolidation" as any)
        .or("flow_type.is.null,flow_type.neq.interurban")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).filter(r => r.flow_type !== "interurban");
    },
  });

  // Planned trips for assignment
  const { data: plannedTrips } = useQuery({
    queryKey: ["planned-trips-for-assignment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          id, trip_number, trip_type, scheduled_departure,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number)
        `)
        .eq("status", "planned" as any)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!requests) return;
    if (selected.size === requests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(requests.map(r => r.id)));
    }
  };

  const assignToTrip = async (tripId: string) => {
    setAssigning(true);
    let success = 0;
    let errors: string[] = [];
    for (const requestId of selected) {
      try {
        const { error } = await supabase.rpc("fn_transition_request_status", {
          p_request_id: requestId,
          p_new_status: "assigned_to_trip",
          p_trip_id: tripId,
        });
        if (error) throw error;
        success++;
      } catch (err: any) {
        errors.push(err.message);
      }
    }
    if (success > 0) {
      toast.success(`${success} pedido(s) asignados al viaje`);
      queryClient.invalidateQueries({ queryKey: ["consolidation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips-for-assignment"] });
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} error(es): ${errors[0]}`);
    }
    setSelected(new Set());
    setAssignMode(null);
    setSelectedTripId("");
    setAssigning(false);
  };

  const handleAssignExisting = () => {
    if (!selectedTripId) { toast.error("Seleccionar un viaje"); return; }
    assignToTrip(selectedTripId);
  };

  const handleTripCreated = (tripId: string) => {
    assignToTrip(tripId);
  };

  // Group by destination
  const byDest: Record<string, typeof requests> = {};
  requests?.forEach(r => {
    const dest = (r.requesting_branch as any)?.code || "Sin destino";
    if (!byDest[dest]) byDest[dest] = [];
    byDest[dest].push(r);
  });

  return (
    <div className="space-y-4">
      {/* Inconsistency alert */}
      {inconsistentRequests && inconsistentRequests.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-destructive">
                  {inconsistentRequests.length} pedido(s) en consolidación sin flow_type interurbano
                </p>
                <p className="text-xs text-muted-foreground">
                  Estos pedidos no pueden asignarse a viajes. Revisar y corregir desde el detalle del pedido.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {inconsistentRequests.map((r: any) => (
                    <Badge key={r.id} variant="outline" className="text-xs border-destructive/30 text-destructive">
                      #{r.request_number} — {(r.source_branch as any)?.code} → {(r.requesting_branch as any)?.code}
                      <span className="ml-1 opacity-60">({r.flow_type || "sin flow_type"})</span>
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions bar */}
      {selected.size > 0 && (
        <Card className="glass-card border-primary/30">
          <CardContent className="p-3 flex items-center justify-between">
            <span className="text-sm font-medium">{selected.size} pedido(s) seleccionado(s)</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAssignMode("existing")} className="gap-1">
                <Truck className="h-3.5 w-3.5" /> Asignar a viaje
              </Button>
              <Button size="sm" onClick={() => setAssignMode("new")} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> Crear viaje y asignar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Cargas en consolidación
              {requests && <Badge variant="outline" className="ml-2">{requests.length}</Badge>}
            </CardTitle>
            {requests && requests.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
                {selected.size === requests.length ? "Deseleccionar todo" : "Seleccionar todo"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : Object.keys(byDest).length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay cargas en consolidación</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byDest).map(([dest, items]) => (
                <div key={dest} className="p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{dest}</span>
                    <Badge variant="outline" className="text-xs">{items!.length} carga(s)</Badge>
                  </div>
                  <div className="space-y-1">
                    {items!.map((r: any) => {
                      const fo = r.fulfillment_orders?.[0];
                      const doc = fo?.bims_transfer_number || fo?.bims_invoice_number || r.bims_invoice_number || "—";
                      return (
                        <div key={r.id} className="flex items-center gap-3 p-2 rounded bg-background/50 text-sm">
                          <Checkbox
                            checked={selected.has(r.id)}
                            onCheckedChange={() => toggleSelect(r.id)}
                          />
                          <span className="font-mono text-xs text-muted-foreground">#{r.request_number}</span>
                          <span className="text-muted-foreground">{(r.source_branch as any)?.code}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span>{(r.requesting_branch as any)?.code}</span>
                          <Badge variant="outline" className="text-xs ml-auto">
                            {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{doc}</span>
                          {fo?.package_count > 0 && (
                            <span className="text-xs text-muted-foreground">{fo.package_count} bultos</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Assign to existing trip dialog */}
      <Dialog open={assignMode === "existing"} onOpenChange={(o) => !o && setAssignMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar a viaje existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={selectedTripId} onValueChange={setSelectedTripId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar viaje..." />
              </SelectTrigger>
              <SelectContent>
                {plannedTrips?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    Viaje #{t.trip_number} — {(t.origin_branch as any)?.code}
                    {(t.vehicle as any)?.plate_number ? ` (${(t.vehicle as any).plate_number})` : ""}
                  </SelectItem>
                ))}
                {(!plannedTrips || plannedTrips.length === 0) && (
                  <SelectItem value="none" disabled>No hay viajes planificados</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignMode(null)}>Cancelar</Button>
            <Button onClick={handleAssignExisting} disabled={assigning || !selectedTripId}>
              {assigning ? "Asignando..." : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create trip and assign dialog */}
      <Dialog open={assignMode === "new"} onOpenChange={(o) => !o && setAssignMode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear viaje y asignar cargas</DialogTitle>
          </DialogHeader>
          <CrearViajeForm
            onSuccess={handleTripCreated}
            onCancel={() => setAssignMode(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
