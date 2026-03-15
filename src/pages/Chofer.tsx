import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Play, Square, Truck, MapPin, Package, Clock, AlertTriangle } from "lucide-react";
import { CorteUrbano } from "@/components/chofer/CorteUrbano";
import { ViajeInterurbano } from "@/components/chofer/ViajeInterurbano";
import { CargasDisponibles } from "@/components/chofer/CargasDisponibles";
import { toast } from "sonner";

const TRIP_STATUS_LABELS: Record<string, string> = {
  planned: "Planificado",
  in_progress: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
};

export default function Chofer() {
  const [activeTab, setActiveTab] = useState("cortes");

  const { data: activeTrips } = useQuery({
    queryKey: ["active-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number, brand, model)
        `)
        .in("status", ["planned", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const urbanCutoffs = activeTrips?.filter(t => t.trip_type === "urban_cutoff") || [];
  const interurbanTrips = activeTrips?.filter(t => t.trip_type === "interurban_planned") || [];
  const activeCutoff = urbanCutoffs.find(t => t.status === "in_progress");
  const activeTrip = interurbanTrips.find(t => t.status === "in_progress");

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Panel del Chofer</h1>
        <p className="text-muted-foreground mt-1">Gestión de cortes urbanos, viajes interurbanos y cargas asignadas</p>
      </div>

      {/* Active status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Corte activo</p>
              <p className="text-lg font-display font-bold">
                {activeCutoff ? `#${activeCutoff.trip_number}` : "Ninguno"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-xl">
              <Truck className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Viaje activo</p>
              <p className="text-lg font-display font-bold">
                {activeTrip ? `#${activeTrip.trip_number}` : "Ninguno"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-secondary/10 p-3 rounded-xl">
              <Package className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Cargas pendientes</p>
              <p className="text-lg font-display font-bold">—</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="cortes" className="gap-2">
            <Clock className="h-4 w-4" /> Cortes Urbanos
          </TabsTrigger>
          <TabsTrigger value="viajes" className="gap-2">
            <Truck className="h-4 w-4" /> Viajes Interurbanos
          </TabsTrigger>
          <TabsTrigger value="cargas" className="gap-2">
            <Package className="h-4 w-4" /> Cargas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cortes" className="mt-4">
          <CorteUrbano cutoffs={urbanCutoffs} activeCutoff={activeCutoff} />
        </TabsContent>

        <TabsContent value="viajes" className="mt-4">
          <ViajeInterurbano trips={interurbanTrips} activeTrip={activeTrip} />
        </TabsContent>

        <TabsContent value="cargas" className="mt-4">
          <CargasDisponibles />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
