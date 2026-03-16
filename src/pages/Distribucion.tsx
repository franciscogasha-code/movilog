import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MapPin, Truck, Package, ClipboardList, Calendar, CheckCircle2, Clock,
} from "lucide-react";
import { SHIPPING_METHOD_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";

export default function Distribucion() {
  const [tab, setTab] = useState("en-curso");

  // Fulfillments that are wholesale (delivery_target = client on the branch_request)
  const { data: fulfillments, isLoading } = useQuery({
    queryKey: ["wholesale-fulfillments", tab],
    queryFn: async () => {
      let query = supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          trip:trips(trip_number, status),
          branch_request:branch_requests(request_number, request_type, delivery_target, client_name, client_address)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tab === "en-curso") {
        query = query.in("status", ["pending", "picking", "waiting_for_cut", "waiting_for_courier", "dispatched", "in_transit", "pending_physical_confirmation"] as any);
      } else if (tab === "entregadas") {
        query = query.in("status", ["delivered", "received", "completed"] as any);
      }

      const { data, error } = await query;
      if (error) throw error;
      // Filter to only show client deliveries
      return data?.filter((f: any) => f.branch_request?.delivery_target === "client" || f.destination_client_name) || [];
    },
  });

  // Upcoming planned trips with client stops
  const { data: plannedTrips } = useQuery({
    queryKey: ["wholesale-planned-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model)
        `)
        .eq("trip_type", "interurban_planned" as any)
        .in("status", ["planned", "in_progress"] as any)
        .order("planned_departure", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const inTransitCount = fulfillments?.filter((f: any) => ["dispatched", "in_transit"].includes(f.status)).length || 0;
  const pendingCount = fulfillments?.filter((f: any) => ["pending", "picking", "waiting_for_cut"].includes(f.status)).length || 0;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Distribución Mayorista</h1>
        <p className="text-muted-foreground mt-1">Pre-venta, planificación de rutas y entregas a clientes mayoristas</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl">
              <ClipboardList className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En preparación</p>
              <p className="text-2xl font-display font-bold">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En tránsito</p>
              <p className="text-2xl font-display font-bold">{inTransitCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-accent/10 p-2.5 rounded-xl">
              <CheckCircle2 className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Entregadas</p>
              <p className="text-2xl font-display font-bold">
                {fulfillments?.filter((f: any) => ["delivered", "received"].includes(f.status)).length || 0}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-info/10 p-2.5 rounded-xl">
              <Calendar className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Viajes planificados</p>
              <p className="text-2xl font-display font-bold">{plannedTrips?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Planned trips */}
      {plannedTrips && plannedTrips.length > 0 && (
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Viajes con entregas mayoristas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {plannedTrips.map((t: any) => {
              const stops = (t.planned_stops as any[] || []).filter((s: any) => s.type === "delivery_client");
              return (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${t.status === "in_progress" ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                    <div>
                      <span className="font-mono font-semibold">Viaje #{t.trip_number}</span>
                      <span className="text-muted-foreground ml-2">{t.origin_branch?.code}</span>
                      {t.vehicle && <span className="text-muted-foreground ml-2">{(t.vehicle as any).plate_number}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" /> {stops.length} paradas
                    </Badge>
                    <Badge variant={t.status === "in_progress" ? "default" : "outline"} className="text-xs">
                      {t.status === "in_progress" ? "En curso" : "Planificado"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Fulfillments tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="en-curso" className="gap-2 text-xs">
            <Package className="h-3.5 w-3.5" /> En curso
          </TabsTrigger>
          <TabsTrigger value="entregadas" className="gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" /> Entregadas
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando...</div>
              ) : !fulfillments?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Sin entregas mayoristas en esta bandeja</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {fulfillments.map((f: any) => {
                    const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
                    const clientName = f.destination_client_name || (f.branch_request as any)?.client_name || "—";
                    const clientAddr = f.destination_client_address || (f.branch_request as any)?.client_address || "";
                    return (
                      <div key={f.id} className="p-4 hover:bg-muted/20 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{clientName}</span>
                              {(f.branch_request as any)?.request_number && (
                                <span className="text-xs text-muted-foreground font-mono">
                                  Ped. #{(f.branch_request as any).request_number}
                                </span>
                              )}
                            </div>
                            {clientAddr && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> {clientAddr}
                              </p>
                            )}
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span>{f.source_branch?.code} → {f.destination_branch?.code || "Cliente"}</span>
                              <span>{SHIPPING_METHOD_LABELS[f.shipping_method] || f.shipping_method}</span>
                              {f.package_count > 0 && <span>{f.package_count} bultos</span>}
                              {(f.trip as any)?.trip_number && (
                                <span className="font-mono">Viaje #{(f.trip as any).trip_number}</span>
                              )}
                            </div>
                          </div>
                          <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
