import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  ClipboardList, Package, Truck, CheckCircle2, AlertTriangle,
  TrendingUp, ShieldCheck, Users, Activity, ArrowDown, ArrowUp,
  Minus, BarChart3, FileWarning, Clock, Loader2, Building2,
  Gauge, Eye, Brain, Timer, Route, Sparkles, ShieldAlert,
  Zap, ListChecks, Target, XCircle, MapPin, ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useBranches } from "@/hooks/use-branches";
import {
  useExecutiveKPIs, useOperationalFunnel, useCriticalAlerts,
  useBranchPerformance, useSystemAdoption, useIncidentBreakdown,
  useCycleTimes, useAIInsights, useActionableItems,
  type DateRange, type AIInsights, type CycleTimeData, CYCLE_SLA,
} from "@/hooks/use-executive-dashboard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

const INCIDENT_LABELS: Record<string, string> = {
  damaged: "Avería", missing: "Faltante", surplus: "Sobrante",
  wrong_product: "Producto incorrecto", delayed: "Demora", other: "Otro",
};
const DATE_LABELS: Record<string, string> = {
  today: "Hoy", yesterday: "Ayer", "7d": "Últimos 7 días",
  "30d": "Últimos 30 días", this_month: "Este mes",
};

function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function VariationBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const color = value > 0 ? "text-accent" : value < 0 ? "text-destructive" : "text-muted-foreground";
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${color}`}>
      <Icon className="h-3 w-3" />{Math.abs(value)}%
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   1.1 ESTADO GENERAL — Health Banner
   ══════════════════════════════════════════════════════════ */
function HealthBanner({ kpis, alerts, insights, onRequestInsights, loadingAI }: {
  kpis: any; alerts: any; insights?: AIInsights | null;
  onRequestInsights: () => void; loadingAI: boolean;
}) {
  // Calculate local score from available data
  const compliance = kpis?.compliance || 0;
  const traceability = kpis?.fullTraceability || 0;
  const totalAlerts = alerts
    ? alerts.staleRequests.length + alerts.noBims.length + alerts.openIncidents.length + alerts.failedDeliveries.length
    : 0;
  const alertPenalty = Math.min(totalAlerts * 3, 30);

  const score = insights?.healthScore ?? Math.max(0, Math.min(100,
    Math.round((compliance * 0.4 + traceability * 0.4 + (100 - alertPenalty) * 0.2))
  ));

  const level = score >= 85 ? "healthy" : score >= 60 ? "warning" : "critical";
  const config = {
    healthy: {
      bg: "bg-accent/10 border-accent/30",
      text: "text-accent",
      label: "Operación controlada",
      icon: ShieldCheck,
      dot: "🟢",
    },
    warning: {
      bg: "bg-secondary/10 border-secondary/30",
      text: "text-secondary",
      label: "Riesgos operativos detectados",
      icon: AlertTriangle,
      dot: "🟡",
    },
    critical: {
      bg: "bg-destructive/10 border-destructive/30",
      text: "text-destructive",
      label: "Operación comprometida",
      icon: XCircle,
      dot: "🔴",
    },
  }[level];

  return (
    <motion.div variants={item}>
      <Card className={`border-2 ${config.bg}`}>
        <CardContent className="p-5">
          <div className="flex items-center gap-5">
            {/* Score ring */}
            <div className="relative w-20 h-20 shrink-0">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
                <circle cx="40" cy="40" r="34" fill="none"
                  stroke={level === "healthy" ? "hsl(var(--accent))" : level === "warning" ? "hsl(var(--secondary))" : "hsl(var(--destructive))"}
                  strokeWidth="6"
                  strokeDasharray={`${(score / 100) * 214} 214`}
                  strokeLinecap="round" />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${config.text}`}>
                {score}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{config.dot}</span>
                <h2 className={`text-lg font-bold ${config.text}`}>{config.label}</h2>
              </div>
              {insights?.summary ? (
                <p className="text-sm text-muted-foreground">{insights.summary}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Cumplimiento {compliance}% · Trazabilidad {traceability}% · {totalAlerts} alertas activas
                </p>
              )}

              {/* Quick AI findings */}
              {insights?.findings?.length ? (
                <div className="mt-2 space-y-0.5">
                  {insights.findings.slice(0, 3).map((f, i) => (
                    <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                      <Eye className="h-3 w-3 mt-0.5 text-primary shrink-0" /> {f}
                    </p>
                  ))}
                </div>
              ) : null}

              {/* Quick AI recommendations */}
              {insights?.recommendations?.length ? (
                <div className="mt-2 space-y-0.5">
                  {insights.recommendations.slice(0, 3).map((r, i) => (
                    <p key={i} className="text-xs text-foreground flex items-start gap-1.5">
                      <Zap className="h-3 w-3 mt-0.5 text-accent shrink-0" /> {r}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onRequestInsights}
                disabled={loadingAI}
                className="text-xs"
              >
                {loadingAI ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Brain className="h-3.5 w-3.5 mr-1.5" />}
                {insights ? "Actualizar" : "Analizar"} con IA
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.2 QUÉ ESTÁ ROTO AHORA — Actionable items
   ══════════════════════════════════════════════════════════ */
function BrokenNowPanel({ data }: { data: ReturnType<typeof useActionableItems>["data"] }) {
  if (!data) return null;
  const { noBims, delayed, anomalies, worstBranches } = data;
  const hasIssues = noBims.length > 0 || delayed.length > 0 || anomalies.length > 0;

  if (!hasIssues && worstBranches.every(b => b.compliance >= 80)) {
    return (
      <div className="flex items-center justify-center py-6 gap-2">
        <ShieldCheck className="h-5 w-5 text-accent" />
        <span className="text-sm font-medium text-muted-foreground">Sin problemas críticos activos</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {/* Sin BIMS */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <FileWarning className="h-4 w-4 text-destructive" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Sin BIMS</span>
          <Badge variant="destructive" className="text-[9px] ml-auto">{noBims.length}</Badge>
        </div>
        {noBims.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">Todo en orden</p>
        ) : noBims.map(f => (
          <div key={f.id} className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border/50">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">OE {f.id.slice(0, 8)}</p>
              <p className="text-[10px] text-muted-foreground">{f.status}</p>
            </div>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>
        ))}
      </div>

      {/* Entregas demoradas */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="h-4 w-4 text-secondary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Demoradas</span>
          <Badge variant="secondary" className="text-[9px] ml-auto">{delayed.length}</Badge>
        </div>
        {delayed.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">Sin demoras críticas</p>
        ) : delayed.map(f => (
          <div key={f.id} className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border/50">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">OE {f.id.slice(0, 8)}</p>
              <p className="text-[10px] text-muted-foreground">Despachado: {f.dispatched_at ? new Date(f.dispatched_at).toLocaleDateString() : "—"}</p>
            </div>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>
        ))}
      </div>

      {/* Anomalías */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Anomalías</span>
          <Badge variant="destructive" className="text-[9px] ml-auto">{anomalies.length}</Badge>
        </div>
        {anomalies.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">Sin anomalías</p>
        ) : anomalies.map(a => (
          <div key={a.id} className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border/50">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{a.title}</p>
              <p className="text-[10px] text-muted-foreground">{a.anomaly_type}</p>
            </div>
            <Badge variant={a.severity === "critical" ? "destructive" : "secondary"} className="text-[8px]">
              {a.severity}
            </Badge>
          </div>
        ))}
      </div>

      {/* Peor cumplimiento */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="h-4 w-4 text-secondary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Peor Cumplimiento</span>
        </div>
        {worstBranches.map(b => {
          const color = b.compliance >= 80 ? "text-accent" : b.compliance >= 60 ? "text-secondary" : "text-destructive";
          return (
            <div key={b.id} className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border/50">
              <span className={`text-sm font-bold ${color}`}>{b.compliance}%</span>
              <span className="text-xs text-foreground flex-1 truncate">{b.name}</span>
              <span className="text-[10px] text-muted-foreground">{b.total} ops</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.3 KPI Card con semáforo + tooltip
   ══════════════════════════════════════════════════════════ */
function KPICard({ icon: Icon, label, value, tooltip, variation, color, semaphore }: {
  icon: any; label: string; value: string | number; tooltip: string;
  variation?: number | null; color: string; semaphore?: "green" | "yellow" | "red";
}) {
  const sColors = { green: "bg-accent", yellow: "bg-secondary", red: "bg-destructive" };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div variants={item}>
            <Card className="relative overflow-hidden cursor-help">
              <div className={`absolute top-0 left-0 w-1 h-full ${semaphore ? sColors[semaphore] : color}`} />
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-2xl font-bold text-foreground">{value}</p>
                      {variation !== undefined && <VariationBadge value={variation ?? null} />}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-muted/60">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ══════════════════════════════════════════════════════════
   1.4 Embudo con bottleneck highlight
   ══════════════════════════════════════════════════════════ */
function FunnelChart({ data }: { data: { stages: { stage: string; count: number; color: string }[]; bottleneckIdx: number; bottleneckDrop: number } }) {
  const { stages, bottleneckIdx } = data;
  const maxCount = Math.max(...stages.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {stages.map((d, i) => {
        const width = Math.max((d.count / maxCount) * 100, 8);
        const prevCount = i > 0 ? stages[i - 1].count : d.count;
        const convPct = prevCount > 0 && i > 0 ? Math.round((d.count / prevCount) * 100) : 100;
        const dropPct = 100 - convPct;
        const isBottleneck = i === bottleneckIdx;
        return (
          <div key={d.stage} className={`space-y-0.5 ${isBottleneck ? "ring-2 ring-destructive/40 rounded-lg p-1.5 -m-1.5" : ""}`}>
            <div className="flex items-center justify-between text-sm">
              <span className={`font-medium text-xs ${isBottleneck ? "text-destructive" : "text-foreground"}`}>
                {isBottleneck && "⚠ "}{d.stage}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground text-sm">{d.count}</span>
                {i > 0 && (
                  <Badge variant={isBottleneck ? "destructive" : "outline"} className="text-[9px] px-1 py-0">
                    {convPct}% conv · -{dropPct}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="h-5 bg-muted rounded-md overflow-hidden">
              <motion.div
                className="h-full rounded-md"
                style={{ backgroundColor: isBottleneck ? "hsl(0, 72%, 51%)" : d.color, width: `${width}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.5 Cycle Times con SLA
   ══════════════════════════════════════════════════════════ */
function CycleTimesPanel({ data }: { data: CycleTimeData }) {
  const stages = [
    { label: "Preparación", hours: data.preparation, sla: CYCLE_SLA.preparation, icon: Package },
    { label: "Tránsito", hours: data.transit, sla: CYCLE_SLA.transit, icon: Truck },
    { label: "Ciclo total", hours: data.totalCycle, sla: CYCLE_SLA.totalCycle, icon: Route },
  ];

  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const deviation = s.hours !== null ? ((s.hours - s.sla) / s.sla) * 100 : null;
        const level = deviation === null ? "neutral" : deviation <= 0 ? "green" : deviation <= 30 ? "yellow" : "red";
        const colors = {
          neutral: "border-border/40 bg-muted/30",
          green: "border-accent/40 bg-accent/5",
          yellow: "border-secondary/40 bg-secondary/5",
          red: "border-destructive/40 bg-destructive/5",
        };
        const textColors = {
          neutral: "text-muted-foreground",
          green: "text-accent",
          yellow: "text-secondary",
          red: "text-destructive",
        };

        return (
          <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${colors[level]}`}>
            <s.icon className={`h-4 w-4 shrink-0 ${textColors[level]}`} />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground">{s.label}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">SLA: {formatHours(s.sla)}</span>
                {deviation !== null && (
                  <Badge variant={level === "red" ? "destructive" : level === "yellow" ? "secondary" : "outline"}
                    className="text-[8px] px-1">
                    {deviation > 0 ? "+" : ""}{Math.round(deviation)}%
                  </Badge>
                )}
              </div>
            </div>
            <span className={`text-xl font-bold ${textColors[level]}`}>
              {formatHours(s.hours)}
            </span>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground text-center">
        Basado en {data.sampleSize} operaciones · SLA configurable
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.6 Branch Ranking con semáforo
   ══════════════════════════════════════════════════════════ */
function BranchRanking({ data }: { data: any[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-6">Sin datos en el período</p>;

  return (
    <div className="space-y-2.5">
      {data.slice(0, 10).map((b, i) => {
        const dot = b.compliance >= 85 ? "🟢" : b.compliance >= 60 ? "🟡" : "🔴";
        const color = b.compliance >= 85 ? "bg-accent" : b.compliance >= 60 ? "bg-secondary" : "bg-destructive";
        return (
          <div key={b.id} className="flex items-center gap-3">
            <span className="text-sm">{dot}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between mb-1">
                <span className="text-sm font-medium text-foreground truncate">{b.name}</span>
                <span className="text-sm font-bold text-foreground">{b.compliance}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${color}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${b.compliance}%` }}
                  transition={{ duration: 0.6, delay: i * 0.05 }}
                />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">{b.fulfillments} ops</span>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.7 Alerts (grouped by type)
   ══════════════════════════════════════════════════════════ */
function AlertPanel({ alerts }: { alerts: ReturnType<typeof useCriticalAlerts>["data"] }) {
  if (!alerts) return null;

  const groups = [
    { label: "Sin BIMS", items: alerts.noBims, icon: FileWarning, color: "text-destructive" },
    { label: "Demorados", items: alerts.staleRequests, icon: Clock, color: "text-secondary" },
    { label: "Entrega fallida", items: alerts.failedDeliveries, icon: XCircle, color: "text-destructive" },
    { label: "Incidencias", items: alerts.openIncidents, icon: AlertTriangle, color: "text-destructive" },
    { label: "Anomalías IA", items: alerts.anomalies, icon: Brain, color: "text-secondary" },
  ].filter(g => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <ShieldCheck className="h-8 w-8 text-accent mb-2" />
        <p className="font-semibold text-foreground text-sm">Sin alertas</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
      {groups.map(g => (
        <div key={g.label}>
          <div className="flex items-center gap-2 mb-1.5">
            <g.icon className={`h-3.5 w-3.5 ${g.color}`} />
            <span className="text-xs font-semibold text-foreground">{g.label}</span>
            <Badge variant="outline" className="text-[9px] ml-auto">{g.items.length}</Badge>
          </div>
          <div className="space-y-1 pl-5">
            {g.items.slice(0, 3).map((item: any, i: number) => (
              <p key={i} className="text-[10px] text-muted-foreground truncate">
                {item.request_number ? `#${item.request_number}` : item.title || item.id?.slice(0, 8)}
              </p>
            ))}
            {g.items.length > 3 && (
              <p className="text-[10px] text-primary">+{g.items.length - 3} más</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.8 Adoption
   ══════════════════════════════════════════════════════════ */
function AdoptionMetrics({ data }: { data: ReturnType<typeof useSystemAdoption>["data"] }) {
  if (!data) return null;

  const metrics = [
    { label: "Usuarios activos", value: data.activeUsers, sub: `de ${data.totalProfiles}`, icon: Users },
    { label: "Doc. correcta", value: `${data.docCompliance}%`, icon: FileWarning, pct: data.docCompliance },
    { label: "Entregas confirmadas", value: `${data.deliveryConfirmed}%`, icon: CheckCircle2, pct: data.deliveryConfirmed },
    { label: "Flujo completo", value: `${data.fullFlowOps}%`, icon: ListChecks, pct: data.fullFlowOps },
    { label: "Pasos omitidos", value: data.skippedSteps, icon: ShieldAlert },
    { label: "Fuera del sistema", value: data.outOfSystemEstimate, icon: XCircle },
    { label: "Eventos trazados", value: data.totalEvents, icon: Activity },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {metrics.map((m, i) => {
        const isWarning = "pct" in m && typeof m.pct === "number" && m.pct < 70;
        return (
          <div key={i} className={`p-3 rounded-lg border text-center space-y-1 ${isWarning ? "border-secondary/40 bg-secondary/5" : "border-border/50 bg-muted/50"}`}>
            <m.icon className={`h-4 w-4 mx-auto ${isWarning ? "text-secondary" : "text-muted-foreground"}`} />
            <p className="text-lg font-bold text-foreground">{m.value}</p>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-tight">{m.label}</p>
            {"sub" in m && m.sub && <p className="text-[9px] text-muted-foreground">{m.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   1.9 Incidents Pie
   ══════════════════════════════════════════════════════════ */
function IncidentsPie({ data }: { data: { type: string; count: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-6">Sin incidencias</p>;
  const COLORS = ["hsl(0, 72%, 51%)", "hsl(38, 92%, 50%)", "hsl(220, 70%, 45%)", "hsl(160, 60%, 40%)", "hsl(260, 60%, 55%)"];
  const chartData = data.map(d => ({ name: INCIDENT_LABELS[d.type] || d.type, value: d.count }));
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={160}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" stroke="none">
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <RTooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-2">
        {chartData.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-xs text-foreground truncate">{d.name}</span>
            <span className="text-xs font-bold text-foreground ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN DASHBOARD V3 — Torre de Control
   ══════════════════════════════════════════════════════════════ */
export default function DashboardEjecutivo() {
  const { isOwner, hasRole, loading: authLoading } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [branchId, setBranchId] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const { data: branches } = useBranches();
  const selectedBranch = branchId && branchId !== "all" ? branchId : undefined;

  const { data: kpis, isLoading: loadingKPIs } = useExecutiveKPIs(dateRange, selectedBranch);
  const { data: funnel } = useOperationalFunnel(dateRange, selectedBranch);
  const { data: alerts } = useCriticalAlerts(selectedBranch);
  const { data: actionable } = useActionableItems(selectedBranch);
  const { data: branchPerf } = useBranchPerformance(dateRange, selectedBranch);
  const { data: adoption } = useSystemAdoption(dateRange);
  const { data: incidents } = useIncidentBreakdown(dateRange, selectedBranch);
  const { data: cycleTimes } = useCycleTimes(dateRange, selectedBranch);
  const { data: aiInsights, isLoading: loadingAI, refetch: refetchAI } = useAIInsights(
    kpis, alerts, adoption, branchPerf, aiEnabled
  );

  const totalAlerts = alerts
    ? alerts.staleRequests.length + alerts.noBims.length + alerts.openIncidents.length + alerts.failedDeliveries.length + alerts.anomalies.length
    : 0;

  const handleAIRefresh = () => {
    setAiEnabled(true);
    setTimeout(() => refetchAI(), 100);
  };

  if (authLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  const canAccessExecutive = isOwner || hasRole("admin") || hasRole("supervisor");
  if (!canAccessExecutive) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header + Filters compactos */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Gauge className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Torre de Control
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Vista ejecutiva en tiempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-36 sm:w-44 h-9">
              <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DATE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchId || "all"} onValueChange={setBranchId}>
            <SelectTrigger className="w-40 sm:w-48 h-9">
              <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Todas las sucursales" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las sucursales</SelectItem>
              {branches?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingKPIs ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-5">

          {/* 1.1 Health Banner */}
          <HealthBanner
            kpis={kpis} alerts={alerts}
            insights={aiInsights} onRequestInsights={handleAIRefresh} loadingAI={loadingAI}
          />

          {/* 1.2 Qué está roto ahora */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="h-4 w-4 text-destructive" />
                  ¿Dónde intervenir ahora?
                </CardTitle>
                <CardDescription>Top problemas que requieren acción inmediata</CardDescription>
              </CardHeader>
              <CardContent>
                <BrokenNowPanel data={actionable} />
              </CardContent>
            </Card>
          </motion.div>

          {/* 1.3 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPICard icon={TrendingUp} label="Cumplimiento" value={`${kpis?.compliance || 0}%`}
              tooltip="(Entregados + Recibidos + Completados) ÷ Total fulfillments activos"
              semaphore={kpis?.compliance >= 85 ? "green" : kpis?.compliance >= 60 ? "yellow" : "red"}
              color="bg-accent" />
            <KPICard icon={Route} label="Trazabilidad" value={`${kpis?.fullTraceability || 0}%`}
              tooltip="Fulfillments con documento BIMS + despacho registrado ÷ Total que deberían tenerlo"
              semaphore={kpis?.fullTraceability >= 90 ? "green" : kpis?.fullTraceability >= 70 ? "yellow" : "red"}
              color="bg-primary" />
            <KPICard icon={AlertTriangle} label="Ops con alerta" value={kpis?.opsWithAlerts || 0}
              tooltip="Fulfillments con al menos una anomalía no resuelta (deduplicado)"
              semaphore={kpis?.opsWithAlerts === 0 ? "green" : kpis?.opsWithAlerts <= 3 ? "yellow" : "red"}
              color="bg-destructive" />
            <KPICard icon={ClipboardList} label="Solicitudes" value={kpis?.reqCreated || 0}
              tooltip="Solicitudes creadas en el período seleccionado"
              variation={kpis?.reqVariation} color="bg-primary" />
          </div>

          {/* Quick counts row */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: Package, label: "Preparación", value: kpis?.inPrep || 0, color: "bg-secondary" },
              { icon: Truck, label: "Tránsito", value: kpis?.inTransit || 0, color: "bg-primary" },
              { icon: CheckCircle2, label: "Entregadas", value: kpis?.delivered || 0, color: "bg-accent" },
              { icon: AlertTriangle, label: "Incidencias abiertas", value: kpis?.openIncidents || 0, color: "bg-destructive" },
            ].map((c, i) => (
              <motion.div key={i} variants={item}>
                <Card className="relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-1 h-full ${c.color}`} />
                  <CardContent className="p-3 flex items-center gap-3">
                    <c.icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-lg font-bold text-foreground">{c.value}</p>
                      <p className="text-[10px] text-muted-foreground uppercase">{c.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* 1.4 Funnel + 1.5 Cycle Times */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  Embudo Operativo
                </CardTitle>
                <CardDescription>
                  Conversión entre etapas
                  {funnel && funnel.bottleneckDrop > 0 && (
                    <span className="text-destructive ml-2">
                      ⚠ Cuello de botella: -{funnel.bottleneckDrop}% en {funnel.stages[funnel.bottleneckIdx]?.stage}
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {funnel ? <FunnelChart data={funnel} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Timer className="h-4 w-4 text-secondary" />
                  Tiempos vs SLA
                </CardTitle>
                <CardDescription>Desempeño contra objetivos</CardDescription>
              </CardHeader>
              <CardContent>
                {cycleTimes ? <CycleTimesPanel data={cycleTimes} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
          </div>

          {/* 1.6 Branch Ranking + 1.7 Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Ranking de Sucursales
                </CardTitle>
                <CardDescription>Ordenado por cumplimiento operativo</CardDescription>
              </CardHeader>
              <CardContent>
                {branchPerf ? <BranchRanking data={branchPerf} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Alertas por Categoría
                  </CardTitle>
                  {totalAlerts > 0 && <Badge variant="destructive" className="text-xs">{totalAlerts}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <AlertPanel alerts={alerts} />
              </CardContent>
            </Card>
          </div>

          {/* 1.8 Adoption */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Adopción del Sistema
                </CardTitle>
                <CardDescription>Uso del flujo, trazabilidad y operaciones fuera del sistema</CardDescription>
              </CardHeader>
              <CardContent>
                {adoption ? <AdoptionMetrics data={adoption} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
          </motion.div>

          {/* Incidents */}
          <motion.div variants={item}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Incidencias por Tipo
                </CardTitle>
                <CardDescription>
                  {incidents ? `${incidents.total} total — ${incidents.open} abiertas` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {incidents ? <IncidentsPie data={incidents.byType} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
          </motion.div>

        </motion.div>
      )}
    </div>
  );
}
