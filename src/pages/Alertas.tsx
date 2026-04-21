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

const SEVERITY_STYLES: Record<string, { chip: string; border: string; dot: string; label: string }> = {
  critical: {
    chip: "bg-destructive/15 text-destructive border-destructive/30",
    border: "border-l-destructive bg-destructive/5",
    dot: "bg-destructive",
    label: "Crítico",
  },
  warning: {
    chip: "bg-warning/15 text-warning border-warning/30",
    border: "border-l-warning bg-warning/5",
    dot: "bg-warning",
    label: "Advertencia",
  },
  info: {
    chip: "bg-info/15 text-info border-info/30",
    border: "border-l-info bg-info/5",
    dot: "bg-info",
    label: "Informativa",
  },
};

const RESOLUTION_LABELS: Record<string, string> = {
  resolved_manual: "Resuelta manualmente",
  resolved_auto: "Resuelta automáticamente",
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

  const acknowledge = async (id: string, resolution?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const updatePayload: any = {
        is_acknowledged: true,
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString(),
      };
      // Store resolution type in supporting_data
      if (resolution) {
        const existing = anomalies?.find(a => a.id === id);
        const currentData = (existing?.supporting_data as any) || {};
        updatePayload.supporting_data = { ...currentData, resolution_type: resolution };
      }
      const { error } = await supabase
        .from("ai_anomalies")
        .update(updatePayload)
        .eq("id", id);
      if (error) throw error;
      toast.success(resolution === "resolved_auto" ? "Marcada como resuelta automáticamente" : "Alerta reconocida");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const unacknowledgedCount = anomalies?.filter(a => !a.is_acknowledged).length || 0;

  return (
    <motion.div className="space-y-4 sm:space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="page-title">Alertas</h1>
        <p className="page-subtitle mt-1">Bandejas separadas por nivel — solo lo relevante para cada actor</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 h-auto p-1">
          <TabsTrigger value="branch_operational" className="gap-1.5 text-[11px] sm:text-xs px-1 sm:px-3 py-2">
            <Bell className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xs:inline">Operativa</span>
            <span className="xs:hidden">Op.</span>
            <span className="hidden sm:inline">Sucursal</span>
          </TabsTrigger>
          <TabsTrigger value="escalable" className="gap-1.5 text-[11px] sm:text-xs px-1 sm:px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Escalable
          </TabsTrigger>
          <TabsTrigger value="logistics_admin_decision" className="gap-1.5 text-[11px] sm:text-xs px-1 sm:px-3 py-2">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden xs:inline">Logística</span>
            <span className="xs:hidden">Log.</span>
            <span className="hidden sm:inline">/ Admin</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base flex items-center gap-2 flex-wrap">
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
                <div className="p-6">
                  <div className="empty-state">
                    <CheckCircle2 className="h-8 w-8 mb-2 text-success" />
                    <p className="font-medium">Sin alertas en esta bandeja</p>
                    <p className="text-xs text-muted-foreground mt-1">Todo en orden por aquí.</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {anomalies.map((a: any) => {
                    const resolutionType = (a.supporting_data as any)?.resolution_type;
                    const isAutoResolved = resolutionType === "resolved_auto";
                    const sev = SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.info;

                    return (
                      <div
                        key={a.id}
                        className={`p-3 sm:p-4 border-l-4 transition-colors ${sev.border} ${a.is_acknowledged ? "opacity-60" : "hover:bg-muted/20"}`}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sev.chip}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${sev.dot}`} />
                                {sev.label}
                              </span>
                              {a.branch && (
                                <span className="text-[11px] text-muted-foreground">
                                  {(a.branch as any).name || (a.branch as any).code}
                                </span>
                              )}
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(a.created_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {a.is_acknowledged && isAutoResolved && (
                                <Badge variant="outline" className="text-[10px] text-accent border-accent/30 gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Resuelta auto
                                </Badge>
                              )}
                              {a.is_acknowledged && !isAutoResolved && (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Reconocida
                                </Badge>
                              )}
                            </div>
                            <h4 className="font-semibold text-sm text-foreground leading-snug">{a.title}</h4>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{a.description}</p>
                            {a.is_recurring && (
                              <Badge variant="outline" className="text-[10px] mt-2">Recurrente × {a.occurrence_count}</Badge>
                            )}
                          </div>
                          {!a.is_acknowledged && (
                            <div className="flex sm:flex-col gap-1 shrink-0 w-full sm:w-auto">
                              <Button variant="outline" size="sm" onClick={() => acknowledge(a.id, "resolved_manual")} className="h-8 text-xs flex-1 sm:flex-none">
                                Reconocer
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => acknowledge(a.id, "resolved_auto")} className="h-8 text-xs text-muted-foreground flex-1 sm:flex-none">
                                Resuelta auto
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {/* Cierre visual */}
                  <div className="flex items-center justify-center gap-2 py-3">
                    <p className="text-[11px] text-muted-foreground/70">
                      Fin de alertas · {anomalies.length} {anomalies.length === 1 ? "registrada" : "registradas"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
