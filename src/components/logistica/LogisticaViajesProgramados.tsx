import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Truck, Plus, Package, X, User, Clock, ShoppingBag } from "lucide-react";
import { TRIP_TYPE_LABELS } from "@/lib/constants";
import { CrearViajeForm } from "./CrearViajeForm";
import { LogisticaViajeDetalle } from "./LogisticaViajeDetalle";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

export function LogisticaViajesProgramados() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailTripId, setDetailTripId] = useState<string | null>(null);

  useEffect(() => {
    const tripIdFromUrl = searchParams.get("detail");
    if (!tripIdFromUrl) return;

    setDetailTripId(tripIdFromUrl);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("detail");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: trips, isLoading } = useQuery({
    queryKey: ["planned-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id, profiles:user_id(full_name))
        `)
        .eq("status", "planned" as any)
        .order("planned_departure", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: tripLoadCounts } = useQuery({
    queryKey: ["trip-load-counts"],
    queryFn: async () => {
      if (!trips?.length) return {};
      const tripIds = trips.map(t => t.id);
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("trip_id")
        .in("trip_id", tripIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach(f => {
        counts[f.trip_id!] = (counts[f.trip_id!] || 0) + 1;
      });
      return counts;
    },
    enabled: !!trips?.length,
  });

  const cancelTrip = async (tripId: string) => {
    const count = tripLoadCounts?.[tripId] || 0;
    if (count > 0) {
      toast.error("No se puede cancelar un viaje con cargas asignadas. Quite las cargas primero.");
      return;
    }
    try {
      const { error } = await supabase
        .from("trips")
        .update({ status: "cancelled" as any })
        .eq("id", tripId);
      if (error) throw error;
      toast.success("Viaje cancelado");
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["planned-count"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Crear viaje
        </Button>
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" /> Viajes programados
            {trips && <Badge variant="outline" className="ml-2">{trips.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : !trips?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No hay viajes programados</p>
              <p className="text-xs mt-1">Crear un viaje para comenzar a asignar cargas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trips.map((t: any) => {
                const loadCount = tripLoadCounts?.[t.id] || 0;
                const driverName = (t.driver as any)?.profiles?.full_name || "Sin chofer";
                const isSupplier = t.trip_type === "supplier_pickup";
                return (
                  <div
                    key={t.id}
                    className="p-3 rounded-lg bg-muted/20 border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setDetailTripId(t.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isSupplier ? (
                          <ShoppingBag className="h-4 w-4 text-warning" />
                        ) : (
                          <Truck className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-mono font-semibold text-sm">#{t.trip_number}</span>
                        <span className="text-xs text-muted-foreground">{(t.origin_branch as any)?.code}</span>
                        {t.destination_description && (
                          <span className="text-xs text-muted-foreground">→ {t.destination_description}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); cancelTrip(t.id); }}
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 pl-7 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" /> {driverName}
                      </span>
                      {(t.vehicle as any)?.plate && (
                        <span className="flex items-center gap-1">
                          <Truck className="h-3 w-3" /> {(t.vehicle as any).plate}
                        </span>
                      )}
                      <Badge variant={isSupplier ? "secondary" : "outline"} className="text-[10px]">
                        {isSupplier && <ShoppingBag className="h-3 w-3 mr-0.5" />}
                        {TRIP_TYPE_LABELS[t.trip_type] || t.trip_type}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" /> {loadCount} carga(s)
                      </span>
                      {(t as any).planned_departure && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date((t as any).planned_departure).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Crear viaje</DialogTitle>
          </DialogHeader>
          <CrearViajeForm
            onSuccess={(tripId) => {
              setCreateOpen(false);
              queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
              queryClient.invalidateQueries({ queryKey: ["planned-count"] });
              setDetailTripId(tripId);
            }}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailTripId} onOpenChange={(o) => !o && setDetailTripId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del viaje</DialogTitle>
          </DialogHeader>
          {detailTripId && <LogisticaViajeDetalle tripId={detailTripId} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
