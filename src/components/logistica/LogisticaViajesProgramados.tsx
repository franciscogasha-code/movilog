import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, Truck, Plus, Package, X, User, Clock, ShoppingBag } from "lucide-react";
import { TRIP_TYPE_LABELS } from "@/lib/constants";
import { branchLabel } from "@/lib/branch-format";
import { CrearViajeForm } from "./CrearViajeForm";
import { LogisticaViajeDetalle } from "./LogisticaViajeDetalle";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationBar } from "@/components/shared/PaginationBar";

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

  const {
    rows: tripsBase,
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
    queryKey: ["planned-trips"],
    initialPageSize: 25,
    buildQuery: () =>
      supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate, brand, model),
          driver:drivers!trips_driver_id_fkey(id, user_id)
        `, { count: "exact" })
        .eq("status", "planned" as any)
        .order("planned_departure", { ascending: true, nullsFirst: false }),
  });

  // Resolver nombres de chofer aparte (sólo para la página visible)
  const { data: trips } = useQuery({
    queryKey: ["planned-trips-driver-names", tripsBase.map((t: any) => t.driver?.user_id).filter(Boolean)],
    enabled: tripsBase.length > 0,
    queryFn: async () => {
      const userIds = Array.from(new Set(tripsBase.map((t: any) => t.driver?.user_id).filter(Boolean)));
      let nameByUser: Record<string, string> = {};
      if (userIds.length) {
        const { data: profs } = await supabase
          .from("profiles").select("user_id, full_name").in("user_id", userIds);
        nameByUser = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p.full_name]));
      }
      return tripsBase.map((t: any) => ({
        ...t,
        driver_name: t.driver?.user_id ? nameByUser[t.driver.user_id] ?? "Sin chofer" : "Sin chofer",
      }));
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
      // Usa RPC con trazabilidad: valida cargas server-side, registra evento operativo
      // y respeta permisos por rol. Reemplaza el UPDATE directo silencioso.
      const { error } = await supabase.rpc("fn_cancel_trip" as any, { p_trip_id: tripId });
      if (error) throw error;
      toast.success("Viaje cancelado");
      queryClient.invalidateQueries({ queryKey: ["planned-trips"] });
      queryClient.invalidateQueries({ queryKey: ["planned-count"] });
      queryClient.invalidateQueries({ queryKey: ["trip-load-counts"] });
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
            <Badge variant="outline" className="ml-2">{total}</Badge>
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
                const driverName = (t as any).driver_name || "Sin chofer";
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
                        <span className="text-xs font-medium">{branchLabel(t.origin_branch as any)}</span>
                        {t.destination_description && (
                          <>
                            <span className="text-xs text-muted-foreground">→</span>
                            <span className="text-xs font-medium">{t.destination_description}</span>
                          </>
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
