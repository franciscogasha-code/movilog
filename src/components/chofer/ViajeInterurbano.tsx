import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Play, Square, MapPin, Truck, Plus, CheckCircle2, Clock } from "lucide-react";
import { CorteDetalle } from "./CorteDetalle";
import { toast } from "sonner";

interface Props {
  trips: any[];
  activeTrip: any | undefined;
}

export function ViajeInterurbano({ trips, activeTrip }: Props) {
  const queryClient = useQueryClient();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startMileage, setStartMileage] = useState("");

  const startTrip = async () => {
    if (!startMileage) { toast.error("Ingresar kilometraje inicial"); return; }
    setStarting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciar sesión"); return; }

      const { data: driver } = await supabase
        .from("drivers")
        .select("id, assigned_vehicle_id, assigned_branch_id")
        .eq("user_id", user.id)
        .single();

      if (!driver) { toast.error("No estás registrado como chofer"); return; }
      if (!driver.assigned_vehicle_id) { toast.error("No tenés vehículo asignado"); return; }

      const { data: trip, error } = await supabase
        .from("trips")
        .insert({
          driver_id: driver.id,
          vehicle_id: driver.assigned_vehicle_id,
          origin_branch_id: driver.assigned_branch_id!,
          trip_type: "interurban_planned" as any,
          status: "in_progress" as any,
          actual_departure: new Date().toISOString(),
          start_mileage: parseInt(startMileage),
        })
        .select()
        .single();

      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: trip.id,
        event_type: "trip_started",
        category: "logistics" as any,
        event_description: "Inicio de viaje interurbano",
        new_status: "in_progress",
        triggered_by: user.id,
        metadata: { start_mileage: parseInt(startMileage) },
      });

      toast.success(`Viaje #${trip.trip_number} iniciado`);
      setStartMileage("");
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  };

  const endTrip = async () => {
    if (!activeTrip) return;
    const endMileage = prompt("Kilometraje final:");
    if (!endMileage) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("trips")
        .update({
          status: "completed" as any,
          actual_arrival: new Date().toISOString(),
          end_mileage: parseInt(endMileage),
        })
        .eq("id", activeTrip.id);

      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: activeTrip.id,
        event_type: "trip_completed",
        category: "logistics" as any,
        event_description: "Fin de viaje interurbano",
        previous_status: "in_progress",
        new_status: "completed",
        triggered_by: user.id,
        metadata: { end_mileage: parseInt(endMileage) },
      });

      toast.success("Viaje finalizado");
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Start / End */}
      {!activeTrip ? (
        <Card className="glass-card">
          <CardContent className="p-4 space-y-3">
            <h4 className="font-display font-semibold text-sm">Iniciar viaje interurbano</h4>
            <div className="flex gap-3 items-end">
              <div className="space-y-1 flex-1 max-w-[200px]">
                <Label className="text-xs">Km inicial</Label>
                <Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} placeholder="0" />
              </div>
              <Button onClick={startTrip} disabled={starting} className="gap-2">
                <Play className="h-4 w-4" />
                {starting ? "Iniciando..." : "Iniciar Viaje"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card border-accent/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <div>
                  <span className="font-display font-semibold">Viaje #{activeTrip.trip_number} en curso</span>
                  <p className="text-xs text-muted-foreground">
                    Desde {(activeTrip as any).origin_branch?.code} — Km inicio: {activeTrip.start_mileage || "—"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDetailId(activeTrip.id)} className="gap-1">
                  <MapPin className="h-3.5 w-3.5" /> Detalle
                </Button>
                <Button variant="destructive" size="sm" onClick={endTrip} className="gap-1">
                  <Square className="h-3.5 w-3.5" /> Finalizar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trip list */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Viajes recientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!trips.length ? (
            <div className="p-6 text-center text-muted-foreground">No hay viajes registrados</div>
          ) : (
            <div className="divide-y divide-border/50">
              {trips.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setDetailId(t.id)}>
                  <div className="flex items-center gap-3">
                    <Truck className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-mono font-semibold text-sm">#{t.trip_number}</span>
                      <span className="text-muted-foreground text-xs ml-2">{t.origin_branch?.code}</span>
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
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Viaje</DialogTitle>
          </DialogHeader>
          {detailId && <CorteDetalle tripId={detailId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
