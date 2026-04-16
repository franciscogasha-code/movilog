import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Package, Clock, Warehouse, History } from "lucide-react";
import { CorteUrbano } from "@/components/chofer/CorteUrbano";
import { ViajeInterurbano } from "@/components/chofer/ViajeInterurbano";
import { CargasDisponibles } from "@/components/chofer/CargasDisponibles";
import { MisCargasEnCurso } from "@/components/chofer/MisCargasEnCurso";
import { CargasEnAcopio } from "@/components/chofer/CargasEnAcopio";
import { FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";

export default function Chofer() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("mis-cargas");

  // Get driver info
  const { data: myDriver } = useQuery({
    queryKey: ["my-driver-record"],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("drivers")
        .select("id, assigned_branch_id")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

  // Count loads under my custody
  const { data: custodyCount } = useQuery({
    queryKey: ["custody-count", user?.id],
    queryFn: async () => {
      if (!user?.id) return 0;
      const { count, error } = await supabase
        .from("fulfillment_orders")
        .select("id", { count: "exact", head: true })
        .eq("current_custody_holder_id", user.id)
        .in("status", ["in_transit", "dispatched", "delivery_failed"] as any[]);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!user?.id,
  });

  // Count hub loads at my branch
  const { data: hubCount } = useQuery({
    queryKey: ["hub-count", myDriver?.assigned_branch_id],
    queryFn: async () => {
      if (!myDriver?.assigned_branch_id) return 0;
      const { count, error } = await supabase
        .from("fulfillment_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "at_hub" as any)
        .eq("current_location_branch_id", myDriver.assigned_branch_id);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!myDriver?.assigned_branch_id,
  });

  // Active trips — filtered by driver
  const { data: activeTrips } = useQuery({
    queryKey: ["active-trips", myDriver?.id],
    queryFn: async () => {
      if (!myDriver?.id) return [];
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model)
        `)
        .eq("driver_id", myDriver.id)
        .in("status", ["planned", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!myDriver?.id,
  });

  // Recent delivery history
  const { data: recentDeliveries } = useQuery({
    queryKey: ["recent-deliveries", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("triggered_by", user.id)
        .in("event_type", [
          "driver_pickup", "driver_delivery_to_branch", "driver_delivery_to_customer",
          "driver_drop_at_hub", "driver_pickup_from_hub", "driver_delivery_failed",
          "driver_transfer_custody",
        ])
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const urbanCutoffs = activeTrips?.filter(t => t.trip_type === "urban_cutoff") || [];
  const interurbanTrips = activeTrips?.filter(t => t.trip_type === "interurban_planned") || [];
  const activeCutoff = urbanCutoffs.find(t => t.status === "in_progress");
  const activeTrip = interurbanTrips.find(t => t.status === "in_progress");

  const EVENT_TYPE_LABELS: Record<string, string> = {
    driver_pickup: "Retiro",
    driver_delivery_to_branch: "Entrega en sucursal",
    driver_delivery_to_customer: "Entrega a cliente",
    driver_drop_at_hub: "Dejado en acopio",
    driver_pickup_from_hub: "Tomado de acopio",
    driver_delivery_failed: "Entrega fallida",
    driver_transfer_custody: "Transferencia",
  };

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Panel del Chofer</h1>
        <p className="text-muted-foreground mt-1">Gestión de cargas, entregas y operación logística</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Bajo mi custodia</p>
              <p className="text-lg font-display font-bold">{custodyCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-xl">
              <Clock className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Corte / Viaje activo</p>
              <p className="text-lg font-display font-bold">
                {activeCutoff
                  ? `Corte #${activeCutoff.trip_number}`
                  : activeTrip
                  ? `Viaje #${activeTrip.trip_number}`
                  : "Ninguno"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-info/10 p-3 rounded-xl">
              <Warehouse className="h-5 w-5 text-info" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En acopio (mi sucursal)</p>
              <p className="text-lg font-display font-bold">{hubCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="mis-cargas" className="gap-1.5 text-xs sm:text-sm">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Mis cargas</span>
            <span className="sm:hidden">Cargas</span>
            {(custodyCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{custodyCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="retiro" className="gap-1.5 text-xs sm:text-sm">
            <Truck className="h-4 w-4" />
            <span className="hidden sm:inline">Retiro</span>
            <span className="sm:hidden">Retiro</span>
          </TabsTrigger>
          <TabsTrigger value="cortes-viajes" className="gap-1.5 text-xs sm:text-sm">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">Cortes/Viajes</span>
            <span className="sm:hidden">Cortes</span>
          </TabsTrigger>
          <TabsTrigger value="historial" className="gap-1.5 text-xs sm:text-sm">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Historial</span>
            <span className="sm:hidden">Hist.</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mis-cargas" className="mt-4 space-y-6">
          <MisCargasEnCurso />
          <CargasEnAcopio />
        </TabsContent>

        <TabsContent value="retiro" className="mt-4">
          <CargasDisponibles />
        </TabsContent>

        <TabsContent value="cortes-viajes" className="mt-4 space-y-6">
          <CorteUrbano cutoffs={urbanCutoffs} activeCutoff={activeCutoff} />
          <ViajeInterurbano trips={interurbanTrips} activeTrip={activeTrip} />
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {!recentDeliveries?.length ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  <History className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  Sin actividad reciente
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {recentDeliveries.map((e: any) => (
                    <div key={e.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">
                          {EVENT_TYPE_LABELS[e.event_type] || e.event_type}
                        </span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {e.event_description?.substring(0, 60)}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}{" "}
                        {new Date(e.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
