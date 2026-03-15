import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Bell, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ALERT_LEVEL_LABELS } from "@/lib/constants";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-info/10 text-info",
  warning: "bg-secondary/10 text-secondary",
  critical: "bg-destructive/10 text-destructive",
};

export default function Alertas() {
  const [tab, setTab] = useState<string>("branch_operational");

  const { data: anomalies, isLoading, refetch } = useQuery({
    queryKey: ["anomalies", tab],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_anomalies")
        .select(`*, branch:branches(name, code)`)
        .eq("alert_level", tab as any)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const acknowledge = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("ai_anomalies")
        .update({
          is_acknowledged: true,
          acknowledged_by: user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("Alerta reconocida");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const unacknowledgedCount = anomalies?.filter(a => !a.is_acknowledged).length || 0;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Alertas</h1>
        <p className="text-muted-foreground mt-1">Bandejas separadas por nivel — solo lo relevante para cada actor</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="branch_operational" className="gap-2 text-xs">
            <Bell className="h-3.5 w-3.5" /> Operativa Sucursal
          </TabsTrigger>
          <TabsTrigger value="escalable" className="gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" /> Escalable
          </TabsTrigger>
          <TabsTrigger value="logistics_admin_decision" className="gap-2 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" /> Logística / Admin
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base flex items-center gap-2">
                {ALERT_LEVEL_LABELS[tab] || tab}
                {unacknowledgedCount > 0 && (
                  <Badge variant="destructive" className="text-xs">{unacknowledgedCount} pendientes</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando...</div>
              ) : !anomalies?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Sin alertas en esta bandeja</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {anomalies.map((a: any) => (
                    <div key={a.id} className={`p-4 transition-colors ${a.is_acknowledged ? "opacity-60" : "hover:bg-muted/20"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.info}`}>
                              {a.severity}
                            </span>
                            {a.branch && <span className="text-xs text-muted-foreground">{a.branch.code}</span>}
                            <span className="text-xs text-muted-foreground">
                              {new Date(a.created_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <h4 className="font-semibold text-sm text-foreground">{a.title}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                          {a.is_recurring && (
                            <Badge variant="outline" className="text-xs mt-1">Recurrente × {a.occurrence_count}</Badge>
                          )}
                        </div>
                        {!a.is_acknowledged && (
                          <Button variant="outline" size="sm" onClick={() => acknowledge(a.id)} className="h-7 text-xs shrink-0">
                            Reconocer
                          </Button>
                        )}
                      </div>
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
