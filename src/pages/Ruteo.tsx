import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Calendar, Truck, Clock } from "lucide-react";
import { LogisticaConsolidacion } from "@/components/logistica/LogisticaConsolidacion";
import { LogisticaViajesProgramados } from "@/components/logistica/LogisticaViajesProgramados";
import { LogisticaViajesEnCurso } from "@/components/logistica/LogisticaViajesEnCurso";

export default function Ruteo() {
  const [activeTab, setActiveTab] = useState("consolidacion");

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

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Planificación Logística</h1>
        <p className="text-muted-foreground mt-1">Consolidación de cargas, gestión de viajes y monitoreo</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En consolidación</p>
              <p className="text-lg font-display font-bold">{consolidationCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-secondary/10 p-3 rounded-xl">
              <Calendar className="h-5 w-5 text-secondary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Viajes programados</p>
              <p className="text-lg font-display font-bold">{plannedCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-xl">
              <Truck className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Viajes en curso</p>
              <p className="text-lg font-display font-bold">{inProgressCount ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="consolidacion" className="gap-1.5 text-xs sm:text-sm">
            <Package className="h-4 w-4" />
            <span className="hidden sm:inline">Consolidación</span>
            <span className="sm:hidden">Consol.</span>
            {(consolidationCount ?? 0) > 0 && (
              <Badge variant="default" className="text-[10px] h-4 px-1">{consolidationCount}</Badge>
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
