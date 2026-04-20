import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, Package, Clock, User, ShoppingBag } from "lucide-react";
import { TRIP_TYPE_LABELS } from "@/lib/constants";
import { branchLabel } from "@/lib/branch-format";
import { LogisticaViajeDetalle } from "./LogisticaViajeDetalle";
import { Progress } from "@/components/ui/progress";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationBar } from "@/components/shared/PaginationBar";

export function LogisticaViajesEnCurso() {
  const [detailTripId, setDetailTripId] = useState<string | null>(null);

  const {
    rows: trips,
    total,
    page,
    pageSize,
    totalPages,
    from,
    to,
    isLoading,
    isFetching,
    setPage,
  } = usePaginatedQuery<any>({
    queryKey: ["in-progress-trips"],
    initialPageSize: 25,
    buildQuery: () =>
      supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id, profiles:user_id(full_name))
        `, { count: "exact" })
        .eq("status", "in_progress" as any)
        .order("actual_departure", { ascending: false }),
  });

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
            <Clock className="h-4 w-4 text-warning" /> Viajes en curso
            <Badge variant="outline" className="ml-2">{total}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
          ) : !trips?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No hay viajes en curso</p>
              <p className="text-xs mt-1">Los viajes iniciados por los choferes aparecerán aquí</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((t: any) => {
                const driverName = (t.driver as any)?.profiles?.full_name || "Sin chofer";
                const loads = tripFulfillments?.filter(f => f.trip_id === t.id) || [];
                const delivered = loads.filter(f => ["delivered", "received", "completed"].includes(f.status));
                const progress = loads.length > 0 ? Math.round((delivered.length / loads.length) * 100) : 0;
                const isSupplier = t.trip_type === "supplier_pickup";
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
                        <span className="text-xs font-medium">{branchLabel(t.origin_branch as any)}</span>
                        {(t as any).destination_description && (
                          <>
                            <span className="text-xs text-muted-foreground">→</span>
                            <span className="text-xs font-medium">{(t as any).destination_description}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={isSupplier ? "secondary" : "outline"} className="text-[10px]">
                          {isSupplier && <ShoppingBag className="h-3 w-3 mr-0.5" />}
                          {TRIP_TYPE_LABELS[t.trip_type] || t.trip_type}
                        </Badge>
                        <Badge variant="default" className="text-[10px]">En curso</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pl-5 mb-2">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" /> {driverName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" /> {loads.length} carga(s)
                      </span>
                      <span>Entregadas: {delivered.length}/{loads.length}</span>
                      {t.actual_departure && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Salida: {new Date(t.actual_departure).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    {loads.length > 0 && (
                      <div className="pl-5">
                        <Progress value={progress} className="h-1.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        {!isLoading && total > 0 && (
          <PaginationBar
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            from={from}
            to={to}
            onPageChange={setPage}
            isFetching={isFetching}
            itemLabel="viajes"
          />
        )}
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
