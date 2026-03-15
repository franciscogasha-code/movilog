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
import { PackageCheck, Clock, AlertTriangle, Search, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function Recepcion() {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

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
        .in("status", ["delivered", "dispatched", "in_transit"])
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
        .eq("status", "received")
        .gte("received_at_branch", since)
        .order("received_at_branch", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

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
        category: "logistics" as any,
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

  const pendingCount = pending?.filter(f => f.status === "delivered").length || 0;
  const bimsOverdueCount = received?.filter((f: any) => {
    const cd = getBimsCountdown(f.bims_confirmation_deadline);
    return cd?.overdue && !f.bims_transfer_verified;
  }).length || 0;

  const filtered = pending?.filter((f: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return f.branch_request?.request_number?.toString().includes(term) ||
      f.source_branch?.code?.toLowerCase().includes(term) ||
      f.destination_branch?.code?.toLowerCase().includes(term);
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Recepción en Sucursal</h1>
        <p className="text-muted-foreground mt-1">Confirmación de recepción física y control de plazo BIMS 48h</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl"><PackageCheck className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Pendientes recepción</p>
              <p className="text-2xl font-display font-bold">{pendingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-xl"><CheckCircle2 className="h-5 w-5 text-accent" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Recibidos (7 días)</p>
              <p className="text-2xl font-display font-bold">{received?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`${bimsOverdueCount > 0 ? "bg-destructive/10" : "bg-muted"} p-3 rounded-xl`}>
              <AlertTriangle className={`h-5 w-5 ${bimsOverdueCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">BIMS vencido</p>
              <p className="text-2xl font-display font-bold">{bimsOverdueCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por pedido o sucursal..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Pending reception */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Cargas pendientes de recepción</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !filtered?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <PackageCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay cargas pendientes de recepción</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                  {filtered.map((f: any) => (
                    <tr key={f.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono font-semibold">#{f.branch_request?.request_number || "—"}</td>
                      <td className="p-3">{f.source_branch?.code}</td>
                      <td className="p-3">{f.destination_branch?.code || f.destination_client_name || "—"}</td>
                      <td className="p-3 text-xs">
                        {f.bims_transfer_number && <span className="text-primary font-medium">T: {f.bims_transfer_number}</span>}
                        {f.bims_invoice_number && <span className="text-primary font-medium ml-1">F: {f.bims_invoice_number}</span>}
                        {!f.bims_transfer_number && !f.bims_invoice_number && <Badge variant="outline" className="text-xs text-secondary">Sin doc.</Badge>}
                      </td>
                      <td className="p-3"><StatusBadge status={f.status} config={FULFILLMENT_STATUS_CONFIG} /></td>
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
          )}
        </CardContent>
      </Card>

      {/* Recently received with BIMS countdown */}
      {received && received.length > 0 && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Clock className="h-4 w-4" /> Recibidos — Control BIMS 48h
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
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
                        <td className="p-3">{f.source_branch?.code}</td>
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
