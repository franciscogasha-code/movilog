import { useState } from "react";
import { motion } from "framer-motion";
import {
  ClipboardList, Package, Truck, CheckCircle2, AlertTriangle,
  TrendingUp, ShieldCheck, Users, Activity, ArrowDown, ArrowUp,
  Minus, BarChart3, FileWarning, Clock, Loader2, Building2,
  Gauge, Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useBranches } from "@/hooks/use-branches";
import {
  useExecutiveKPIs, useOperationalFunnel, useCriticalAlerts,
  useBranchPerformance, useSystemAdoption, useIncidentBreakdown,
  type DateRange,
} from "@/hooks/use-executive-dashboard";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  damaged: "Avería",
  missing: "Faltante",
  surplus: "Sobrante",
  wrong_product: "Producto incorrecto",
  delayed: "Demora",
  other: "Otro",
};

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  this_month: "Este mes",
  custom: "Personalizado",
};

function KPICard({ icon: Icon, label, value, trend, color }: {
  icon: any; label: string; value: string | number; trend?: number; color: string;
}) {
  return (
    <motion.div variants={item}>
      <Card className="relative overflow-hidden">
        <div className={`absolute top-0 left-0 w-1 h-full ${color}`} />
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-3xl font-bold text-foreground">{value}</p>
            </div>
            <div className={`p-2.5 rounded-xl ${color} bg-opacity-10`}>
              <Icon className="h-5 w-5 text-foreground/70" />
            </div>
          </div>
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-2">
              {trend > 0 ? <ArrowUp className="h-3 w-3 text-accent" /> : trend < 0 ? <ArrowDown className="h-3 w-3 text-destructive" /> : <Minus className="h-3 w-3 text-muted-foreground" />}
              <span className={`text-xs font-medium ${trend > 0 ? "text-accent" : trend < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {Math.abs(trend)}% vs período anterior
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FunnelChart({ data }: { data: { stage: string; count: number; color: string }[] }) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const width = Math.max((d.count / maxCount) * 100, 8);
        const prevCount = i > 0 ? data[i - 1].count : d.count;
        const dropPct = prevCount > 0 && i > 0 ? Math.round(((prevCount - d.count) / prevCount) * 100) : 0;
        return (
          <div key={d.stage} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{d.stage}</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">{d.count}</span>
                {dropPct > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-destructive border-destructive/30">
                    -{dropPct}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="h-7 bg-muted rounded-md overflow-hidden">
              <motion.div
                className="h-full rounded-md flex items-center justify-end pr-2"
                style={{ backgroundColor: d.color, width: `${width}%` }}
                initial={{ width: 0 }}
                animate={{ width: `${width}%` }}
                transition={{ duration: 0.6, delay: i * 0.08 }}
              >
                {width > 20 && <span className="text-[10px] font-semibold text-white">{d.count}</span>}
              </motion.div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlertPanel({ alerts }: { alerts: ReturnType<typeof useCriticalAlerts>["data"] }) {
  if (!alerts) return null;

  const allAlerts = [
    ...alerts.staleRequests.map(r => ({
      type: "Pedido demorado",
      detail: `#${r.request_number} — pendiente >24h`,
      severity: "warning" as const,
      created: r.created_at,
    })),
    ...alerts.noBims.map(f => ({
      type: "Sin documento BIMS",
      detail: `Fulfillment en ${f.status}`,
      severity: "destructive" as const,
      created: f.created_at,
    })),
    ...alerts.openIncidents.map(i => ({
      type: `Incidencia: ${i.incident_type}`,
      detail: i.title,
      severity: "destructive" as const,
      created: i.created_at,
    })),
    ...alerts.failedDeliveries.map(f => ({
      type: "Entrega fallida",
      detail: f.delivery_failed_reason || "Sin motivo",
      severity: "warning" as const,
      created: f.delivery_failed_at || "",
    })),
    ...alerts.anomalies.map(a => ({
      type: a.anomaly_type,
      detail: a.title,
      severity: (a.severity === "critical" ? "destructive" : "warning") as "destructive" | "warning",
      created: a.created_at,
    })),
  ];

  if (allAlerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <ShieldCheck className="h-12 w-12 text-accent mb-3" />
        <p className="font-semibold text-foreground">Sin alertas críticas</p>
        <p className="text-sm text-muted-foreground">La operación se encuentra dentro de parámetros normales</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
      {allAlerts.slice(0, 15).map((a, i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
          <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${a.severity === "destructive" ? "text-destructive" : "text-secondary"}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{a.type}</p>
            <p className="text-xs text-muted-foreground truncate">{a.detail}</p>
          </div>
          <Badge variant={a.severity === "destructive" ? "destructive" : "secondary"} className="text-[10px] shrink-0">
            {a.severity === "destructive" ? "Crítico" : "Alerta"}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function BranchPerformanceChart({ data }: { data: { name: string; code: string; fulfillments: number; incidents: number; compliance: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">Sin datos de sucursales en el período</p>;

  const chartData = data.slice(0, 10).map(b => ({ name: b.code || b.name.slice(0, 8), ops: b.fulfillments, inc: b.incidents, comp: b.compliance }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <Tooltip
          contentStyle={{ borderRadius: "0.5rem", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
          labelStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Bar dataKey="ops" name="Operaciones" fill="hsl(220, 70%, 45%)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="inc" name="Incidencias" fill="hsl(0, 72%, 51%)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ComplianceRanking({ data }: { data: { name: string; compliance: number; fulfillments: number }[] }) {
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

function AdoptionMetrics({ data }: { data: ReturnType<typeof useSystemAdoption>["data"] }) {
  if (!data) return null;

  const metrics = [
    { label: "Usuarios activos", value: data.activeUsers, total: data.totalProfiles, icon: Users },
    { label: "Documentación correcta", value: `${data.docCompliance}%`, icon: FileWarning },
    { label: "Entregas confirmadas", value: `${data.deliveryConfirmed}%`, icon: CheckCircle2 },
    { label: "Recepciones confirmadas", value: `${data.receptionConfirmed}%`, icon: Package },
    { label: "Eventos registrados", value: data.totalEvents, icon: Activity },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {metrics.map((m, i) => (
        <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border/50 text-center space-y-1">
          <m.icon className="h-4 w-4 mx-auto text-muted-foreground" />
          <p className="text-xl font-bold text-foreground">{m.value}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</p>
          {"total" in m && typeof m.total === "number" && (
            <p className="text-[10px] text-muted-foreground">de {m.total} registrados</p>
          )}
        </div>
      ))}
    </div>
  );
}

function IncidentsPieChart({ data }: { data: { type: string; count: number }[] }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">Sin incidencias en el período</p>;

  const COLORS = [
    "hsl(0, 72%, 51%)", "hsl(38, 92%, 50%)", "hsl(220, 70%, 45%)",
    "hsl(160, 60%, 40%)", "hsl(260, 60%, 55%)", "hsl(200, 80%, 50%)",
  ];

  const chartData = data.map(d => ({ name: INCIDENT_TYPE_LABELS[d.type] || d.type, value: d.count }));

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width="50%" height={180}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" stroke="none">
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-2">
        {chartData.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="text-sm text-foreground truncate">{d.name}</span>
            <span className="text-sm font-bold text-foreground ml-auto">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardEjecutivo() {
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [branchId, setBranchId] = useState<string>("");
  const { data: branches } = useBranches();
  const selectedBranch = branchId || undefined;

  const { data: kpis, isLoading: loadingKPIs } = useExecutiveKPIs(dateRange, selectedBranch);
  const { data: funnel } = useOperationalFunnel(dateRange, selectedBranch);
  const { data: alerts } = useCriticalAlerts(selectedBranch);
  const { data: branchPerf } = useBranchPerformance(dateRange, selectedBranch);
  const { data: adoption } = useSystemAdoption(dateRange);
  const { data: incidents } = useIncidentBreakdown(dateRange, selectedBranch);

  const totalAlerts = alerts ? alerts.staleRequests.length + alerts.noBims.length + alerts.openIncidents.length + alerts.failedDeliveries.length + alerts.anomalies.length : 0;

  return (
    <div className="space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Gauge className="h-6 w-6 text-primary" />
            Dashboard Ejecutivo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control gerencial de operaciones logísticas
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-44">
              <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DATE_RANGE_LABELS).filter(([k]) => k !== "custom").map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={branchId} onValueChange={setBranchId}>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <KPICard icon={ClipboardList} label="Solicitudes" value={kpis?.reqCreated || 0} color="bg-primary" />
            <KPICard icon={Package} label="En preparación" value={kpis?.inPrep || 0} color="bg-info" />
            <KPICard icon={Truck} label="En tránsito" value={kpis?.inTransit || 0} color="bg-secondary" />
            <KPICard icon={CheckCircle2} label="Entregadas" value={kpis?.deliveredToday || 0} color="bg-accent" />
            <KPICard icon={AlertTriangle} label="Incidencias" value={kpis?.openIncidents || 0} color="bg-destructive" />
            <KPICard icon={TrendingUp} label="Cumplimiento" value={`${kpis?.compliance || 0}%`} color="bg-accent" />
            <KPICard icon={BarChart3} label="Total cargas" value={kpis?.totalFulfillments || 0} color="bg-primary" />
          </div>

          {/* 2. Funnel + 3. Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  Embudo Operativo
                </CardTitle>
                <CardDescription>Distribución por etapa del ciclo logístico</CardDescription>
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
                  {totalAlerts > 0 && (
                    <Badge variant="destructive" className="text-xs">{totalAlerts}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <AlertPanel alerts={alerts} />
              </CardContent>
            </Card>
          </div>

          {/* 4. Branch Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Volumen por Sucursal
                </CardTitle>
                <CardDescription>Operaciones e incidencias por sucursal</CardDescription>
              </CardHeader>
              <CardContent>
                {branchPerf ? <BranchPerformanceChart data={branchPerf} /> : <Loader2 className="h-6 w-6 animate-spin mx-auto" />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-accent" />
                  Ranking de Cumplimiento
                </CardTitle>
                <CardDescription>Tasa de entregas completadas por sucursal</CardDescription>
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
                <Users className="h-4 w-4 text-primary" />
                Adopción del Sistema
              </CardTitle>
              <CardDescription>Uso activo, trazabilidad y cumplimiento documental</CardDescription>
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
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Incidencias por Tipo
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
                  <Activity className="h-4 w-4 text-info" />
                  Resumen Operativo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-3xl font-bold text-foreground">{kpis?.reqCreated || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">Solicitudes en período</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-3xl font-bold text-foreground">{kpis?.totalFulfillments || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">Cargas totales</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-3xl font-bold text-accent">{kpis?.compliance || 0}%</p>
                    <p className="text-xs text-muted-foreground mt-1">Cumplimiento</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted/50 border border-border/50 text-center">
                    <p className="text-3xl font-bold text-destructive">{kpis?.openIncidents || 0}</p>
                    <p className="text-xs text-muted-foreground mt-1">Incidencias abiertas</p>
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
