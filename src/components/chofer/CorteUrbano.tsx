import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Play, Square, MapPin, Clock, AlertTriangle } from "lucide-react";
import { CorteDetalle } from "./CorteDetalle";
import { toast } from "sonner";

interface Props {
  cutoffs: any[];
  activeCutoff: any | undefined;
}

export function CorteUrbano({ cutoffs, activeCutoff }: Props) {
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showEndWarning, setShowEndWarning] = useState(false);
  const [pendingCustodyCount, setPendingCustodyCount] = useState(0);

  const startCutoff = async () => {
    setStarting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciar sesión"); return; }

      // Get driver record
      const { data: driver } = await supabase
        .from("drivers")
        .select("id, assigned_vehicle_id, assigned_branch_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!driver) { toast.error("No estás registrado como chofer"); return; }
      if (!driver.assigned_vehicle_id) {
        toast.warning("Iniciando corte sin vehículo asignado");
      }

      // Resolve origin branch: driver assignment → profile default → first allowed branch → central warehouse → first active
      let originBranchId: string | null = driver.assigned_branch_id ?? null;
      if (!originBranchId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, default_branch_id, all_branches_access")
          .eq("user_id", user.id)
          .maybeSingle();
        originBranchId = profile?.default_branch_id ?? null;

        if (!originBranchId && profile?.id && !profile.all_branches_access) {
          const { data: access } = await supabase
            .from("profile_branch_access")
            .select("branch_id")
            .eq("profile_id", profile.id)
            .limit(1)
            .maybeSingle();
          originBranchId = access?.branch_id ?? null;
        }

        // Global access fallback: central warehouse, then any active branch
        if (!originBranchId) {
          const { data: central } = await supabase
            .from("branches")
            .select("id")
            .eq("is_active", true)
            .eq("is_central_warehouse", true)
            .limit(1)
            .maybeSingle();
          originBranchId = central?.id ?? null;
        }
        if (!originBranchId) {
          const { data: anyBranch } = await supabase
            .from("branches")
            .select("id")
            .eq("is_active", true)
            .order("code", { ascending: true })
            .limit(1)
            .maybeSingle();
          originBranchId = anyBranch?.id ?? null;
        }
      }

      if (!originBranchId) {
        toast.error("No se pudo determinar la sucursal de origen. Configurá una sucursal por defecto en tu perfil.");
        return;
      }

      const { data: trip, error } = await supabase
        .from("trips")
        .insert({
          driver_id: driver.id,
          vehicle_id: driver.assigned_vehicle_id ?? null,
          origin_branch_id: originBranchId,
          trip_type: "urban_cutoff" as any,
          status: "in_progress" as any,
          cutoff_started_at: new Date().toISOString(),
          actual_departure: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // Log event
      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: trip.id,
        event_type: "cutoff_started",
        category: "logistics" as any,
        event_description: "Inicio de corte urbano",
        new_status: "in_progress",
        triggered_by: user.id,
      });

      toast.success(`Corte #${trip.trip_number} iniciado`);
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setStarting(false);
    }
  };

  const attemptEndCutoff = async () => {
    if (!activeCutoff) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check custody
      const { count } = await supabase
        .from("fulfillment_orders")
        .select("id", { count: "exact", head: true })
        .eq("current_custody_holder_id", user.id)
        .in("status", ["in_transit", "dispatched", "delivery_failed"] as any[]);

      if (count && count > 0) {
        setPendingCustodyCount(count);
        setShowEndWarning(true);
      } else {
        await doEndCutoff();
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const doEndCutoff = async () => {
    if (!activeCutoff) return;
    setShowEndWarning(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from("trips")
        .update({
          status: "completed" as any,
          cutoff_ended_at: new Date().toISOString(),
          actual_arrival: new Date().toISOString(),
        })
        .eq("id", activeCutoff.id);

      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: activeCutoff.id,
        event_type: "cutoff_ended",
        category: "logistics" as any,
        event_description: "Fin de corte urbano",
        previous_status: "in_progress",
        new_status: "completed",
        triggered_by: user.id,
      });

      toast.success("Corte finalizado");
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex gap-3">
        {!activeCutoff ? (
          <Button onClick={startCutoff} disabled={starting} className="gap-2">
            <Play className="h-4 w-4" />
            {starting ? "Iniciando..." : "Iniciar Corte"}
          </Button>
        ) : (
          <Button onClick={attemptEndCutoff} variant="destructive" className="gap-2">
            <Square className="h-4 w-4" />
            Finalizar Corte #{activeCutoff.trip_number}
          </Button>
        )}
      </div>

      {/* Info: out of cutoff */}
      {!activeCutoff && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-sm">
          <AlertTriangle className="h-4 w-4 text-secondary shrink-0" />
          <span className="text-foreground">
            Sin corte activo. Los retiros realizados se registrarán como <strong>movimiento fuera de corte</strong>.
          </span>
        </div>
      )}

      {/* Active cutoff detail */}
      {activeCutoff && (
        <Card className="glass-card border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Corte #{activeCutoff.trip_number} en curso
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex items-center gap-4 text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Inicio: {new Date(activeCutoff.cutoff_started_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {activeCutoff.origin_branch?.code}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDetailId(activeCutoff.id)} className="gap-2">
              <MapPin className="h-4 w-4" /> Ver cargas del corte
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Recent cutoffs */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Cortes recientes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!cutoffs.length ? (
            <div className="p-6 text-center text-muted-foreground">No hay cortes registrados</div>
          ) : (
            <div className="divide-y divide-border/50">
              {cutoffs.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setDetailId(c.id)}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${c.status === "in_progress" ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                    <div>
                      <span className="font-mono font-semibold text-sm">#{c.trip_number}</span>
                      <span className="text-muted-foreground text-xs ml-2">{c.origin_branch?.code}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.status === "in_progress" ? "default" : "outline"} className="text-xs">
                      {c.status === "in_progress" ? "En curso" : c.status === "completed" ? "Completado" : c.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
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
            <DialogTitle>Detalle del Corte</DialogTitle>
          </DialogHeader>
          {detailId && <CorteDetalle tripId={detailId} />}
        </DialogContent>
      </Dialog>

      {/* Custody warning on end */}
      <AlertDialog open={showEndWarning} onOpenChange={setShowEndWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-secondary" /> Cargas bajo custodia
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tenés <strong>{pendingCustodyCount}</strong> carga(s) aún bajo tu custodia. ¿Querés finalizar el corte de todas formas?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doEndCutoff}>Finalizar igual</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
