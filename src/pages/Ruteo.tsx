import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Calendar, Truck, Clock, CheckCircle2, User } from "lucide-react";
import { LogisticaConsolidacion } from "@/components/logistica/LogisticaConsolidacion";
import { LogisticaViajesProgramados } from "@/components/logistica/LogisticaViajesProgramados";
import { LogisticaViajesEnCurso } from "@/components/logistica/LogisticaViajesEnCurso";
import { PedidosClienteFlotaPropia } from "@/components/logistica/PedidosClienteFlotaPropia";

export default function Ruteo() {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState("consolidacion");

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (
      requestedTab === "consolidacion" ||
      requestedTab === "cliente" ||
      requestedTab === "programados" ||
      requestedTab === "en-curso"
    ) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  // Summary counts
  const { data: consolidationCount } = useQuery({
    queryKey: ["consolidation-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("branch_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "in_consolidation" as any)
        .eq("flow_type", "interurban");
      if (error) return 0;
      return count || 0;
    },
  });

  const { data: clientFleetCount } = useQuery({
    queryKey: ["client-own-fleet-count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`id, fulfillment_orders!fulfillment_orders_branch_request_id_fkey(trip_id, status)`)
        .eq("request_type", "client" as any)
        .eq("shipping_method", "own_fleet" as any)
        .eq("delivery_target", "client" as any)
        .in("status", ["in_preparation", "ready_for_dispatch", "in_consolidation"] as any);
      if (error) return 0;
      return (data || []).filter((r: any) => {
        const fo = r.fulfillment_orders?.[0];
        if (!fo) return true;
        if (fo.trip_id) return false;
        if (fo.status === "on_vehicle" || fo.status === "delivered" || fo.status === "at_hub") return false;
        return true;
      }).length;
    },
  });

  const { data: plannedCount } = useQuery({
    queryKey: ["planned-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("status", "planned" as any);
      if (error) return 0;
      return count || 0;
    },
  });

  const { data: inProgressCount } = useQuery({
    queryKey: ["in-progress-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("trips")
        .select("id", { count: "exact", head: true })
        .eq("status", "in_progress" as any);
      if (error) return 0;
      return count || 0;
    },
  });

  const { data: assignedTodayCount } = useQuery({
    queryKey: ["assigned-today-count"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from("branch_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "assigned_to_trip" as any)
        .gte("updated_at", today.toISOString());
      if (error) return 0;
      return count || 0;
    },
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Planificación Logística</h1>
        <p className="text-muted-foreground mt-1">Consolidación de cargas, gestión de viajes y monitoreo</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card
          className={`glass-card cursor-pointer transition-all ${activeTab === "consolidacion" ? "ring-2 ring-primary/40" : ""}`}
          onClick={() => setActiveTab("consolidacion")}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl">
              <Package className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Consolidación</p>
              <p className="text-lg font-display font-bold">{consolidationCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`glass-card cursor-pointer transition-all ${activeTab === "cliente" ? "ring-2 ring-secondary/40" : ""}`}
          onClick={() => setActiveTab("cliente")}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl">
              <User className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pedidos cliente</p>
              <p className="text-lg font-display font-bold">{clientFleetCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-accent/10 p-2.5 rounded-xl">
              <CheckCircle2 className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Asignados hoy</p>
              <p className="text-lg font-display font-bold">{assignedTodayCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`glass-card cursor-pointer transition-all ${activeTab === "programados" ? "ring-2 ring-primary/40" : ""}`}
          onClick={() => setActiveTab("programados")}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl">
              <Calendar className="h-4 w-4 text-secondary" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Viajes programados</p>
              <p className="text-lg font-display font-bold">{plannedCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`glass-card cursor-pointer transition-all ${activeTab === "en-curso" ? "ring-2 ring-primary/40" : ""}`}
          onClick={() => setActiveTab("en-curso")}
        >
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-warning/10 p-2.5 rounded-xl">
              <Truck className="h-4 w-4 text-warning" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Viajes en curso</p>
              <p className="text-lg font-display font-bold">{inProgressCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="consolidacion" className="gap-1.5 text-xs sm:text-sm">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Consolidación</span>
            <span className="sm:hidden">Consol.</span>
            {(consolidationCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{consolidationCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="cliente" className="gap-1.5 text-xs sm:text-sm">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">Pedidos cliente</span>
            <span className="sm:hidden">Cliente</span>
            {(clientFleetCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{clientFleetCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="programados" className="gap-1.5 text-xs sm:text-sm">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Programados</span>
            <span className="sm:hidden">Prog.</span>
            {(plannedCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{plannedCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="en-curso" className="gap-1.5 text-xs sm:text-sm">
            <Clock className="h-4 w-4" />
            <span className="hidden sm:inline">En curso</span>
            <span className="sm:hidden">Curso</span>
            {(inProgressCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{inProgressCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consolidacion" className="mt-4">
          <LogisticaConsolidacion />
        </TabsContent>

        <TabsContent value="cliente" className="mt-4">
          <PedidosClienteFlotaPropia />
        </TabsContent>

        <TabsContent value="programados" className="mt-4">
          <LogisticaViajesProgramados />
        </TabsContent>

        <TabsContent value="en-curso" className="mt-4">
          <LogisticaViajesEnCurso />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
