import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Fuel, Gauge, TrendingUp, Wrench, AlertTriangle, Receipt } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const RANGE_OPTIONS = [
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "365", label: "Último año" },
];

const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--secondary))", "#f59e0b", "#ec4899", "#8b5cf6"];

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function FleetDashboard() {
  const [range, setRange] = useState("90");
  const [vehicleId, setVehicleId] = useState("");

  const sinceISO = useMemo(() => daysAgoISO(parseInt(range, 10)), [range]);
  const sinceDate = sinceISO.slice(0, 10);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("id, plate, nickname, status").eq("is_active", true).order("plate");
      return data ?? [];
    },
  });

  const { data: usages } = useQuery({
    queryKey: ["dash-usages", sinceISO, vehicleId],
    queryFn: async () => {
      let q = supabase.from("vehicle_usages").select("vehicle_id, km_traveled, started_at, category_id").gte("started_at", sinceISO);
      if (vehicleId) q = q.eq("vehicle_id", vehicleId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: fuels } = useQuery({
    queryKey: ["dash-fuels", sinceDate, vehicleId],
    queryFn: async () => {
      let q = supabase.from("fuel_records").select("vehicle_id, liters, total_amount, computed_efficiency_kmpl, date").gte("date", sinceDate);
      if (vehicleId) q = q.eq("vehicle_id", vehicleId);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["vehicle-usage-categories-all"],
    queryFn: async () => {
      const { data } = await supabase.from("vehicle_usage_categories").select("id, name");
      return data ?? [];
    },
  });

  const { data: upcomingMaint } = useQuery({
    queryKey: ["dash-upcoming-maint"],
    queryFn: async () => {
      const in7 = new Date();
      in7.setDate(in7.getDate() + 14);
      const { data } = await supabase
        .from("vehicle_maintenance")
        .select("id, maintenance_type, description, scheduled_date, scheduled_km, vehicle:vehicles(plate, current_mileage)")
        .in("status", ["scheduled", "in_progress"])
        .order("scheduled_date", { ascending: true })
        .limit(10);
      return (data ?? []).filter((m: any) => {
        if (m.scheduled_date && new Date(m.scheduled_date) <= in7) return true;
        if (m.scheduled_km && m.vehicle?.current_mileage) return m.scheduled_km - m.vehicle.current_mileage <= 500;
        return false;
      });
    },
  });

  const { data: pendingFines } = useQuery({
    queryKey: ["dash-pending-fines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_fines")
        .select("id, amount, due_date, infraction_type, vehicle:vehicles(plate)")
        .eq("status", "pending")
        .order("due_date", { ascending: true });
      return data ?? [];
    },
  });

  // ---- KPI aggregates ----
  const totalKm = (usages ?? []).reduce((s, u: any) => s + Number(u.km_traveled || 0), 0);
  const totalLiters = (fuels ?? []).reduce((s, f: any) => s + Number(f.liters || 0), 0);
  const totalSpent = (fuels ?? []).reduce((s, f: any) => s + Number(f.total_amount || 0), 0);
  const avgKmpl = totalLiters > 0 ? totalKm / totalLiters : 0;
  const costPerKm = totalKm > 0 ? totalSpent / totalKm : 0;
  const activeVehicles = (vehicles ?? []).filter((v: any) => v.status !== "out_of_service").length;
  const totalPendingFines = (pendingFines ?? []).reduce((s: number, f: any) => s + Number(f.amount || 0), 0);

  // ---- Monthly fuel per vehicle (bar chart) ----
  const monthlyFuel = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const f of fuels ?? []) {
      const month = String(f.date).slice(0, 7);
      const plate = (vehicles ?? []).find((v: any) => v.id === f.vehicle_id)?.plate || "—";
      if (!map.has(month)) map.set(month, { month } as any);
      const row = map.get(month)!;
      (row as any)[plate] = ((row as any)[plate] || 0) + Number(f.total_amount || 0);
    }
    return Array.from(map.values()).sort((a: any, b: any) => a.month.localeCompare(b.month));
  }, [fuels, vehicles]);

  const plates = useMemo(() => {
    const set = new Set<string>();
    for (const row of monthlyFuel) for (const k of Object.keys(row)) if (k !== "month") set.add(k);
    return Array.from(set);
  }, [monthlyFuel]);

  // ---- Efficiency line chart ----
  const efficiencyData = useMemo(() => {
    const perVehicle: Record<string, { date: string; kmpl: number }[]> = {};
    for (const f of fuels ?? []) {
      if (!f.computed_efficiency_kmpl) continue;
      const plate = (vehicles ?? []).find((v: any) => v.id === f.vehicle_id)?.plate || "—";
      perVehicle[plate] = perVehicle[plate] || [];
      perVehicle[plate].push({ date: String(f.date), kmpl: Number(f.computed_efficiency_kmpl) });
    }
    const allDates = Array.from(new Set(Object.values(perVehicle).flat().map((p) => p.date))).sort();
    return allDates.map((d) => {
      const row: any = { date: d };
      for (const [plate, entries] of Object.entries(perVehicle)) {
        const e = entries.find((x) => x.date === d);
        if (e) row[plate] = e.kmpl;
      }
      return row;
    });
  }, [fuels, vehicles]);

  const efficiencyPlates = Object.keys(
    (fuels ?? []).reduce<Record<string, true>>((acc, f: any) => {
      const plate = (vehicles ?? []).find((v: any) => v.id === f.vehicle_id)?.plate;
      if (plate && f.computed_efficiency_kmpl) acc[plate] = true;
      return acc;
    }, {})
  );

  // ---- Usage by category (pie) ----
  const usageByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of usages ?? []) {
      const name = (categories ?? []).find((c: any) => c.id === u.category_id)?.name || "Sin categoría";
      map[name] = (map[name] || 0) + Number(u.km_traveled || 0);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [usages, categories]);

  // ---- Top vehicles by km ----
  const topByKm = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of usages ?? []) {
      const plate = (vehicles ?? []).find((v: any) => v.id === u.vehicle_id)?.plate || "—";
      map[plate] = (map[plate] || 0) + Number(u.km_traveled || 0);
    }
    return Object.entries(map)
      .map(([plate, km]) => ({ plate, km }))
      .sort((a, b) => b.km - a.km)
      .slice(0, 5);
  }, [usages, vehicles]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={vehicleId || "__all"} onValueChange={(v) => setVehicleId(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Vehículo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos los vehículos</SelectItem>
            {vehicles?.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<Gauge className="h-4 w-4" />} label="Km recorridos" value={totalKm.toLocaleString("de-DE")} />
        <KpiCard icon={<Fuel className="h-4 w-4" />} label="Litros" value={totalLiters.toLocaleString("de-DE", { maximumFractionDigits: 1 })} />
        <KpiCard icon={<Receipt className="h-4 w-4" />} label="Gasto (₲)" value={totalSpent.toLocaleString("de-DE")} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Rend. promedio" value={`${avgKmpl.toFixed(2)} km/L`} />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Costo por km" value={`₲ ${Math.round(costPerKm).toLocaleString("de-DE")}`} />
        <KpiCard icon={<Gauge className="h-4 w-4" />} label="Activos" value={`${activeVehicles}/${vehicles?.length ?? 0}`} />
      </div>

      {/* Alerts panel */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-sm flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Próximos mantenimientos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {!upcomingMaint?.length ? (
              <p className="text-sm text-muted-foreground">Sin mantenimientos próximos</p>
            ) : (
              upcomingMaint.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                  <div>
                    <span className="font-mono font-semibold">{m.vehicle?.plate}</span>
                    <span className="text-muted-foreground ml-2">{m.maintenance_type}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {m.scheduled_date ? new Date(m.scheduled_date).toLocaleDateString("es-PY") : `${m.scheduled_km?.toLocaleString("de-DE")} km`}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Multas pendientes
              <Badge variant="destructive" className="ml-auto">₲ {totalPendingFines.toLocaleString("de-DE")}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {!pendingFines?.length ? (
              <p className="text-sm text-muted-foreground">Sin multas pendientes</p>
            ) : (
              pendingFines.slice(0, 5).map((f: any) => (
                <div key={f.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                  <div>
                    <span className="font-mono font-semibold">{f.vehicle?.plate}</span>
                    <span className="text-muted-foreground ml-2">{f.infraction_type}</span>
                  </div>
                  <span className="text-xs">₲ {Number(f.amount).toLocaleString("de-DE")}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="font-display text-sm">Gasto mensual por vehículo</CardTitle></CardHeader>
          <CardContent className="h-64">
            {monthlyFuel.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sin datos</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={monthlyFuel}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => `₲ ${Number(v).toLocaleString("de-DE")}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {plates.map((p, i) => <Bar key={p} dataKey={p} stackId="a" fill={COLORS[i % COLORS.length]} />)}
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="font-display text-sm">Rendimiento km/L</CardTitle></CardHeader>
          <CardContent className="h-64">
            {efficiencyData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sin datos</div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={efficiencyData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {efficiencyPlates.map((p, i) => (
                    <Line key={p} type="monotone" dataKey={p} stroke={COLORS[i % COLORS.length]} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="font-display text-sm">Uso por categoría (km)</CardTitle></CardHeader>
          <CardContent className="h-64">
            {usageByCategory.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sin datos</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={usageByCategory} dataKey="value" nameKey="name" outerRadius={80} label={{ fontSize: 11 }}>
                    {usageByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${Number(v).toLocaleString("de-DE")} km`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="font-display text-sm">Top 5 vehículos por km</CardTitle></CardHeader>
          <CardContent className="h-64">
            {topByKm.length === 0 ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sin datos</div>
            ) : (
              <ResponsiveContainer>
                <BarChart data={topByKm} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="plate" tick={{ fontSize: 11 }} width={70} />
                  <Tooltip formatter={(v: any) => `${Number(v).toLocaleString("de-DE")} km`} />
                  <Bar dataKey="km" fill={COLORS[0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="glass-card">
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {icon} {label}
        </div>
        <p className="font-display text-lg font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
