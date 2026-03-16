import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Truck, Wrench, ArrowRightLeft, AlertTriangle, CheckCircle2, Calendar, Gauge,
} from "lucide-react";

const VEHICLE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available: { label: "Disponible", color: "bg-accent/10 text-accent" },
  in_use: { label: "En uso", color: "bg-primary/10 text-primary" },
  maintenance: { label: "En mantenimiento", color: "bg-secondary/10 text-secondary" },
  out_of_service: { label: "Fuera de servicio", color: "bg-destructive/10 text-destructive" },
};

const MAINT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  scheduled: { label: "Programado", color: "bg-secondary/10 text-secondary" },
  in_progress: { label: "En curso", color: "bg-primary/10 text-primary" },
  completed: { label: "Completado", color: "bg-accent/10 text-accent" },
};

export default function Flota() {
  const [tab, setTab] = useState("vehiculos");
  const [detailVehicleId, setDetailVehicleId] = useState<string | null>(null);

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

  const { data: vehicleDetail } = useQuery({
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

  const upcomingMaint = maintenance?.filter(m => m.status === "scheduled" && m.scheduled_date && new Date(m.scheduled_date) >= new Date()) || [];
  const overdueVtv = vehicles?.filter(v => v.vtv_expiry && new Date(v.vtv_expiry) < new Date()) || [];
  const overdueInsurance = vehicles?.filter(v => v.insurance_expiry && new Date(v.insurance_expiry) < new Date()) || [];

  const selectedVehicle = vehicles?.find(v => v.id === detailVehicleId);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Gestión de Flota</h1>
        <p className="text-muted-foreground mt-1">Vehículos, mantenimiento preventivo, préstamos y estado operativo</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Disponibles</p>
            <p className="text-2xl font-display font-bold text-accent">{availableCount}/{totalVehicles}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">En ruta</p>
            <p className="text-2xl font-display font-bold text-primary">{inUseCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">En mantenimiento</p>
            <p className="text-2xl font-display font-bold text-secondary">{maintCount}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Alertas</p>
            <p className="text-2xl font-display font-bold text-destructive">{overdueVtv.length + overdueInsurance.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Document alerts */}
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

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="vehiculos" className="gap-2 text-xs"><Truck className="h-3.5 w-3.5" /> Vehículos</TabsTrigger>
          <TabsTrigger value="mantenimiento" className="gap-2 text-xs"><Wrench className="h-3.5 w-3.5" /> Mantenimiento</TabsTrigger>
          <TabsTrigger value="prestamos" className="gap-2 text-xs"><ArrowRightLeft className="h-3.5 w-3.5" /> Préstamos</TabsTrigger>
        </TabsList>

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
                      <div key={v.id}
                        className="p-4 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setDetailVehicleId(v.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <span className="font-mono font-bold text-sm">{v.plate}</span>
                              <span className="text-muted-foreground text-xs ml-2">
                                {v.brand} {v.model} {v.year ? `(${v.year})` : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {v.assigned_branch && (
                              <span className="text-xs text-muted-foreground">{(v.assigned_branch as any).code}</span>
                            )}
                            {v.current_mileage > 0 && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <Gauge className="h-3 w-3" /> {v.current_mileage.toLocaleString()} km
                              </span>
                            )}
                            <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
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

        <TabsContent value="mantenimiento" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {!maintenance?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin registros de mantenimiento</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {maintenance.map((m: any) => {
                    const mCfg = MAINT_STATUS_LABELS[m.status] || MAINT_STATUS_LABELS.scheduled;
                    return (
                      <div key={m.id} className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono font-semibold text-sm">{(m.vehicle as any)?.plate_number}</span>
                              <Badge variant="outline" className="text-xs">{m.maintenance_type}</Badge>
                            </div>
                            <p className="text-sm">{m.description}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {m.scheduled_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(m.scheduled_date).toLocaleDateString("es-PY")}
                                </span>
                              )}
                              {m.provider && <span>{m.provider}</span>}
                              {m.cost && <span>₲ {Number(m.cost).toLocaleString("es-PY")}</span>}
                            </div>
                          </div>
                          <Badge className={`text-xs ${mCfg.color}`}>{mCfg.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prestamos" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
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
                            <span className="text-xs text-muted-foreground">
                              {(l.lending_branch as any)?.code} → {(l.borrowing_branch as any)?.code}
                            </span>
                          </div>
                          {l.reason && <p className="text-sm text-muted-foreground">{l.reason}</p>}
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            {l.start_date && <span>Desde: {new Date(l.start_date).toLocaleDateString("es-PY")}</span>}
                            {l.expected_return_date && <span>Retorno: {new Date(l.expected_return_date).toLocaleDateString("es-PY")}</span>}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">{l.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Vehicle detail dialog */}
      <Dialog open={!!detailVehicleId} onOpenChange={(o) => !o && setDetailVehicleId(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {selectedVehicle?.plate} — {selectedVehicle?.brand} {selectedVehicle?.model}
            </DialogTitle>
          </DialogHeader>
          {selectedVehicle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xs text-muted-foreground">Kilometraje</p>
                  <p className="font-mono font-bold">{selectedVehicle.current_mileage?.toLocaleString() || 0} km</p>
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

              {vehicleDetail && vehicleDetail.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Historial de mantenimiento</h4>
                  <div className="space-y-1">
                    {vehicleDetail.map((m: any) => (
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
    </motion.div>
  );
}
