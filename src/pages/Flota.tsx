import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Truck, Wrench, ArrowRightLeft, AlertTriangle, Calendar, Gauge, Plus, Fuel, Route, Settings, Images, Pencil, BarChart3, Receipt, Flag,
} from "lucide-react";
import { VehicleForm, type VehicleFormValues } from "@/components/flota/VehicleForm";
import { VehicleUsageForm } from "@/components/flota/VehicleUsageForm";
import { OpenTripsSection } from "@/components/flota/OpenTripsSection";
import { FuelRecordForm } from "@/components/flota/FuelRecordForm";
import { UsageCategoryManager } from "@/components/flota/UsageCategoryManager";
import { VehiclePhotoGallery } from "@/components/flota/VehiclePhotoGallery";
import { MaintenanceForm } from "@/components/flota/MaintenanceForm";
import { MaintenanceAlertsBadge } from "@/components/flota/MaintenanceAlertsBadge";
import { FinesList } from "@/components/flota/FinesList";
import { FleetDashboard } from "@/components/flota/FleetDashboard";

const VEHICLE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available: { label: "Disponible", color: "bg-accent/10 text-accent" },
  in_route: { label: "En ruta", color: "bg-primary/10 text-primary" },
  in_trip: { label: "En viaje", color: "bg-primary/10 text-primary" },
  maintenance: { label: "En mantenimiento", color: "bg-secondary/10 text-secondary" },
  out_of_service: { label: "Fuera de servicio", color: "bg-destructive/10 text-destructive" },
};

const MAINT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Programado", color: "bg-secondary/10 text-secondary" },
  in_progress: { label: "En curso", color: "bg-primary/10 text-primary" },
  completed: { label: "Completado", color: "bg-accent/10 text-accent" },
};

export default function Flota() {
  const { isOwner, hasRole } = useAuth();
  const isPrivileged = isOwner || hasRole("admin") || hasRole("supervisor");

  const [tab, setTab] = useState(isPrivileged ? "reportes" : "vehiculos");
  const [detailVehicleId, setDetailVehicleId] = useState<string | null>(null);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [vehicleEditing, setVehicleEditing] = useState<Partial<VehicleFormValues> | null>(null);
  const [usageFormOpen, setUsageFormOpen] = useState(false);
  const [openTripsModalOpen, setOpenTripsModalOpen] = useState(false);
  const [fuelFormOpen, setFuelFormOpen] = useState(false);
  const [maintFormOpen, setMaintFormOpen] = useState(false);
  const [maintEditing, setMaintEditing] = useState<any>(null);
  const [filterVehicle, setFilterVehicle] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select(`*, assigned_branch:branches!vehicles_assigned_branch_id_fkey(name, code)`)
        .eq("is_active", true)
        .order("plate", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["vehicle-usage-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_usage_categories").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: usages } = useQuery({
    queryKey: ["vehicle-usages", filterVehicle, filterCategory],
    queryFn: async () => {
      let q = supabase
        .from("vehicle_usages")
        .select(`
          *,
          vehicle:vehicles(plate, nickname),
          category:vehicle_usage_categories(name),
          driver:drivers(user_id, profile:profiles!drivers_user_id_fkey(full_name))
        `)
        .order("started_at", { ascending: false })
        .limit(50);
      if (filterVehicle) q = q.eq("vehicle_id", filterVehicle);
      if (filterCategory) q = q.eq("category_id", filterCategory);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: fuelRecords } = useQuery({
    queryKey: ["fuel-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fuel_records")
        .select(`*, vehicle:vehicles(plate, nickname)`)
        .order("date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: maintenance } = useQuery({
    queryKey: ["vehicle-maintenance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance")
        .select(`*, vehicle:vehicles(plate_number: plate, brand, model)`)
        .order("scheduled_date", { ascending: true })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const { data: loans } = useQuery({
    queryKey: ["vehicle-loans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_loans")
        .select(`
          *,
          vehicle:vehicles(plate_number: plate, brand, model),
          lending_branch:branches!vehicle_loans_lending_branch_id_fkey(name, code),
          borrowing_branch:branches!vehicle_loans_borrowing_branch_id_fkey(name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const { data: vehicleMaintHistory } = useQuery({
    queryKey: ["vehicle-detail", detailVehicleId],
    enabled: !!detailVehicleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_maintenance")
        .select("*")
        .eq("vehicle_id", detailVehicleId!)
        .order("scheduled_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const availableCount = vehicles?.filter(v => v.status === "available").length || 0;
  const inUseCount = vehicles?.filter(v => v.status === "in_route").length || 0;
  const maintCount = vehicles?.filter(v => v.status === "maintenance").length || 0;
  const totalVehicles = vehicles?.length || 0;

  const overdueVtv = vehicles?.filter(v => v.vtv_expiry && new Date(v.vtv_expiry) < new Date()) || [];
  const overdueInsurance = vehicles?.filter(v => v.insurance_expiry && new Date(v.insurance_expiry) < new Date()) || [];

  const selectedVehicle = vehicles?.find(v => v.id === detailVehicleId);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Control de Móviles</h1>
          <p className="text-muted-foreground mt-1">Vehículos, usos, combustible, mantenimiento y documentación</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setUsageFormOpen(true)} className="gap-2">
            <Route className="h-4 w-4" /> Iniciar viaje
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpenTripsModalOpen(true)} className="gap-2">
            <Flag className="h-4 w-4" /> Terminar viaje
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFuelFormOpen(true)} className="gap-2">
            <Fuel className="h-4 w-4" /> Cargar combustible
          </Button>
          {isPrivileged && (
            <Button size="sm" onClick={() => { setVehicleEditing(null); setVehicleFormOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Nuevo vehículo
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Disponibles</p>
          <p className="text-2xl font-display font-bold text-accent">{availableCount}/{totalVehicles}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">En ruta</p>
          <p className="text-2xl font-display font-bold text-primary">{inUseCount}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">En mantenimiento</p>
          <p className="text-2xl font-display font-bold text-secondary">{maintCount}</p>
        </CardContent></Card>
        <Card className="glass-card"><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Alertas</p>
          <p className="text-2xl font-display font-bold text-destructive">{overdueVtv.length + overdueInsurance.length}</p>
        </CardContent></Card>
      </div>

      {(overdueVtv.length > 0 || overdueInsurance.length > 0) && (
        <Card className="glass-card border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Documentación vencida
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {overdueVtv.map((v: any) => (
              <div key={`vtv-${v.id}`} className="flex items-center justify-between p-2 rounded bg-destructive/5 text-sm">
                <span className="font-mono font-semibold">{v.plate}</span>
                <Badge variant="destructive" className="text-xs">VTV vencida {new Date(v.vtv_expiry).toLocaleDateString("es-PY")}</Badge>
              </div>
            ))}
            {overdueInsurance.map((v: any) => (
              <div key={`ins-${v.id}`} className="flex items-center justify-between p-2 rounded bg-destructive/5 text-sm">
                <span className="font-mono font-semibold">{v.plate}</span>
                <Badge variant="destructive" className="text-xs">Seguro vencido {new Date(v.insurance_expiry).toLocaleDateString("es-PY")}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <OpenTripsSection />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex w-full overflow-x-auto">
          {isPrivileged && (
            <TabsTrigger value="reportes" className="gap-1 text-xs"><BarChart3 className="h-3.5 w-3.5" /> Reportes</TabsTrigger>
          )}
          <TabsTrigger value="vehiculos" className="gap-1 text-xs"><Truck className="h-3.5 w-3.5" /> Vehículos</TabsTrigger>
          <TabsTrigger value="usos" className="gap-1 text-xs"><Route className="h-3.5 w-3.5" /> Usos</TabsTrigger>
          <TabsTrigger value="combustible" className="gap-1 text-xs"><Fuel className="h-3.5 w-3.5" /> Combustible</TabsTrigger>
          <TabsTrigger value="mantenimiento" className="gap-1 text-xs"><Wrench className="h-3.5 w-3.5" /> Mantenimiento</TabsTrigger>
          <TabsTrigger value="multas" className="gap-1 text-xs"><Receipt className="h-3.5 w-3.5" /> Multas</TabsTrigger>
          <TabsTrigger value="prestamos" className="gap-1 text-xs"><ArrowRightLeft className="h-3.5 w-3.5" /> Préstamos</TabsTrigger>
          {isPrivileged && (
            <TabsTrigger value="config" className="gap-1 text-xs"><Settings className="h-3.5 w-3.5" /> Configuración</TabsTrigger>
          )}
        </TabsList>

        {isPrivileged && (
          <TabsContent value="reportes" className="mt-4">
            <FleetDashboard />
          </TabsContent>
        )}

        <TabsContent value="vehiculos" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {!vehicles?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin vehículos registrados</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {vehicles.map((v: any) => {
                    const statusCfg = VEHICLE_STATUS_LABELS[v.status] || VEHICLE_STATUS_LABELS.available;
                    return (
                      <div key={v.id} className="p-4 hover:bg-muted/20 transition-colors">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <button className="flex items-center gap-3 text-left flex-1 min-w-0" onClick={() => setDetailVehicleId(v.id)}>
                            <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono font-bold text-sm">{v.plate}</span>
                                {v.nickname && <span className="text-xs text-primary">"{v.nickname}"</span>}
                              </div>
                              <span className="text-muted-foreground text-xs">
                                {v.brand} {v.model} {v.year ? `(${v.year})` : ""}
                              </span>
                            </div>
                          </button>
                          <div className="flex items-center gap-2">
                            {v.assigned_branch && (
                              <span className="text-xs text-muted-foreground">{(v.assigned_branch as any).code}</span>
                            )}
                            {v.current_mileage > 0 && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <Gauge className="h-3 w-3" /> {v.current_mileage.toLocaleString("de-DE")} km
                              </span>
                            )}
                            <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
                            <MaintenanceAlertsBadge vehicleId={v.id} currentMileage={v.current_mileage || 0} />
                            {isPrivileged && (
                              <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setVehicleEditing(v); setVehicleFormOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usos" className="mt-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Select value={filterVehicle || "__all"} onValueChange={(v) => setFilterVehicle(v === "__all" ? "" : v)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Todos los vehículos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todos los vehículos</SelectItem>
                {vehicles?.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCategory || "__all"} onValueChange={(v) => setFilterCategory(v === "__all" ? "" : v)}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Todas las categorías" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Todas las categorías</SelectItem>
                {categories?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card className="glass-card"><CardContent className="p-0">
            {!usages?.length ? (
              <div className="p-8 text-center text-muted-foreground">Sin usos registrados</div>
            ) : (
              <div className="divide-y divide-border/50">
                {usages.map((u: any) => (
                  <div key={u.id} className="p-4">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-sm">{u.vehicle?.plate}</span>
                          {u.category?.name && <Badge variant="outline" className="text-xs">{u.category.name}</Badge>}
                        </div>
                        {u.destination && <p className="text-sm mt-0.5">{u.destination}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {u.driver?.profile?.full_name || u.driver_name_text || "—"} · {new Date(u.started_at).toLocaleString("es-PY")}
                        </p>
                      </div>
                      <div className="text-right text-xs">
                        <p className="text-muted-foreground">{u.start_mileage?.toLocaleString("de-DE")} → {u.end_mileage?.toLocaleString("de-DE") || "—"}</p>
                        {u.km_traveled > 0 && <p className="font-semibold text-primary">{u.km_traveled.toLocaleString("de-DE")} km</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="combustible" className="mt-4">
          <Card className="glass-card"><CardContent className="p-0">
            {!fuelRecords?.length ? (
              <div className="p-8 text-center text-muted-foreground">Sin cargas registradas</div>
            ) : (
              <div className="divide-y divide-border/50">
                {fuelRecords.map((f: any) => {
                  const kmpl = f.computed_efficiency_kmpl ? Number(f.computed_efficiency_kmpl) : null;
                  return (
                    <div key={f.id} className="p-4">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-semibold text-sm">{f.vehicle?.plate}</span>
                            <span className="text-xs text-muted-foreground">{new Date(f.date).toLocaleDateString("es-PY")}</span>
                          </div>
                          <p className="text-sm mt-1">
                            {Number(f.liters).toLocaleString("de-DE")} L · ₲ {Number(f.total_amount).toLocaleString("de-DE")}
                            {f.price_per_liter && <span className="text-muted-foreground"> ({Number(f.price_per_liter).toLocaleString("de-DE")}/L)</span>}
                          </p>
                          {f.mileage_at_fill && <p className="text-xs text-muted-foreground">Km: {Number(f.mileage_at_fill).toLocaleString("de-DE")}</p>}
                        </div>
                        {kmpl !== null && (
                          <Badge variant="outline" className="text-xs">{kmpl.toFixed(2)} km/L</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="mantenimiento" className="mt-4 space-y-3">
          {isPrivileged && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setMaintEditing(null); setMaintFormOpen(true); }} className="gap-2">
                <Plus className="h-4 w-4" /> Nuevo mantenimiento
              </Button>
            </div>
          )}
          <Card className="glass-card"><CardContent className="p-0">
            {!maintenance?.length ? (
              <div className="p-8 text-center text-muted-foreground">Sin registros de mantenimiento</div>
            ) : (
              <div className="divide-y divide-border/50">
                {maintenance.map((m: any) => {
                  const mCfg = MAINT_STATUS_LABELS[m.status] || MAINT_STATUS_LABELS.scheduled;
                  return (
                    <div key={m.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-mono font-semibold text-sm">{(m.vehicle as any)?.plate_number}</span>
                            <Badge variant="outline" className="text-xs">{m.maintenance_type}</Badge>
                            {(m.recurrence_km || m.recurrence_days) && (
                              <Badge variant="outline" className="text-xs">Recurrente</Badge>
                            )}
                          </div>
                          <p className="text-sm">{m.description}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                            {m.scheduled_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(m.scheduled_date).toLocaleDateString("es-PY")}</span>}
                            {m.scheduled_km && <span className="flex items-center gap-1"><Gauge className="h-3 w-3" />{Number(m.scheduled_km).toLocaleString("de-DE")} km</span>}
                            {m.provider && <span>{m.provider}</span>}
                            {m.cost && <span>₲ {Number(m.cost).toLocaleString("de-DE")}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className={`text-xs ${mCfg.color}`}>{mCfg.label}</Badge>
                          {isPrivileged && (
                            <Button size="icon" variant="ghost" onClick={() => { setMaintEditing(m); setMaintFormOpen(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="multas" className="mt-4">
          <FinesList canEdit={isPrivileged} />
        </TabsContent>


        <TabsContent value="prestamos" className="mt-4">
          <Card className="glass-card"><CardContent className="p-0">
            {!loans?.length ? (
              <div className="p-8 text-center text-muted-foreground">Sin préstamos registrados</div>
            ) : (
              <div className="divide-y divide-border/50">
                {loans.map((l: any) => (
                  <div key={l.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono font-semibold text-sm">{(l.vehicle as any)?.plate_number}</span>
                          <span className="text-xs text-muted-foreground">{(l.lending_branch as any)?.code} → {(l.borrowing_branch as any)?.code}</span>
                        </div>
                        {l.reason && <p className="text-sm text-muted-foreground">{l.reason}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs capitalize">{l.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent></Card>
        </TabsContent>

        {isPrivileged && (
          <TabsContent value="config" className="mt-4">
            <UsageCategoryManager />
          </TabsContent>
        )}
      </Tabs>

      {/* Vehicle detail dialog */}
      <Dialog open={!!detailVehicleId} onOpenChange={(o) => !o && setDetailVehicleId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {selectedVehicle?.plate} — {selectedVehicle?.brand} {selectedVehicle?.model}
              {selectedVehicle?.nickname && <span className="text-primary ml-2">"{selectedVehicle.nickname}"</span>}
            </DialogTitle>
          </DialogHeader>
          {selectedVehicle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">Kilometraje</p>
                  <p className="font-mono font-bold">{selectedVehicle.current_mileage?.toLocaleString("de-DE") || 0} km</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <Badge className={`text-xs ${(VEHICLE_STATUS_LABELS[selectedVehicle.status] || VEHICLE_STATUS_LABELS.available).color}`}>
                    {(VEHICLE_STATUS_LABELS[selectedVehicle.status] || VEHICLE_STATUS_LABELS.available).label}
                  </Badge>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">VTV</p>
                  <p className={`text-sm font-semibold ${selectedVehicle.vtv_expiry && new Date(selectedVehicle.vtv_expiry) < new Date() ? "text-destructive" : ""}`}>
                    {selectedVehicle.vtv_expiry ? new Date(selectedVehicle.vtv_expiry).toLocaleDateString("es-PY") : "—"}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">Seguro</p>
                  <p className={`text-sm font-semibold ${selectedVehicle.insurance_expiry && new Date(selectedVehicle.insurance_expiry) < new Date() ? "text-destructive" : ""}`}>
                    {selectedVehicle.insurance_expiry ? new Date(selectedVehicle.insurance_expiry).toLocaleDateString("es-PY") : "—"}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-2">
                  <Images className="h-3.5 w-3.5" /> Galería de fotos
                </h4>
                <VehiclePhotoGallery vehicleId={selectedVehicle.id} />
              </div>

              {vehicleMaintHistory && vehicleMaintHistory.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Historial de mantenimiento</h4>
                  <div className="space-y-1">
                    {vehicleMaintHistory.map((m: any) => (
                      <div key={m.id} className="flex justify-between text-sm p-2 bg-muted/20 rounded">
                        <div>
                          <span className="font-medium">{m.maintenance_type}</span>
                          <span className="text-xs text-muted-foreground ml-2">{m.description}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {m.completed_date ? new Date(m.completed_date).toLocaleDateString("es-PY") : m.scheduled_date ? new Date(m.scheduled_date).toLocaleDateString("es-PY") : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {vehicleFormOpen && <VehicleForm open={vehicleFormOpen} onOpenChange={setVehicleFormOpen} initial={vehicleEditing} />}
      {usageFormOpen && <VehicleUsageForm open={usageFormOpen} onOpenChange={setUsageFormOpen} />}
      <OpenTripsSection asModal modalOpen={openTripsModalOpen} onModalOpenChange={setOpenTripsModalOpen} />
      {fuelFormOpen && <FuelRecordForm open={fuelFormOpen} onOpenChange={setFuelFormOpen} />}
      {maintFormOpen && <MaintenanceForm open={maintFormOpen} onOpenChange={setMaintFormOpen} initial={maintEditing} />}
    </motion.div>
  );
}
