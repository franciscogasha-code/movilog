import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  MapPin, Truck, Package, ClipboardList, Calendar, CheckCircle2, Clock, AlertTriangle, Timer,
} from "lucide-react";
import { SHIPPING_METHOD_LABELS, FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";
import { toast } from "sonner";

const COMMERCIAL_RESOLUTION_TYPES: Record<string, string> = {
  reschedule: "Reprogramar entrega",
  negotiate: "Negociar con cliente",
  cancel: "Cancelar pedido",
  redirect: "Redirigir a otra dirección",
};

const EXCEPTION_STATUS_COLORS: Record<string, string> = {
  pending_commercial: "bg-secondary/10 text-secondary",
  escalated: "bg-destructive/10 text-destructive",
  resolved: "bg-accent/10 text-accent",
};

const EXCEPTION_STATUS_LABELS: Record<string, string> = {
  pending_commercial: "Comercial",
  escalated: "Escalada (+24h)",
  resolved: "Resuelta",
};

export default function Distribucion() {
  const [tab, setTab] = useState("en-curso");
  const [exceptionId, setExceptionId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: fulfillments, isLoading } = useQuery({
    queryKey: ["wholesale-fulfillments", tab],
    queryFn: async () => {
      let query = supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          trip:trips(trip_number, status),
          branch_request:branch_requests(request_number, request_type, delivery_target, client_name, client_address)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tab === "en-curso") {
        query = query.in("status", ["pending", "picking", "waiting_for_cut", "waiting_for_courier", "dispatched", "in_transit", "pending_physical_confirmation"] as any);
      } else if (tab === "entregadas") {
        query = query.in("status", ["delivered", "received", "completed"] as any);
      } else if (tab === "excepciones") {
        query = query.not("commercial_exception_status", "is", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data?.filter((f: any) => f.branch_request?.delivery_target === "client" || f.destination_client_name) || [];
    },
  });

  const { data: plannedTrips } = useQuery({
    queryKey: ["wholesale-planned-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`*, origin_branch:branches!trips_origin_branch_id_fkey(name, code), vehicle:vehicles(plate_number, brand, model)`)
        .eq("trip_type", "interurban_planned" as any)
        .in("status", ["planned", "in_progress"] as any)
        .order("planned_departure", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const inTransitCount = fulfillments?.filter((f: any) => ["dispatched", "in_transit"].includes(f.status)).length || 0;
  const pendingCount = fulfillments?.filter((f: any) => ["pending", "picking", "waiting_for_cut"].includes(f.status)).length || 0;
  const exceptionsCount = fulfillments?.filter((f: any) => f.commercial_exception_status === "pending_commercial" || f.commercial_exception_status === "escalated").length || 0;
  const escalatedCount = fulfillments?.filter((f: any) => f.commercial_exception_status === "escalated").length || 0;

  // Calculate exception timers
  const getExceptionAge = (exceptionAt: string | null) => {
    if (!exceptionAt) return null;
    const hours = (Date.now() - new Date(exceptionAt).getTime()) / (1000 * 60 * 60);
    return hours;
  };

  const getTimerColor = (hours: number | null) => {
    if (!hours) return "";
    if (hours >= 24) return "text-destructive font-bold";
    if (hours >= 5) return "text-destructive";
    if (hours >= 3) return "text-secondary";
    return "text-muted-foreground";
  };

  const markException = async (id: string) => {
    try {
      const { error } = await supabase.from("fulfillment_orders").update({
        commercial_exception_at: new Date().toISOString(),
        commercial_exception_status: "pending_commercial",
      }).eq("id", id);
      if (error) throw error;
      toast.success("Excepción comercial registrada");
      queryClient.invalidateQueries({ queryKey: ["wholesale-fulfillments"] });
    } catch (err: any) { toast.error(err.message); }
  };

  const resolveException = async (id: string, resolutionType: string, notes: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("fulfillment_orders").update({
        commercial_exception_status: "resolved",
        commercial_resolution_type: resolutionType,
        commercial_resolution_notes: notes || null,
        commercial_resolved_by: user.id,
        commercial_resolved_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      toast.success("Excepción resuelta");
      queryClient.invalidateQueries({ queryKey: ["wholesale-fulfillments"] });
      setExceptionId(null);
    } catch (err: any) { toast.error(err.message); }
  };

  const currentException = fulfillments?.find(f => f.id === exceptionId);

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Distribución Mayorista</h1>
        <p className="text-muted-foreground mt-1">Pre-venta, planificación de rutas y entregas a clientes mayoristas</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-secondary/10 p-2.5 rounded-xl"><ClipboardList className="h-5 w-5 text-secondary" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">En preparación</p><p className="text-2xl font-display font-bold">{pendingCount}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-primary/10 p-2.5 rounded-xl"><Truck className="h-5 w-5 text-primary" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">En tránsito</p><p className="text-2xl font-display font-bold">{inTransitCount}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-accent/10 p-2.5 rounded-xl"><CheckCircle2 className="h-5 w-5 text-accent" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Entregadas</p><p className="text-2xl font-display font-bold">
              {fulfillments?.filter((f: any) => ["delivered", "received"].includes(f.status)).length || 0}
            </p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-info/10 p-2.5 rounded-xl"><Calendar className="h-5 w-5 text-info" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Viajes planif.</p><p className="text-2xl font-display font-bold">{plannedTrips?.length || 0}</p></div>
          </CardContent>
        </Card>
        {exceptionsCount > 0 && (
          <Card className="glass-card border-secondary/30">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-secondary/10 p-2.5 rounded-xl"><Timer className="h-5 w-5 text-secondary" /></div>
              <div><p className="text-xs text-muted-foreground uppercase">Excepciones</p><p className="text-2xl font-display font-bold text-secondary">{exceptionsCount}</p></div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Planned trips */}
      {plannedTrips && plannedTrips.length > 0 && (
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Viajes con entregas mayoristas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {plannedTrips.map((t: any) => {
              const stops = (t.planned_stops as any[] || []).filter((s: any) => s.type === "delivery_client");
              return (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${t.status === "in_progress" ? "bg-primary animate-pulse" : "bg-muted-foreground/30"}`} />
                    <div>
                      <span className="font-mono font-semibold">Viaje #{t.trip_number}</span>
                      <span className="text-muted-foreground ml-2">{t.origin_branch?.code}</span>
                      {t.vehicle && <span className="text-muted-foreground ml-2">{(t.vehicle as any).plate_number}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs"><MapPin className="h-3 w-3 mr-1" /> {stops.length} paradas</Badge>
                    <Badge variant={t.status === "in_progress" ? "default" : "outline"} className="text-xs">
                      {t.status === "in_progress" ? "En curso" : "Planificado"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="en-curso" className="gap-2 text-xs"><Package className="h-3.5 w-3.5" /> En curso</TabsTrigger>
          <TabsTrigger value="entregadas" className="gap-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Entregadas</TabsTrigger>
          <TabsTrigger value="excepciones" className="gap-2 text-xs">
            <Timer className="h-3.5 w-3.5" /> Excepciones
            {exceptionsCount > 0 && <Badge variant="destructive" className="text-[10px] h-4 px-1 ml-1">{exceptionsCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando...</div>
              ) : !fulfillments?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Sin entregas mayoristas en esta bandeja</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {/* Escalated section header when on exceptions tab */}
                  {tab === "excepciones" && escalatedCount > 0 && (
                    <div className="p-3 bg-destructive/5 border-b border-destructive/20">
                      <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Excepciones comerciales pendientes de intervención ({escalatedCount})
                      </p>
                    </div>
                  )}
                  {/* Sort: escalated first, then pending_commercial, then resolved */}
                  {[...fulfillments].sort((a: any, b: any) => {
                    const order: Record<string, number> = { escalated: 0, pending_commercial: 1, resolved: 2 };
                    return (order[a.commercial_exception_status] ?? 1) - (order[b.commercial_exception_status] ?? 1);
                  }).map((f: any) => {
                    const statusCfg = FULFILLMENT_STATUS_CONFIG[f.status] || FULFILLMENT_STATUS_CONFIG.pending;
                    const clientName = f.destination_client_name || (f.branch_request as any)?.client_name || "—";
                    const clientAddr = f.destination_client_address || (f.branch_request as any)?.client_address || "";
                    const exceptionAge = getExceptionAge(f.commercial_exception_at);
                    const timerColor = getTimerColor(exceptionAge);
                    const isActive = f.commercial_exception_status === "pending_commercial" || f.commercial_exception_status === "escalated";
                    const isEscalated = f.commercial_exception_status === "escalated";

                    return (
                      <div key={f.id} className={`p-4 hover:bg-muted/20 transition-colors ${isEscalated ? "bg-destructive/5 border-l-2 border-destructive" : isActive ? "bg-secondary/5" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-semibold text-sm">{clientName}</span>
                              {(f.branch_request as any)?.request_number && (
                                <span className="text-xs text-muted-foreground font-mono">Ped. #{(f.branch_request as any).request_number}</span>
                              )}
                              {isActive && exceptionAge !== null && (
                                <Badge className={`text-xs gap-1 ${exceptionAge >= 24 ? "bg-destructive/20 text-destructive font-bold" : exceptionAge >= 5 ? "bg-destructive/10 text-destructive" : exceptionAge >= 3 ? "bg-secondary/10 text-secondary" : "bg-muted"}`}>
                                  <Timer className="h-3 w-3" /> {Math.floor(exceptionAge)}h — {isEscalated ? "ESCALADA" : "Comercial"}
                                </Badge>
                              )}
                              {f.commercial_exception_status === "resolved" && (
                                <Badge className="bg-accent/10 text-accent text-xs gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> {COMMERCIAL_RESOLUTION_TYPES[f.commercial_resolution_type] || "Resuelta"}
                                </Badge>
                              )}
                            </div>
                            {clientAddr && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {clientAddr}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              <span>{f.source_branch?.code} → {f.destination_branch?.code || "Cliente"}</span>
                              <span>{SHIPPING_METHOD_LABELS[f.shipping_method] || f.shipping_method}</span>
                              {f.package_count > 0 && <span>{f.package_count} bultos</span>}
                              {(f.trip as any)?.trip_number && <span className="font-mono">Viaje #{(f.trip as any).trip_number}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge>
                            {/* Commercial actions */}
                            {["dispatched", "in_transit", "delivered"].includes(f.status) && !f.commercial_exception_status && (
                              <Button variant="ghost" size="sm" className="h-6 text-xs text-secondary" onClick={() => markException(f.id)}>
                                <AlertTriangle className="h-3 w-3 mr-1" /> Excepción
                              </Button>
                            )}
                            {isActive && (
                              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setExceptionId(f.id)}>
                                Resolver
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
      </Tabs>

      {/* Exception resolution dialog */}
      <Dialog open={!!exceptionId} onOpenChange={(o) => !o && setExceptionId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-display">Resolver Excepción Comercial</DialogTitle></DialogHeader>
          {currentException && (
            <ExceptionResolutionForm
              fulfillment={currentException}
              onResolve={(type, notes) => resolveException(exceptionId!, type, notes)}
            />
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function ExceptionResolutionForm({ fulfillment, onResolve }: { fulfillment: any; onResolve: (type: string, notes: string) => void }) {
  const [resType, setResType] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const clientName = fulfillment.destination_client_name || (fulfillment.branch_request as any)?.client_name || "—";
  const exceptionAge = fulfillment.commercial_exception_at
    ? Math.floor((Date.now() - new Date(fulfillment.commercial_exception_at).getTime()) / (1000 * 60 * 60))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resType) { toast.error("Seleccioná tipo de resolución"); return; }
    setSubmitting(true);
    await onResolve(resType, notes);
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-3 rounded-lg bg-muted/30 text-sm">
        <p className="font-semibold">{clientName}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Excepción activa hace {exceptionAge}h
          {exceptionAge >= 5 && <span className="text-destructive font-semibold ml-1">— URGENTE</span>}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Resolución *</Label>
        <Select value={resType} onValueChange={setResType}>
          <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
          <SelectContent>
            {Object.entries(COMMERCIAL_RESOLUTION_TYPES).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Detalle de la resolución..." />
      </div>

      <div className="p-2 rounded bg-info/5 text-xs text-muted-foreground">
        Esta resolución queda bajo responsabilidad comercial. Solo se escala a logística/admin si vence el timer.
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Resolviendo..." : "Confirmar resolución"}
      </Button>
    </form>
  );
}
