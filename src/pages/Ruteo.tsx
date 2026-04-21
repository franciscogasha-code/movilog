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
        .in("status", ["in_preparation", "ready_for_pickup", "in_consolidation", "assigned_to_trip", "in_transit"] as any);
      if (error) return 0;
      return (data || []).length;
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
    <motion.div className="space-y-4 sm:space-y-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground">Planificación Logística</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Consolidación, viajes y monitoreo</p>
      </div>

      {/* KPIs compactos tipo chip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { key: "consolidacion", label: "Consol.", value: consolidationCount, icon: Package, color: "text-primary" },
          { key: "cliente", label: "Cliente", value: clientFleetCount, icon: User, color: "text-secondary" },
          { key: null, label: "Hoy", value: assignedTodayCount, icon: CheckCircle2, color: "text-accent" },
          { key: "programados", label: "Programados", value: plannedCount, icon: Calendar, color: "text-secondary" },
          { key: "en-curso", label: "En curso", value: inProgressCount, icon: Truck, color: "text-warning" },
        ].map((kpi) => (
          <button
            key={kpi.label}
            type="button"
            onClick={() => kpi.key && setActiveTab(kpi.key)}
            className={`op-card p-2.5 flex items-center gap-2 text-left transition-colors ${
              kpi.key && activeTab === kpi.key ? "ring-2 ring-primary/40" : ""
            } ${kpi.key ? "hover:bg-muted/40 active:bg-muted/60" : "cursor-default"}`}
          >
            <kpi.icon className={`h-4 w-4 shrink-0 ${kpi.color}`} />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{kpi.label}</p>
              <p className="text-base font-display font-bold leading-tight">{kpi.value ?? 0}</p>
            </div>
          </button>
        ))}
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
