import { categoryForTripEvent } from "@/lib/event-categories";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Play, Square, MapPin, Truck, Plus, Route, AlertTriangle, Calendar } from "lucide-react";
import { CorteDetalle } from "./CorteDetalle";
import { AgregarTareaViaje } from "./AgregarTareaViaje";
import { branchName } from "@/lib/branch-format";
import { CrearViajeForm } from "@/components/logistica/CrearViajeForm";
import { TRIP_TYPE_LABELS } from "@/lib/constants";
import { toast } from "sonner";

interface Props {
  trips: any[];
  activeTrip: any | undefined;
  myDriverId?: string;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  pickup_branch: "Retiro sucursal",
  delivery_client: "Entrega cliente",
  pickup_supplier: "Retiro proveedor",
};

export function ViajeInterurbano({ trips, activeTrip, myDriverId }: Props) {
  const { user, isOwner, hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [createTripOpen, setCreateTripOpen] = useState(false);
  const [startingTripId, setStartingTripId] = useState<string | null>(null);
  const [startMileage, setStartMileage] = useState("");
  const [showEndWarning, setShowEndWarning] = useState(false);
  const [pendingCustodyCount, setPendingCustodyCount] = useState(0);
  const [endMileageValue, setEndMileageValue] = useState<number | null>(null);
  const [showEmptyTripWarning, setShowEmptyTripWarning] = useState(false);
  const [pendingStartTripId, setPendingStartTripId] = useState<string | null>(null);

  const isManagementUser =
    isOwner ||
    hasRole("admin") ||
    hasRole("supervisor") ||
    hasRole("jefe_logistica");

  const canCreateTrip = isManagementUser || hasRole("warehouse_operator");

  // Planned trips assigned to this driver (not yet started)
  const plannedTrips = trips.filter(t => t.status === "planned");

  const checkAndStartTrip = async (tripId: string) => {
    if (!startMileage) { toast.error("Ingresar kilometraje inicial"); return; }
    // Check if trip has assigned loads
    const { count } = await supabase
      .from("fulfillment_orders")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId);
    if (!count || count === 0) {
      setPendingStartTripId(tripId);
      setShowEmptyTripWarning(true);
      return;
    }
    await doStartTrip(tripId);
  };

  const doStartTrip = async (tripId: string) => {
    setShowEmptyTripWarning(false);
    setPendingStartTripId(null);
    try {
      const { error } = await supabase
        .from("trips")
        .update({
          status: "in_progress" as any,
          actual_departure: new Date().toISOString(),
          start_mileage: parseInt(startMileage),
        })
        .eq("id", tripId);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip", reference_id: tripId, event_type: "trip_started",
        category: categoryForTripEvent("trip_started"), event_description: "Inicio de viaje interurbano",
        new_status: "in_progress", triggered_by: user!.id,
        metadata: { start_mileage: parseInt(startMileage) },
      });

      toast.success("Viaje iniciado");
      setStartMileage("");
      setStartingTripId(null);
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const attemptEndTrip = async () => {
    if (!activeTrip) return;
    const mileage = prompt("Kilometraje final:");
    if (!mileage) return;

    try {
      const { count } = await supabase
        .from("fulfillment_orders")
        .select("id", { count: "exact", head: true })
        .eq("current_custody_holder_id", user!.id)
        .in("status", ["in_transit", "dispatched", "delivery_failed"] as any[]);

      if (count && count > 0) {
        setPendingCustodyCount(count);
        setEndMileageValue(parseInt(mileage));
        setShowEndWarning(true);
      } else {
        await doEndTrip(parseInt(mileage));
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const doEndTrip = async (endMileage?: number) => {
    if (!activeTrip) return;
    setShowEndWarning(false);
    const mileage = endMileage || endMileageValue;
    try {
      const { error } = await supabase
        .from("trips")
        .update({ status: "completed" as any, actual_arrival: new Date().toISOString(), end_mileage: mileage })
        .eq("id", activeTrip.id);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip", reference_id: activeTrip.id, event_type: "trip_completed",
        category: categoryForTripEvent("trip_completed"), event_description: "Fin de viaje interurbano",
        previous_status: "in_progress", new_status: "completed", triggered_by: user!.id,
        metadata: { end_mileage: mileage },
      });

      toast.success("Viaje finalizado");
      setEndMileageValue(null);
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const plannedStops = (activeTrip?.planned_stops as any[]) || [];
  const originalTasks = plannedStops.filter((s: any) => !s.added_in_transit);
  const transitTasks = plannedStops.filter((s: any) => s.added_in_transit);

  return (
    <div className="space-y-4">
      {/* Create trip action — visible only for logistics/admin roles */}
      {canCreateTrip && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateTripOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Crear viaje
          </Button>
        </div>
      )}

      {/* Active trip */}
      {activeTrip ? (
        <Card className="glass-card border-accent/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <div>
                  <span className="font-display font-semibold">Viaje #{activeTrip.trip_number} en curso</span>
                  <p className="text-xs text-muted-foreground">
                    Desde {branchName((activeTrip as any).origin_branch)} — Km inicio: {activeTrip.start_mileage || "—"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setAddTaskOpen(true)} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> Agregar tarea
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetailId(activeTrip.id)} className="gap-1">
                  <MapPin className="h-3.5 w-3.5" /> Detalle
                </Button>
                <Button variant="destructive" size="sm" onClick={attemptEndTrip} className="gap-1">
                  <Square className="h-3.5 w-3.5" /> Finalizar
                </Button>
              </div>
            </div>

            {plannedStops.length > 0 && (
              <div className="space-y-2 mt-2">
                {originalTasks.length > 0 && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tareas planificadas</h5>
                    {originalTasks.map((stop: any, idx: number) => (
                      <div key={stop.id || idx} className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm">
                        <span className={`w-2 h-2 rounded-full ${stop.completed ? "bg-accent" : "bg-muted-foreground/30"}`} />
                        <span className="font-medium">{TASK_TYPE_LABELS[stop.type] || stop.type}</span>
                        {stop.client_name && <span className="text-muted-foreground">— {stop.client_name}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {transitTasks.length > 0 && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1">
                      <Route className="h-3 w-3" /> Agregadas en ruta
                    </h5>
                    {transitTasks.map((stop: any, idx: number) => (
                      <div key={stop.id || idx} className="flex items-center gap-2 p-2 rounded bg-secondary/5 border border-secondary/15 text-sm">
                        <span className={`w-2 h-2 rounded-full ${stop.completed ? "bg-accent" : "bg-secondary/50"}`} />
                        <span className="font-medium">{TASK_TYPE_LABELS[stop.type] || stop.type}</span>
                        {stop.client_name && <span className="text-muted-foreground">— {stop.client_name}</span>}
                        <Badge variant="outline" className="text-xs ml-auto text-secondary border-secondary/30">
                          <Route className="h-3 w-3 mr-1" /> En ruta
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : plannedTrips.length > 0 ? (
        /* Planned trips assigned to me — ready to start */
        <div className="space-y-2">
          {plannedTrips.map(t => (
            <Card key={t.id} className="glass-card">
              <CardContent className="p-4">
                {startingTripId === t.id ? (
                  <div className="flex gap-3 items-end">
                    <div className="space-y-1 flex-1 max-w-[200px]">
                      <Label className="text-xs">Km inicial</Label>
                      <Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} placeholder="0" />
                    </div>
                    <Button onClick={() => checkAndStartTrip(t.id)} className="gap-2">
                      <Play className="h-4 w-4" /> Iniciar
                    </Button>
                    <Button variant="ghost" onClick={() => setStartingTripId(null)}>Cancelar</Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="font-mono font-semibold text-sm">Viaje #{t.trip_number}</span>
                        <span className="text-xs text-muted-foreground ml-2">{branchName(t.origin_branch)}</span>
                        {(t as any).destination_description && (
                          <span className="text-xs text-muted-foreground ml-1">→ {(t as any).destination_description}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {TRIP_TYPE_LABELS[t.trip_type] || t.trip_type}
                      </Badge>
                      <Badge variant="outline" className="text-xs">Programado</Badge>
                      <Button size="sm" onClick={() => setStartingTripId(t.id)} className="gap-1">
                        <Play className="h-3.5 w-3.5" /> Iniciar viaje
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isManagementUser ? (
        <Card className="glass-card">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            <Calendar className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="font-medium">No hay viajes asignados a tu usuario en este panel</p>
            <p className="mt-1 text-xs">La gestión global de viajes programados se realiza en Ruteo.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/ruteo?tab=programados")}>
              Ver viajes programados
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            <Calendar className="h-6 w-6 mx-auto mb-2 opacity-50" />
            No hay viajes programados asignados
          </CardContent>
        </Card>
      )}

      {/* Recent trips list */}
      {trips.filter(t => t.status !== "planned").length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg">Viajes recientes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {trips.filter(t => t.status !== "planned").map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setDetailId(t.id)}>
                  <div className="flex items-center gap-3">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-mono font-semibold text-sm">#{t.trip_number}</span>
                      <span className="text-muted-foreground text-xs ml-2">{branchName(t.origin_branch)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.start_mileage && t.end_mileage && (
                      <span className="text-xs text-muted-foreground">{t.end_mileage - t.start_mileage} km</span>
                    )}
                    <Badge variant={t.status === "in_progress" ? "default" : "outline"} className="text-xs">
                      {t.status === "in_progress" ? "En curso" : t.status === "completed" ? "Completado" : t.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Viaje</DialogTitle>
          </DialogHeader>
          {detailId && <CorteDetalle tripId={detailId} />}
        </DialogContent>
      </Dialog>

      {/* Add task dialog */}
      {activeTrip && (
        <Dialog open={addTaskOpen} onOpenChange={setAddTaskOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Agregar tarea al viaje #{activeTrip.trip_number}</DialogTitle>
            </DialogHeader>
            <AgregarTareaViaje tripId={activeTrip.id} onSuccess={() => setAddTaskOpen(false)} />
          </DialogContent>
        </Dialog>
      )}

      {/* Custody warning on end */}
      <AlertDialog open={showEndWarning} onOpenChange={setShowEndWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-secondary" /> Cargas bajo custodia
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tenés <strong>{pendingCustodyCount}</strong> carga(s) aún bajo tu custodia. ¿Querés finalizar el viaje de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => doEndTrip()}>Finalizar igual</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Empty trip warning */}
      <AlertDialog open={showEmptyTripWarning} onOpenChange={setShowEmptyTripWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-secondary" /> Viaje sin cargas asignadas
            </AlertDialogTitle>
            <AlertDialogDescription>
              Este viaje no tiene cargas asignadas todavía. Normalmente, logística asigna las cargas antes de la salida.
              ¿Querés iniciarlo de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingStartTripId && doStartTrip(pendingStartTripId)}>
              Iniciar sin cargas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create trip dialog */}
      <Dialog open={createTripOpen} onOpenChange={setCreateTripOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear viaje</DialogTitle>
          </DialogHeader>
          <CrearViajeForm
            onSuccess={(tripId) => {
              setCreateTripOpen(false);
              queryClient.invalidateQueries({ queryKey: ["active-trips"] });
              queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
              queryClient.invalidateQueries({ queryKey: ["planned-count"] });

              if (isManagementUser) {
                navigate(`/ruteo?tab=programados&detail=${tripId}`);
              }
            }}
            onCancel={() => setCreateTripOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
