import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Package, MapPin, ArrowRight, Truck, Plus, AlertTriangle, Clock } from "lucide-react";
import { REQUEST_TYPE_LABELS } from "@/lib/constants";
import { toast } from "sonner";
import { CrearViajeForm } from "./CrearViajeForm";
import { motion, AnimatePresence } from "framer-motion";

const URGENCY_HOURS = 48;

function getUrgency(createdAt: string): "critical" | "warning" | "normal" {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  if (hours >= URGENCY_HOURS) return "critical";
  if (hours >= URGENCY_HOURS / 2) return "warning";
  return "normal";
}

const urgencyConfig = {
  critical: { dot: "bg-destructive", border: "border-destructive/30", label: "Atrasado", sortOrder: 0 },
  warning: { dot: "bg-warning", border: "border-warning/30", label: "Pendiente", sortOrder: 1 },
  normal: { dot: "bg-accent", border: "border-border/50", label: "Reciente", sortOrder: 2 },
};

/** Normaliza nombre de sucursal: "SUC. CABALLERO" → "CABALLERO", "SUC LUQUE" → "LUQUE" */
function branchLabel(b: any): string {
  if (!b) return "—";
  const raw = (b.name || b.code || "").toString().trim();
  return raw.replace(/^SUC\.?\s+/i, "").trim() || raw;
}

export function LogisticaConsolidacion() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignMode, setAssignMode] = useState<"existing" | "new" | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);

  const { data: requests, isLoading } = useQuery({
    queryKey: ["consolidation-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, flow_type, created_at, priority, 
          bims_invoice_number, bims_sale_reference, client_name, delivery_target, notes,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code, city),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code, city),
          fulfillment_orders!fulfillment_orders_branch_request_id_fkey(
            id, trip_id, package_count, bims_transfer_number, bims_invoice_number, status,
            current_location_branch:branches!fulfillment_orders_current_location_branch_id_fkey(code, name)
          )
        `)
        .eq("status", "in_consolidation" as any)
        .order("created_at", { ascending: true });
      if (error) throw error;
      // Incluye interurbanos + cualquier pedido cuyo fulfillment esté at_hub (urbanos dejados en acopio)
      return (data || []).filter((r: any) => {
        if (r.flow_type === "interurban") return true;
        const fo = r.fulfillment_orders?.[0];
        return fo?.status === "at_hub";
      });
    },
  });

  const { data: inconsistentRequests } = useQuery({
    queryKey: ["consolidation-inconsistent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, request_type, flow_type, created_at,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
          fulfillment_orders!fulfillment_orders_branch_request_id_fkey(status)
        `)
        .eq("status", "in_consolidation" as any)
        .or("flow_type.is.null,flow_type.neq.interurban")
        .order("created_at", { ascending: true });
      if (error) throw error;
      // Inconsistente = no interurbano y NO está en acopio (esos sí los mostramos en lista normal)
      return (data || []).filter((r: any) => {
        if (r.flow_type === "interurban") return false;
        const fo = r.fulfillment_orders?.[0];
        return fo?.status !== "at_hub";
      });
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

  // Sort by urgency then date
  const sortedRequests = useMemo(() => {
    if (!requests) return [];
    return [...requests].sort((a, b) => {
      const ua = urgencyConfig[getUrgency(a.created_at)].sortOrder;
      const ub = urgencyConfig[getUrgency(b.created_at)].sortOrder;
      if (ua !== ub) return ua - ub;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [requests]);

  // Group by destination (usa name limpio para que la cabecera sea legible)
  const byDest = useMemo(() => {
    const groups: Record<string, typeof sortedRequests> = {};
    sortedRequests.forEach(r => {
      const dest = branchLabel((r as any).requesting_branch);
      if (!groups[dest]) groups[dest] = [];
      groups[dest].push(r);
    });
    return groups;
  }, [sortedRequests]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!sortedRequests.length) return;
    if (selected.size === sortedRequests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedRequests.map(r => r.id)));
    }
  };

  const toggleGroup = (items: typeof sortedRequests) => {
    const ids = items.map(r => r.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const assignToTrip = async (tripId: string) => {
    setAssigning(true);
    const totalSelected = selected.size;
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

    const tripLabel = plannedTrips?.find((t: any) => t.id === tripId);
    const tripNum = tripLabel ? `#${(tripLabel as any).trip_number}` : "";

    if (success > 0) {
      toast.success(`✓ ${success} de ${totalSelected} carga(s) asignadas al viaje ${tripNum}`.trim(), {
        duration: 4000,
      });
      queryClient.invalidateQueries({ queryKey: ["consolidation-requests"] });
      queryClient.invalidateQueries({ queryKey: ["consolidation-inconsistent"] });
      queryClient.invalidateQueries({ queryKey: ["consolidation-count"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["planned-trips-for-assignment"] });
      queryClient.invalidateQueries({ queryKey: ["planned-count"] });
      queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-today-count"] });
    }
    if (errors.length > 0) {
      toast.error(`${errors.length} error(es): ${errors[0]}`, { duration: 6000 });
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

  const timeAgo = (date: string) => {
    const h = Math.floor((Date.now() - new Date(date).getTime()) / 3_600_000);
    if (h < 1) return "Hace menos de 1h";
    if (h < 24) return `Hace ${h}h`;
    const d = Math.floor(h / 24);
    return `Hace ${d}d`;
  };

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
                  No pueden asignarse a viajes. Revisar desde el detalle del pedido.
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

      {/* Floating action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <Card className="glass-card border-primary/30 sticky top-0 z-10">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-sm font-medium">{selected.size} carga(s) seleccionada(s)</span>
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

      {/* Main list */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" /> Cargas en consolidación
              {sortedRequests.length > 0 && <Badge variant="outline" className="ml-2">{sortedRequests.length}</Badge>}
            </CardTitle>
            {sortedRequests.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
                {selected.size === sortedRequests.length ? "Deseleccionar todo" : "Seleccionar todo"}
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
              <p className="font-medium">No hay cargas en consolidación</p>
              <p className="text-xs mt-1">Esperando retiros o preparación de sucursal</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byDest).map(([dest, items]) => {
                const groupIds = items!.map(r => r.id);
                const allGroupSelected = groupIds.every(id => selected.has(id));
                const someGroupSelected = groupIds.some(id => selected.has(id));
                return (
                  <div key={dest} className="p-3 rounded-lg bg-muted/20 border border-border/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={allGroupSelected}
                          className={someGroupSelected && !allGroupSelected ? "opacity-60" : ""}
                          onCheckedChange={() => toggleGroup(items!)}
                        />
                        <MapPin className="h-4 w-4 text-primary" />
                        <span className="font-display font-semibold text-sm tracking-wide">Destino: <span className="text-primary">{dest}</span></span>
                        <Badge variant="outline" className="text-xs">{items!.length} carga(s)</Badge>
                      </div>
                      {selected.size === 0 && items!.length > 1 && (
                        <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => toggleGroup(items!)}>
                          Seleccionar grupo
                        </Button>
                      )}
                    </div>
                    <AnimatePresence mode="popLayout">
                      <div className="space-y-1">
                        {items!.map((r: any) => {
                          const fo = r.fulfillment_orders?.[0];
                          const doc = fo?.bims_transfer_number || fo?.bims_invoice_number || r.bims_invoice_number || "—";
                          const urgency = getUrgency(r.created_at);
                          const ucfg = urgencyConfig[urgency];
                          const atHub = fo?.status === "at_hub";
                          const hub = fo?.current_location_branch as any;
                          const hubLabel = hub ? branchLabel(hub) : null;
                          const originLabel = branchLabel(r.source_branch);
                          const destLabel = branchLabel(r.requesting_branch);
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
                                onCheckedChange={() => toggleSelect(r.id)}
                              />
                              <div className={`w-2 h-2 rounded-full shrink-0 ${ucfg.dot}`} title={ucfg.label} />

                              {/* Ruta: origen tenue → DESTINO destacado */}
                              <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
                                <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={originLabel}>
                                  {originLabel}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="font-display font-semibold text-sm text-foreground truncate max-w-[140px]" title={destLabel}>
                                  {destLabel}
                                </span>
                              </div>

                              {atHub && (
                                <Badge className="text-[10px] shrink-0 bg-info/10 text-info border-info/20" variant="outline">
                                  En acopio{hubLabel ? ` · ${hubLabel}` : ""}
                                </Badge>
                              )}

                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                              </Badge>

                              {/* Bloque secundario: #pedido, doc, bultos, antigüedad */}
                              <div className="flex items-center gap-3 ml-auto text-[11px] text-muted-foreground shrink-0">
                                <span className="font-mono opacity-70" title="Número de pedido">#{r.request_number}</span>
                                <span className="font-mono" title="Documento BIMS">{doc}</span>
                                {fo?.package_count > 0 && (
                                  <span>{fo.package_count} bto.</span>
                                )}
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
                  </div>
                );
              })}
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
            <p className="text-sm text-muted-foreground">{selected.size} carga(s) seleccionada(s)</p>
            <Select value={selectedTripId} onValueChange={setSelectedTripId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar viaje..." />
              </SelectTrigger>
              <SelectContent>
                {plannedTrips?.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    Viaje #{t.trip_number} — {branchName(t.origin_branch as any)}
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
              {assigning ? "Asignando..." : `Asignar ${selected.size} carga(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create trip and assign dialog */}
      <Dialog open={assignMode === "new"} onOpenChange={(o) => !o && setAssignMode(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear viaje y asignar {selected.size} carga(s)</DialogTitle>
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
