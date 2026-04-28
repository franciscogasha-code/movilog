import { categoryForTripEvent } from "@/lib/event-categories";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { PackageCheck, Clock, AlertTriangle, Search, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { branchName } from "@/lib/branch-format";

export default function Recepcion() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  // Pending physical confirmation + dispatched/in_transit/delivered
  const { data: pending, isLoading } = useQuery({
    queryKey: ["pending-reception"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target)
        `)
        .in("status", ["delivered", "dispatched", "in_transit", "pending_physical_confirmation"] as any[])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Recently received (last 7 days)
  const { data: received } = useQuery({
    queryKey: ["recent-received"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type)
        `)
        .eq("status", "received" as any)
        .gte("received_at_branch", since)
        .order("received_at_branch", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  // Driver marks drop → pending_physical_confirmation (not received)
  const markDriverDrop = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciá sesión"); return; }

      const { error } = await supabase
        .from("fulfillment_orders")
        .update({
          status: "pending_physical_confirmation" as any,
        } as any)
        .eq("id", fulfillmentId);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_delivery_drop",
        category: categoryForTripEvent("driver_delivery_drop"),
        event_description: "Chofer descargó mercadería — pendiente confirmación física de sucursal",
        new_status: "pending_physical_confirmation",
        triggered_by: user.id,
        expected_next_event: "branch_physical_confirmation",
      });

      toast.success("Descarga registrada — pendiente confirmación física de sucursal");
      queryClient.invalidateQueries({ queryKey: ["pending-reception"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Branch confirms physical reception (suggested, not mandatory)
  const confirmReception = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciá sesión"); return; }

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("fulfillment_orders")
        .update({
          status: "received" as any,
          received_at: now,
          received_by: user.id,
          received_at_branch: now,
          received_by_branch: user.id,
        } as any)
        .eq("id", fulfillmentId);
      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "branch_reception_confirmed",
        category: categoryForTripEvent("branch_reception_confirmed"),
        event_description: "Sucursal confirmó recepción física",
        new_status: "received",
        triggered_by: user.id,
        expected_next_event: "bims_confirmation",
        expected_next_event_deadline: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });

      toast.success("Recepción confirmada — inicia plazo 48h para BIMS");
      queryClient.invalidateQueries({ queryKey: ["pending-reception"] });
      queryClient.invalidateQueries({ queryKey: ["recent-received"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const getBimsCountdown = (deadline: string | null) => {
    if (!deadline) return null;
    const remaining = new Date(deadline).getTime() - Date.now();
    if (remaining <= 0) return { text: "Vencido", overdue: true };
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    return { text: `${hours}h ${mins}m`, overdue: false };
  };

  const pendingDropCount = pending?.filter(f => ["dispatched", "in_transit", "delivered"].includes(f.status)).length || 0;
  const pendingConfirmCount = pending?.filter(f => f.status === "pending_physical_confirmation").length || 0;
  const bimsOverdueCount = received?.filter((f: any) => {
    const cd = getBimsCountdown(f.bims_confirmation_deadline);
    return cd?.overdue && !f.bims_transfer_verified;
  }).length || 0;

  const filtered = pending?.filter((f: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return f.branch_request?.request_number?.toString().includes(term) ||
      branchName(f.source_branch).toLowerCase().includes(term) ||
      branchName(f.destination_branch).toLowerCase().includes(term);
  });

  // Separate by state
  const pendingPhysical = filtered?.filter(f => f.status === "pending_physical_confirmation") || [];
  const inTransitOrDelivered = filtered?.filter(f => ["dispatched", "in_transit", "delivered"].includes(f.status)) || [];

  // Filtro rápido por sub-estado
  const [quickFilter, setQuickFilter] = useState<"all" | "to_confirm" | "in_transit">("all");

  const visiblePendingPhysical = quickFilter === "in_transit" ? [] : pendingPhysical;
  const visibleInTransit = quickFilter === "to_confirm" ? [] : inTransitOrDelivered;

  const renderBimsBadges = (f: any) => (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      {f.bims_transfer_number && <span className="text-primary font-medium">T: {f.bims_transfer_number}</span>}
      {f.bims_invoice_number && <span className="text-primary font-medium">F: {f.bims_invoice_number}</span>}
      {!f.bims_transfer_number && !f.bims_invoice_number && (
        <Badge variant="outline" className="text-[10px] text-secondary">Sin doc.</Badge>
      )}
    </span>
  );

  return (
    <motion.div className="space-y-4 sm:space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="page-title">Recepción en Sucursal</h1>
        <p className="page-subtitle mt-1">Confirmación física sugerida y control de plazo BIMS 48h</p>
      </div>

      {/* Info banner colapsable */}
      <details className="group rounded-lg bg-muted/30 border border-border/50">
        <summary className="cursor-pointer list-none flex items-start gap-2 p-3">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <span className="text-xs text-muted-foreground flex-1">
            ¿Cómo funciona la recepción? <span className="text-primary group-open:hidden">Ver más</span><span className="text-primary hidden group-open:inline">Ocultar</span>
          </span>
        </summary>
        <p className="text-xs text-muted-foreground px-3 pb-3 pl-9 leading-relaxed">
          La confirmación en MoviLog es <strong>sugerida</strong>, no obligatoria. Si BIMS ya muestra la recepción confirmada, la recepción logística se cierra automáticamente.
        </p>
      </details>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
        <Card className="glass-card">
          <CardContent className="p-3 sm:p-5 flex items-center gap-3">
            <div className="bg-warning/10 p-2 sm:p-3 rounded-xl shrink-0"><PackageCheck className="h-4 w-4 sm:h-5 sm:w-5 text-warning" /></div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">Pend. confirm.</p>
              <p className="text-xl sm:text-2xl font-display font-bold">{pendingConfirmCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 sm:p-5 flex items-center gap-3">
            <div className="bg-primary/10 p-2 sm:p-3 rounded-xl shrink-0"><PackageCheck className="h-4 w-4 sm:h-5 sm:w-5 text-primary" /></div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">En tránsito</p>
              <p className="text-xl sm:text-2xl font-display font-bold">{pendingDropCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card col-span-2 sm:col-span-1">
          <CardContent className="p-3 sm:p-5 flex items-center gap-3">
            <div className={`${bimsOverdueCount > 0 ? "bg-destructive/10" : "bg-muted"} p-2 sm:p-3 rounded-xl shrink-0`}>
              <AlertTriangle className={`h-4 w-4 sm:h-5 sm:w-5 ${bimsOverdueCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs text-muted-foreground uppercase">BIMS vencido</p>
              <p className="text-xl sm:text-2xl font-display font-bold">{bimsOverdueCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Buscador + filtros rápidos */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por # o sucursal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 sm:h-10"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          {([
            { key: "all", label: "Todos", count: pendingPhysical.length + inTransitOrDelivered.length },
            { key: "to_confirm", label: "A confirmar", count: pendingPhysical.length },
            { key: "in_transit", label: "En tránsito", count: inTransitOrDelivered.length },
          ] as const).map((f) => {
            const active = quickFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setQuickFilter(f.key)}
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {f.label}
                <span className={`text-[10px] ${active ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pending physical confirmation - prioridad alta */}
      {visiblePendingPhysical.length > 0 && (
        <Card className="glass-card border-warning/30">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" /> Pendiente de confirmación física
              <Badge variant="warning" className="text-[10px] ml-auto">{visiblePendingPhysical.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* MOBILE: cards */}
            <div className="md:hidden divide-y divide-border/50">
              {visiblePendingPhysical.map((f: any) => (
                <div key={f.id} className="p-3 bg-warning/5 border-l-4 border-l-warning">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-mono font-semibold text-sm">#{f.branch_request?.request_number || "—"}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {f.dispatched_at ? new Date(f.dispatched_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80 mb-2">
                    <span className="text-muted-foreground">De:</span> {branchName(f.source_branch)}
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="text-muted-foreground">Para:</span> {f.destination_client_name || branchName(f.destination_branch)}
                  </p>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {renderBimsBadges(f)}
                    <Button size="sm" onClick={() => confirmReception(f.id)} className="h-8 text-xs gap-1">
                      <PackageCheck className="h-3.5 w-3.5" /> Confirmar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {/* DESKTOP: tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Pedido</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Destino</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">BIMS</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Descargado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePendingPhysical.map((f: any) => (
                    <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors bg-warning/5">
                      <td className="p-3 font-mono font-semibold">#{f.branch_request?.request_number || "—"}</td>
                      <td className="p-3">{branchName(f.source_branch)}</td>
                      <td className="p-3">{f.destination_client_name || branchName(f.destination_branch)}</td>
                      <td className="p-3">{renderBimsBadges(f)}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {f.dispatched_at ? new Date(f.dispatched_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="p-3">
                        <Button size="sm" onClick={() => confirmReception(f.id)} className="h-7 text-xs gap-1">
                          <PackageCheck className="h-3 w-3" /> Confirmar recepción
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* En tránsito / entregado */}
      {quickFilter !== "to_confirm" && (
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
            Cargas en camino
            {visibleInTransit.length > 0 && <Badge variant="muted" className="text-[10px] ml-auto">{visibleInTransit.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !visibleInTransit.length ? (
            <div className="p-6">
              <div className="empty-state">
                <PackageCheck className="h-8 w-8 mb-2 opacity-50" />
                <p className="font-medium">No hay cargas en tránsito</p>
                <p className="text-xs text-muted-foreground mt-1">Todo recibido por ahora.</p>
              </div>
            </div>
          ) : (
            <>
              {/* MOBILE: cards */}
              <div className="md:hidden divide-y divide-border/50">
                {visibleInTransit.map((f: any) => (
                  <div key={f.id} className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-semibold text-sm">#{f.branch_request?.request_number || "—"}</span>
                        <StatusBadge status={f.status} config={FULFILLMENT_STATUS_CONFIG} className="shrink-0" />
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {f.dispatched_at ? new Date(f.dispatched_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/80 mb-2">
                      <span className="text-muted-foreground">De:</span> {branchName(f.source_branch)}
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-muted-foreground">Para:</span> {f.destination_client_name || branchName(f.destination_branch)}
                    </p>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      {renderBimsBadges(f)}
                      {f.status === "delivered" && (
                        <Button size="sm" variant="outline" onClick={() => markDriverDrop(f.id)} className="h-8 text-xs gap-1">
                          Marcar descarga
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* DESKTOP: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Pedido</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Destino</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">BIMS</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Despachado</th>
                      <th className="text-left p-3 font-medium text-muted-foreground"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInTransit.map((f: any) => (
                      <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-3 font-mono font-semibold">#{f.branch_request?.request_number || "—"}</td>
                        <td className="p-3">{branchName(f.source_branch)}</td>
                        <td className="p-3">{f.destination_client_name || branchName(f.destination_branch)}</td>
                        <td className="p-3">{renderBimsBadges(f)}</td>
                        <td className="p-3"><StatusBadge status={f.status} config={FULFILLMENT_STATUS_CONFIG} /></td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {f.dispatched_at ? new Date(f.dispatched_at).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="p-3">
                          {f.status === "delivered" && (
                            <Button size="sm" variant="outline" onClick={() => markDriverDrop(f.id)} className="h-7 text-xs gap-1">
                              Marcar descarga
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      )}

      {/* Recently received with BIMS countdown */}
      {received && received.length > 0 && quickFilter === "all" && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base sm:text-lg flex items-center gap-2">
              <Clock className="h-4 w-4" /> Recibidos — Control BIMS 48h
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* MOBILE: cards compactas */}
            <div className="md:hidden divide-y divide-border/50">
              {received.map((f: any) => {
                const countdown = getBimsCountdown(f.bims_confirmation_deadline);
                const isOverdue = countdown?.overdue && !f.bims_transfer_verified;
                return (
                  <div key={f.id} className={`p-3 ${isOverdue ? "bg-destructive/5 border-l-4 border-l-destructive" : ""}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-semibold text-sm">#{f.branch_request?.request_number || "—"}</span>
                      {countdown ? (
                        <Badge variant={countdown.overdue ? "destructive" : "outline"} className="text-[10px] gap-1">
                          <Clock className="h-3 w-3" /> {countdown.text}
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">
                      <span>De: {branchName(f.source_branch)}</span>
                      {f.received_at_branch && <span> · {new Date(f.received_at_branch).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                    </p>
                    <div className="text-xs">
                      {f.bims_transfer_verified ? (
                        <Badge className="bg-accent/10 text-accent text-[10px] gap-1"><CheckCircle2 className="h-3 w-3" /> Confirmado</Badge>
                      ) : f.bims_transfer_number ? (
                        <span className="text-primary font-medium">T: {f.bims_transfer_number}</span>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-secondary">Pendiente</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* DESKTOP: tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Pedido</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Recibido</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">BIMS</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Plazo restante</th>
                  </tr>
                </thead>
                <tbody>
                  {received.map((f: any) => {
                    const countdown = getBimsCountdown(f.bims_confirmation_deadline);
                    return (
                      <tr key={f.id} className={`border-b border-border/50 transition-colors ${countdown?.overdue && !f.bims_transfer_verified ? "bg-destructive/5" : "hover:bg-muted/20"}`}>
                        <td className="p-3 font-mono font-semibold">#{f.branch_request?.request_number || "—"}</td>
                        <td className="p-3">{branchName(f.source_branch)}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {f.received_at_branch ? new Date(f.received_at_branch).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="p-3 text-xs">
                          {f.bims_transfer_verified ? (
                            <Badge className="bg-accent/10 text-accent text-xs gap-1"><CheckCircle2 className="h-3 w-3" /> Confirmado</Badge>
                          ) : f.bims_transfer_number ? (
                            <span className="text-primary font-medium">T: {f.bims_transfer_number}</span>
                          ) : (
                            <Badge variant="outline" className="text-xs text-secondary">Pendiente</Badge>
                          )}
                        </td>
                        <td className="p-3">
                          {countdown ? (
                            <Badge variant={countdown.overdue ? "destructive" : "outline"} className="text-xs gap-1">
                              <Clock className="h-3 w-3" /> {countdown.text}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
