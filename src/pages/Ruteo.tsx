import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Route, MapPin, Truck, Package, Clock, ArrowRight, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { SHIPPING_METHOD_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";

export default function Ruteo() {
  // Pending fulfillments that need route assignment
  const { data: unassigned } = useQuery({
    queryKey: ["unassigned-fulfillments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code)
        `)
        .is("trip_id", null)
        .in("status", ["waiting_for_cut", "waiting_for_courier", "dispatched"] as any)
        .eq("shipping_method", "own_fleet" as any)
        .order("created_at", { ascending: true })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  // Active/planned trips with load info
  const { data: activeTrips } = useQuery({
    queryKey: ["route-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model)
        `)
        .in("status", ["planned", "in_progress"] as any)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  // Fulfillments already assigned to trips
  const { data: assignedFulfillments } = useQuery({
    queryKey: ["assigned-fulfillments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          trip:trips(trip_number, status)
        `)
        .not("trip_id", "is", null)
        .in("status", ["dispatched", "in_transit", "pending_physical_confirmation"] as any)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  // Group unassigned by destination
  const byDestination: Record<string, any[]> = {};
  unassigned?.forEach((f: any) => {
    const dest = f.destination_branch?.code || f.destination_client_name || "Sin destino";
    if (!byDestination[dest]) byDestination[dest] = [];
    byDestination[dest].push(f);
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Ruteo Inteligente</h1>
        <p className="text-muted-foreground mt-1">Optimización de rutas, asignación de cargas y seguimiento de paradas</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl">
              <Package className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Sin asignar</p>
              <p className="text-2xl font-display font-bold text-secondary">{unassigned?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Viajes activos</p>
              <p className="text-2xl font-display font-bold text-primary">{activeTrips?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-accent/10 p-2.5 rounded-xl">
              <Route className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Destinos distintos</p>
              <p className="text-2xl font-display font-bold">{Object.keys(byDestination).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-info/10 p-2.5 rounded-xl">
              <CheckCircle2 className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En tránsito</p>
              <p className="text-2xl font-display font-bold">{assignedFulfillments?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unassigned by destination */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-secondary" /> Cargas pendientes de asignación a ruta
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(byDestination).length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Todas las cargas están asignadas</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(byDestination).map(([dest, items]) => (
                <div key={dest} className="p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{dest}</span>
                      <Badge variant="outline" className="text-xs">{items.length} carga{items.length > 1 ? "s" : ""}</Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {items.map((f: any) => {
                      const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
                      return (
                        <div key={f.id} className="flex items-center justify-between text-sm p-2 rounded bg-background/50">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{f.source_branch?.code}</span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span>{f.destination_branch?.code || "Cliente"}</span>
                            {f.package_count > 0 && (
                              <span className="text-xs text-muted-foreground">{f.package_count} bultos</span>
                            )}
                          </div>
                          <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
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

      {/* Active trips with assigned loads */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /> Viajes con cargas asignadas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeTrips?.length ? (
            <div className="p-6 text-center text-muted-foreground">Sin viajes activos</div>
          ) : (
            <div className="space-y-2">
              {activeTrips.map((t: any) => {
                const tripFulfillments = assignedFulfillments?.filter((f: any) => (f.trip as any)?.trip_number === t.trip_number) || [];
                const stops = (t.planned_stops as any[] || []);
                return (
                  <div key={t.id} className="p-3 rounded-lg bg-muted/20 border border-border/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${t.status === "in_progress" ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                        <span className="font-mono font-semibold text-sm">Viaje #{t.trip_number}</span>
                        <span className="text-xs text-muted-foreground">{t.origin_branch?.code}</span>
                        {(t.vehicle as any)?.plate_number && (
                          <span className="text-xs text-muted-foreground">{(t.vehicle as any).plate_number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {stops.length} parada{stops.length !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant={t.status === "in_progress" ? "default" : "outline"} className="text-xs">
                          {t.status === "in_progress" ? "En curso" : "Planificado"}
                        </Badge>
                      </div>
                    </div>
                    {tripFulfillments.length > 0 && (
                      <div className="space-y-1 pl-5">
                        {tripFulfillments.map((f: any) => (
                          <div key={f.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Package className="h-3 w-3" />
                            <span>{f.source_branch?.code} → {f.destination_branch?.code || "Cliente"}</span>
                            {f.package_count > 0 && <span>({f.package_count} bultos)</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
