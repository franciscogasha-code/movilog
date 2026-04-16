import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, Package, MapPin, Clock } from "lucide-react";
import { TRIP_TYPE_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";
import { LogisticaViajeDetalle } from "./LogisticaViajeDetalle";

export function LogisticaViajesEnCurso() {
  const [detailTripId, setDetailTripId] = useState<string | null>(null);

  const { data: trips, isLoading } = useQuery({
    queryKey: ["in-progress-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id, profiles:user_id(full_name))
        `)
        .eq("status", "in_progress" as any)
        .order("actual_departure", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fulfillments for all active trips
  const { data: tripFulfillments } = useQuery({
    queryKey: ["active-trip-fulfillments"],
    queryFn: async () => {
      if (!trips?.length) return [];
      const tripIds = trips.map(t => t.id);
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          id, trip_id, status, package_count,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(code)
        `)
        .in("trip_id", tripIds);
      if (error) throw error;
      return data;
    },
    enabled: !!trips?.length,
  });

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" /> Viajes en curso
            {trips && <Badge variant="outline" className="ml-2">{trips.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : !trips?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay viajes en curso</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((t: any) => {
                const driverName = (t.driver as any)?.profiles?.full_name || "Sin chofer";
                const loads = tripFulfillments?.filter(f => f.trip_id === t.id) || [];
                const delivered = loads.filter(f => ["delivered", "received", "completed"].includes(f.status));
                return (
                  <div
                    key={t.id}
                    className="p-3 rounded-lg bg-muted/20 border border-accent/20 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setDetailTripId(t.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                        <span className="font-mono font-semibold text-sm">#{t.trip_number}</span>
                        <span className="text-xs text-muted-foreground">{(t.origin_branch as any)?.code}</span>
                        {(t as any).destination_description && (
                          <span className="text-xs text-muted-foreground">→ {(t as any).destination_description}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{driverName}</span>
                        <Badge variant="outline" className="text-xs">
                          {TRIP_TYPE_LABELS[t.trip_type] || t.trip_type}
                        </Badge>
                        <Badge variant="default" className="text-xs">En curso</Badge>
                      </div>
                    </div>
                    {loads.length > 0 && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground pl-5">
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" /> {loads.length} cargas
                        </span>
                        <span>Entregadas: {delivered.length}/{loads.length}</span>
                        {t.start_mileage && (
                          <span>Km inicio: {t.start_mileage}</span>
                        )}
                        {t.actual_departure && (
                          <span>Salida: {new Date(t.actual_departure).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
