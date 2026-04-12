import { useState } from "react";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import {
  ClipboardList, Package, Truck, CheckCircle2, AlertTriangle,
  TrendingUp, ShieldCheck, Users, Activity, ArrowDown, ArrowUp,
  Minus, BarChart3, FileWarning, Clock, Loader2, Building2,
  Gauge, Eye, Brain, Timer, Route, Sparkles, ShieldAlert,
  Zap, ListChecks,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useBranches } from "@/hooks/use-branches";
import {
  useExecutiveKPIs, useOperationalFunnel, useCriticalAlerts,
  useBranchPerformance, useSystemAdoption, useIncidentBreakdown,
  useCycleTimes, useAIInsights,
  type DateRange, type AIInsights,
} from "@/hooks/use-executive-dashboard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  damaged: "Avería", missing: "Faltante", surplus: "Sobrante",
  wrong_product: "Producto incorrecto", delayed: "Demora", other: "Otro",
};

const DATE_RANGE_LABELS: Record<string, string> = {
  today: "Hoy", yesterday: "Ayer", "7d": "Últimos 7 días",
  "30d": "Últimos 30 días", this_month: "Este mes",
};

/* ── KPI Card ── */
function KPICard({ icon: Icon, label, value, subtitle, color }: {
  icon: any; label: string; value: string | number; subtitle?: string; color: string;
}) {
  return (
    <motion.div variants={item}>
      <Card className="relative overflow-hidden">
        <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-0.5">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-2xl font-bold text-foreground">{value}</p>
              {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
            </div>
            <div className={`p-2 rounded-lg bg-muted/60`}>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ── Funnel ── */
function FunnelChart({ data }: { data: { stage: string; count: number; color: string }[] }) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const width = Math.max((d.count / maxCount) * 100, 8);
        const prevCount = i > 0 ? data[i - 1].count : d.count;
        const dropPct = prevCount > 0 && i > 0 ? Math.round(((prevCount - d.count) / prevCount) * 100) : 0;
        return (
          <div key={d.stage} className="space-y-0.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground text-xs">{d.stage}</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground text-sm">{d.count}</span>
                {dropPct > 0 && (
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-destructive border-destructive/30">
                    -{dropPct}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="h-6 bg-muted rounded-md overflow-hidden">
              <motion.div
                className="h-full rounded-md"
                style={{ backgroundColor: d.color, width: `${width}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Alerts ── */
function AlertPanel({ alerts }: { alerts: ReturnType<typeof useCriticalAlerts>["data"] }) {
  if (!alerts) return null;

  const allAlerts = [
    ...alerts.staleRequests.map(r => ({
      type: "Pedido demorado", detail: `#${(r as any).request_number} — pendiente >24h`,
      severity: "warning" as const, created: r.created_at,
    })),
    ...alerts.noBims.map(f => ({
      type: "Sin documento BIMS", detail: `Estado: ${f.status}`,
      severity: "destructive" as const, created: f.created_at,
    })),
    ...alerts.openIncidents.map(i => ({
      type: `Incidencia: ${INCIDENT_TYPE_LABELS[(i as any).incident_type] || (i as any).incident_type}`,
      detail: (i as any).title, severity: "destructive" as const, created: i.created_at,
    })),
    ...alerts.failedDeliveries.map(f => ({
      type: "Entrega fallida", detail: (f as any).delivery_failed_reason || "Sin motivo",
      severity: "warning" as const, created: (f as any).delivery_failed_at || "",
    })),
    ...alerts.anomalies.map(a => ({
      type: (a as any).anomaly_type, detail: (a as any).title,
      severity: ((a as any).severity === "critical" ? "destructive" : "warning") as "destructive" | "warning",
      created: a.created_at,
    })),
  ];

  if (allAlerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ShieldCheck className="h-10 w-10 text-accent mb-2" />
        <p className="font-semibold text-foreground text-sm">Sin alertas críticas</p>
        <p className="text-xs text-muted-foreground">Operación dentro de parámetros normales</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
      {allAlerts.slice(0, 12).map((a, i) => (
        <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/50 border border-border/50">
          <AlertTriangle className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${a.severity === "destructive" ? "text-destructive" : "text-secondary"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">{a.type}</p>
            <p className="text-[10px] text-muted-foreground truncate">{a.detail}</p>
          </div>
          <Badge variant={a.severity === "destructive" ? "destructive" : "secondary"} className="text-[9px] shrink-0">
            {a.severity === "destructive" ? "Crítico" : "Alerta"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

/* ── Branch Chart ── */
function BranchPerformanceChart({ data }: { data: any[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">Sin datos en el período</p>;
  const chartData = data.slice(0, 10).map(b => ({ name: b.code || b.name.slice(0, 8), ops: b.fulfillments, inc: b.incidents }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <Tooltip contentStyle={{ borderRadius: "0.5rem", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
        <Bar dataKey="ops" name="Operaciones" fill="hsl(220, 70%, 45%)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="inc" name="Incidencias" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Compliance Ranking ── */
function ComplianceRanking({ data }: { data: any[] }) {
  return (
    <div className="space-y-3">
      {data.slice(0, 8).map((b, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground w-4 text-right">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium text-foreground truncate">{b.name}</span>
              <span className="text-sm font-bold text-foreground">{b.compliance}%</span>
            </div>
            <Progress value={b.compliance} className="h-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Cycle Times ── */
function CycleTimesPanel({ data }: { data: ReturnType<typeof useCycleTimes>["data"] }) {
  if (!data) return null;

  const stages = [
    { label: "Solicitud → Aceptación", hours: data.reqToAcceptance, icon: ClipboardList },
    { label: "Creación → Despacho", hours: data.preparation, icon: Package },
    { label: "Despacho → Recepción", hours: data.transit, icon: Truck },
    { label: "Ciclo total", hours: data.totalCycle, icon: Route },
  ];

  function formatHours(h: number | null): string {
    if (h === null) return "—";
    if (h < 1) return `${Math.round(h * 60)}min`;
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24 * 10) / 10}d`;
  }

  return (
    <div className="space-y-3">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/40">
          <s.icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-foreground flex-1">{s.label}</span>
          <span className={`text-lg font-bold ${s.hours === null ? "text-muted-foreground" : "text-foreground"}`}>
            {formatHours(s.hours)}
          </span>
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground text-center">
        Basado en {data.sampleSize} operaciones con datos completos
      </p>
    </div>
  );
}

/* ── Adoption ── */
function AdoptionMetrics({ data }: { data: ReturnType<typeof useSystemAdoption>["data"] }) {
  if (!data) return null;

  const metrics = [
    { label: "Usuarios activos", value: data.activeUsers, sub: `de ${data.totalProfiles}`, icon: Users, pct: false },
    { label: "Doc. correcta", value: `${data.docCompliance}%`, icon: FileWarning, pct: true, raw: data.docCompliance },
    { label: "Entregas confirmadas", value: `${data.deliveryConfirmed}%`, icon: CheckCircle2, pct: true, raw: data.deliveryConfirmed },
    { label: "Recepciones", value: `${data.receptionConfirmed}%`, icon: Package, pct: true, raw: data.receptionConfirmed },
    { label: "Flujo completo", value: `${data.fullFlowOps}%`, icon: ListChecks, pct: true, raw: data.fullFlowOps },
    { label: "Pasos omitidos", value: data.skippedSteps, icon: ShieldAlert, pct: false },
    { label: "Eventos trazados", value: data.totalEvents, icon: Activity, pct: false },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {metrics.map((m, i) => (
        <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center space-y-1">
          <m.icon className="h-4 w-4 mx-auto text-muted-foreground" />
          <p className="text-lg font-bold text-foreground">{m.value}</p>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-tight">{m.label}</p>
          {"sub" in m && m.sub && <p className="text-[9px] text-muted-foreground">{m.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/* ── Incidents Pie ── */
function IncidentsPieChart({ data }: { data: { type: string; count: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">Sin incidencias en el período</p>;
  const COLORS = ["hsl(0, 72%, 51%)", "hsl(38, 92%, 50%)", "hsl(220, 70%, 45%)", "hsl(160, 60%, 40%)", "hsl(260, 60%, 55%)", "hsl(200, 80%, 50%)"];
  const chartData = data.map(d => ({ name: INCIDENT_TYPE_LABELS[d.type] || d.type, value: d.count }));
  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={170}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
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

/* ── AI Insights Panel ── */
function AIInsightsPanel({ insights, isLoading, onRefresh }: {
  insights?: AIInsights | null; isLoading: boolean; onRefresh: () => void;
}) {
  const healthColors: Record<string, string> = {
    "Crítico": "text-destructive",
    "Requiere atención": "text-secondary",
    "Aceptable": "text-muted-foreground",
    "Bueno": "text-accent",
    "Excelente": "text-accent",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Analizando datos operativos...</span>
      </div>
    );
  }

  if (!insights || insights.healthScore === null) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <Brain className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Análisis no disponible</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generar análisis
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Health Score */}
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--muted))" strokeWidth="5" />
            <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--primary))" strokeWidth="5"
              strokeDasharray={`${(insights.healthScore / 100) * 176} 176`}
              strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">
            {insights.healthScore}
          </span>
        </div>
        <div>
          <p className={`font-semibold ${healthColors[insights.healthLabel] || "text-foreground"}`}>
            {insights.healthLabel}
          </p>
          <p className="text-sm text-muted-foreground">{insights.summary}</p>
        </div>
      </div>

      {/* Findings */}
      {insights.findings?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Hallazgos</p>
          <div className="space-y-1.5">
            {insights.findings.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Eye className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                <span className="text-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {insights.risks?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Riesgos</p>
          <div className="space-y-1.5">
            {insights.risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-secondary shrink-0" />
                <span className="text-foreground">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {insights.recommendations?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Recomendaciones</p>
          <div className="space-y-1.5">
            {insights.recommendations.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <Zap className="h-3.5 w-3.5 mt-0.5 text-accent shrink-0" />
                <span className="text-foreground">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={onRefresh} className="w-full text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3 mr-1.5" /> Actualizar análisis
      </Button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════════ */
export default function DashboardEjecutivo() {
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [branchId, setBranchId] = useState<string>("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const { data: branches } = useBranches();
  const selectedBranch = branchId && branchId !== "all" ? branchId : undefined;

  const { data: kpis, isLoading: loadingKPIs } = useExecutiveKPIs(dateRange, selectedBranch);
  const { data: funnel } = useOperationalFunnel(dateRange, selectedBranch);
  const { data: alerts } = useCriticalAlerts(selectedBranch);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Gauge className="h-6 w-6 text-primary" />
            Dashboard Ejecutivo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Control gerencial de operaciones logísticas</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-44">
              <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DATE_RANGE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchId || "all"} onValueChange={setBranchId}>
            <SelectTrigger className="w-48">
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
        <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
          {/* 1. KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <KPICard icon={ClipboardList} label="Solicitudes" value={kpis?.reqCreated || 0} color="bg-primary" />
            <KPICard icon={Package} label="En preparación" value={kpis?.inPrep || 0} color="bg-info" />
            <KPICard icon={Truck} label="En tránsito" value={kpis?.inTransit || 0} color="bg-secondary" />
            <KPICard icon={CheckCircle2} label="Entregadas" value={kpis?.delivered || 0} color="bg-accent" />
            <KPICard icon={AlertTriangle} label="Incidencias" value={kpis?.openIncidents || 0} color="bg-destructive" />
            <KPICard icon={TrendingUp} label="Cumplimiento" value={`${kpis?.compliance || 0}%`} subtitle="entregadas / total" color="bg-accent" />
            <KPICard icon={Route} label="Trazabilidad" value={`${kpis?.fullTraceability || 0}%`} subtitle="doc + despacho" color="bg-primary" />
          </div>

          {/* 2. Funnel + 3. Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  Embudo Operativo
                </CardTitle>
                <CardDescription>Distribución acumulativa por etapa</CardDescription>
              </CardHeader>
              <CardContent>
                {funnel ? <FunnelChart data={funnel} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    Alertas Críticas
                  </CardTitle>
                  {totalAlerts > 0 && <Badge variant="destructive" className="text-xs">{totalAlerts}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <AlertPanel alerts={alerts} />
              </CardContent>
            </Card>
          </div>

          {/* AI Insights + Cycle Times */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Diagnóstico IA
                </CardTitle>
                <CardDescription>Análisis automatizado de la operación</CardDescription>
              </CardHeader>
              <CardContent>
                <AIInsightsPanel insights={aiInsights} isLoading={loadingAI} onRefresh={handleAIRefresh} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Timer className="h-4 w-4 text-secondary" />
                  Tiempos de Ciclo
                </CardTitle>
                <CardDescription>Promedios entre etapas operativas</CardDescription>
              </CardHeader>
              <CardContent>
                {cycleTimes ? <CycleTimesPanel data={cycleTimes} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
          </div>

          {/* 4. Branch Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Volumen por Sucursal
                </CardTitle>
              </CardHeader>
              <CardContent>
                {branchPerf ? <BranchPerformanceChart data={branchPerf} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" /> Ranking de Cumplimiento
                </CardTitle>
              </CardHeader>
              <CardContent>
                {branchPerf ? <ComplianceRanking data={branchPerf} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
          </div>

          {/* 6. Adoption */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Adopción del Sistema
              </CardTitle>
              <CardDescription>Uso del flujo, trazabilidad documental y completitud operativa</CardDescription>
            </CardHeader>
            <CardContent>
              {adoption ? <AdoptionMetrics data={adoption} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
            </CardContent>
          </Card>

          {/* 7. Incidents */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" /> Incidencias por Tipo
                </CardTitle>
                <CardDescription>
                  {incidents ? `${incidents.total} total — ${incidents.open} abiertas` : "Cargando..."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {incidents ? <IncidentsPieChart data={incidents.byType} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" /> Resumen Operativo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-2xl font-bold text-foreground">{kpis?.totalFulfillments || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Cargas activas</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-2xl font-bold text-accent">{kpis?.compliance || 0}%</p>
                    <p className="text-[10px] text-muted-foreground">Cumplimiento</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-2xl font-bold text-primary">{kpis?.fullTraceability || 0}%</p>
                    <p className="text-[10px] text-muted-foreground">Trazabilidad</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-2xl font-bold text-destructive">{kpis?.opsWithAlerts || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Ops con alerta</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>
      )}
    </div>
  );
}
