import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { User, MapPin, ArrowRight, Truck, Plus, Clock, Info, Package, Warehouse, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { CrearViajeForm } from "./CrearViajeForm";
import { motion, AnimatePresence } from "framer-motion";

/** Normaliza nombre de sucursal */
function branchLabel(b: any): string {
  if (!b) return "—";
  const raw = (b.name || b.code || "").toString().trim();
  return raw.replace(/^SUC\.?\s+/i, "").trim() || raw;
}

const URGENCY_HOURS = 24; // pedidos cliente: SLA más corto
function getUrgency(createdAt: string): "critical" | "warning" | "normal" {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  if (hours >= URGENCY_HOURS) return "critical";
  if (hours >= URGENCY_HOURS / 2) return "warning";
  return "normal";
}
const urgencyConfig = {
  critical: { dot: "bg-destructive", border: "border-destructive/30", sortOrder: 0 },
  warning: { dot: "bg-warning", border: "border-warning/30", sortOrder: 1 },
  normal: { dot: "bg-accent", border: "border-border/50", sortOrder: 2 },
};

/**
 * Pedidos cliente con flota propia que aún están pendientes de entrega.
 * No requieren consolidación pero pueden sumarse tácticamente a un viaje.
 *
 * Filtros:
 *  - request_type = 'client'
 *  - shipping_method = 'own_fleet'
 *  - delivery_target = 'client'
 *  - status en estados pre-entrega (in_preparation, ready_for_dispatch, in_consolidation)
 *  - sin trip_id asignado en su fulfillment (aún no enviado a un viaje)
 */
export function PedidosClienteFlotaPropia() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignMode, setAssignMode] = useState<"existing" | "new" | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ["client-own-fleet-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, shipping_method, delivery_target,
          status, flow_type, created_at, priority,
          client_name, client_address, bims_invoice_number, bims_sale_reference,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code, city),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code, city),
          fulfillment_orders!fulfillment_orders_branch_request_id_fkey(
            id, trip_id, status, package_count,
            bims_transfer_number, bims_invoice_number,
            current_location_type, current_location_branch_id, current_custody_type,
            destination_client_name, destination_client_address,
            current_location_branch:branches!fulfillment_orders_current_location_branch_id_fkey(name, code)
          )
        `)
        .eq("request_type", "client" as any)
        .eq("shipping_method", "own_fleet" as any)
        .eq("delivery_target", "client" as any)
        .in("status", [
          "in_preparation",
          "ready_for_dispatch",
          "ready_for_pickup",
          "in_consolidation",
          "in_transit",
        ] as any)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

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

  const sortedRequests = useMemo(() => {
    if (!requests) return [];
    return [...requests].sort((a, b) => {
      const ua = urgencyConfig[getUrgency(a.created_at)].sortOrder;
      const ub = urgencyConfig[getUrgency(b.created_at)].sortOrder;
      if (ua !== ub) return ua - ub;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [requests]);

  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (!sortedRequests.length) return;
    if (selected.size === sortedRequests.length) setSelected(new Set());
    else setSelected(new Set(sortedRequests.map(r => r.id)));
  };

  const assignToTrip = async (tripId: string) => {
    setAssigning(true);
    const total = selected.size;
    let success = 0;
    const errors: string[] = [];
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
      toast.success(`✓ ${success} de ${total} pedido(s) cliente asignado(s) al viaje`, { duration: 4000 });
      queryClient.invalidateQueries({ queryKey: ["client-own-fleet-pending"] });
      queryClient.invalidateQueries({ queryKey: ["client-own-fleet-count"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips-for-assignment"] });
      queryClient.invalidateQueries({ queryKey: ["planned-count"] });
      queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-today-count"] });
    }
    if (errors.length > 0) toast.error(`${errors.length} error(es): ${errors[0]}`, { duration: 6000 });
    setSelected(new Set());
    setAssignMode(null);
    setSelectedTripId("");
    setAssigning(false);
  };

  const handleAssignExisting = () => {
    if (!selectedTripId) { toast.error("Seleccionar un viaje"); return; }
    assignToTrip(selectedTripId);
  };

  const timeAgo = (date: string) => {
    const h = Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000);
    if (h < 1) return "Hace menos de 1h";
    if (h < 24) return `Hace ${h}h`;
    const d = Math.floor(h / 24);
    return `Hace ${d}d`;
  };

  return (
    <div className="space-y-3">
      {/* Floating action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card className="glass-card border-primary/30 sticky top-0 z-10">
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
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="glass-card border-secondary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <User className="h-4 w-4 text-secondary" />
              Pedidos cliente pendientes
              <span className="text-xs font-normal text-muted-foreground">· Flota propia</span>
              {sortedRequests.length > 0 && (
                <Badge variant="outline" className="ml-1">{sortedRequests.length}</Badge>
              )}
            </CardTitle>
            {sortedRequests.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
                {selected.size === sortedRequests.length ? "Deseleccionar todo" : "Seleccionar todo"}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-1">
            <Info className="h-3 w-3" />
            Opcionales para logística — pueden sumarse a un viaje táctico o entregarse en el día.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : sortedRequests.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium text-sm">Sin pedidos cliente pendientes</p>
              <p className="text-xs mt-1">No hay pedidos con flota propia esperando entrega.</p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              <div className="space-y-1">
                {sortedRequests.map((r: any) => {
                  const fo = r.fulfillment_orders?.[0];
                  const doc = fo?.bims_invoice_number || r.bims_invoice_number || fo?.bims_transfer_number || "—";
                  const urgency = getUrgency(r.created_at);
                  const ucfg = urgencyConfig[urgency];
                  const originLabel = branchLabel(r.source_branch);
                  const clientName = fo?.destination_client_name || r.client_name || "Cliente sin nombre";

                  // Estado logístico visual
                  const hasTrip = !!fo?.trip_id;
                  const inHub = fo?.current_location_type === "branch" && fo?.current_custody_type === "branch" && r.status === "in_consolidation";
                  const withDriver = fo?.current_custody_type === "driver" || r.status === "in_transit";
                  const onVehicle = fo?.status === "on_vehicle";
                  const atHub = fo?.status === "at_hub";

                  let stateBadge: { label: string; icon: any; cls: string } | null = null;
                  if (atHub || inHub) {
                    const hubLabel = branchLabel(fo?.current_location_branch);
                    stateBadge = { label: `En acopio${hubLabel !== "—" ? ` · ${hubLabel}` : ""}`, icon: Warehouse, cls: "border-warning/40 text-warning" };
                  } else if (onVehicle || withDriver) {
                    stateBadge = { label: "En tránsito", icon: Truck, cls: "border-primary/40 text-primary" };
                  } else if (hasTrip) {
                    stateBadge = { label: "Asignado a viaje", icon: Truck, cls: "border-accent/40 text-accent" };
                  } else if (r.status === "ready_for_pickup") {
                    stateBadge = { label: "Listo p/ retiro", icon: Package, cls: "border-secondary/40 text-secondary" };
                  } else if (r.status === "in_preparation") {
                    stateBadge = { label: "En preparación", icon: Package, cls: "border-muted-foreground/40 text-muted-foreground" };
                  }

                  // Solo se puede asignar a viaje si todavía no fue retirado por un chofer ni asignado a viaje
                  const canAssign = !hasTrip && !withDriver && !atHub && !onVehicle;

                  return (
                    <motion.div
                      key={r.id}
                      layout
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -20, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 p-2.5 rounded bg-background/50 text-sm border ${ucfg.border}`}
                    >
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={() => canAssign && toggleSelect(r.id)}
                        disabled={!canAssign}
                        title={canAssign ? "" : "Ya está en circulación logística"}
                      />
                      <div className={`w-2 h-2 rounded-full shrink-0 ${ucfg.dot}`} />

                      {/* Ruta: origen → CLIENTE destacado */}
                      <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
                        <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={originLabel}>
                          {originLabel}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-display font-semibold text-sm text-foreground truncate max-w-[180px]" title={clientName}>
                          {clientName}
                        </span>
                      </div>

                      <Badge variant="outline" className="text-[10px] shrink-0 border-secondary/30 text-secondary">
                        Pedido Cliente
                      </Badge>

                      {stateBadge && (
                        <Badge variant="outline" className={`text-[10px] shrink-0 gap-1 ${stateBadge.cls}`}>
                          <stateBadge.icon className="h-3 w-3" />
                          {stateBadge.label}
                        </Badge>
                      )}

                      <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground shrink-0">
                        <span className="font-mono opacity-70">#{r.request_number}</span>
                        <span className="font-mono">{doc}</span>
                        {fo?.package_count > 0 && <span>{fo.package_count} bto.</span>}
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {timeAgo(r.created_at)}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </AnimatePresence>
          )}
        </CardContent>
      </Card>

      {/* Existing trip dialog */}
      <Dialog open={assignMode === "existing"} onOpenChange={(o) => !o && setAssignMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asignar a viaje existente</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Select value={selectedTripId} onValueChange={setSelectedTripId}>
              <SelectTrigger><SelectValue placeholder="Seleccionar viaje planificado" /></SelectTrigger>
              <SelectContent>
                {(plannedTrips || []).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    Viaje #{t.trip_number} — {(t.origin_branch as any)?.code} {t.vehicle ? `· ${(t.vehicle as any).plate_number}` : ""}
                  </SelectItem>
                ))}
                {plannedTrips && plannedTrips.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground">No hay viajes planificados</div>
                )}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignMode(null)} disabled={assigning}>Cancelar</Button>
            <Button onClick={handleAssignExisting} disabled={assigning || !selectedTripId}>
              {assigning ? "Asignando..." : "Asignar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New trip dialog */}
      <Dialog open={assignMode === "new"} onOpenChange={(o) => !o && setAssignMode(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crear viaje y asignar pedidos cliente</DialogTitle>
          </DialogHeader>
          <CrearViajeForm onSuccess={(tripId) => { setAssignMode(null); assignToTrip(tripId); }} onCancel={() => setAssignMode(null)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
