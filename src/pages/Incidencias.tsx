import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { INCIDENT_STATUS_CONFIG, DETECTION_CONTEXT_LABELS, DAMAGE_CAUSE_LABELS } from "@/lib/constants";
import { AlertTriangle, ShieldAlert, Search as SearchIcon, Plus, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrearIncidencia } from "@/components/incidencias/CrearIncidencia";

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  damaged: "Producto averiado",
  missing: "Faltante",
  surplus: "Sobrante",
  stock_difference: "Diferencia de stock",
  wrong_product: "Producto incorrecto",
  other: "Otro",
};

export default function Incidencias() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: incidents, isLoading } = useQuery({
    queryKey: ["logistics-incidents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("logistics_incidents")
        .select(`
          *,
          branch:branches!logistics_incidents_branch_id_fkey(name, code),
          product:products(name, sku)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const openCount = incidents?.filter((i) => i.status === "open").length || 0;
  const pendingAdminCount = incidents?.filter((i: any) => i.pending_shipment_to_admin && i.status !== "closed").length || 0;
  const reminderCount = incidents?.filter((i: any) => {
    if (i.status === "closed") return false;
    return i.pending_shipment_to_admin && !i.shipment_reminder_9th;
  }).length || 0;

  const filtered = incidents?.filter((i: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return i.title.toLowerCase().includes(term) || i.branch?.name?.toLowerCase().includes(term) || i.product?.name?.toLowerCase().includes(term);
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Incidencias Logísticas</h1>
          <p className="text-muted-foreground mt-1">Averiados, faltantes, sobrantes y diferencias de stock</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Nueva incidencia
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-destructive/10 p-3 rounded-xl"><ShieldAlert className="h-5 w-5 text-destructive" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Abiertas</p>
              <p className="text-2xl font-display font-bold">{openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-warning/10 p-3 rounded-xl"><AlertTriangle className="h-5 w-5 text-warning" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Pendientes envío admin</p>
              <p className="text-2xl font-display font-bold">{pendingAdminCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-secondary/10 p-3 rounded-xl"><Calendar className="h-5 w-5 text-secondary" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Recordatorios pendientes</p>
              <p className="text-2xl font-display font-bold">{reminderCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar incidencia..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !filtered?.length ? (
            <div className="p-8 text-center text-muted-foreground">No hay incidencias registradas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Título</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Sucursal</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Producto</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Cant.</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Detección</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Causa</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Flags</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => (
                    <tr key={i.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i.pending_shipment_to_admin ? "bg-warning/5" : ""}`}>
                      <td className="p-3 font-medium max-w-[200px] truncate">{i.title}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">
                          {INCIDENT_TYPE_LABELS[i.incident_type] || i.incident_type}
                        </Badge>
                      </td>
                      <td className="p-3">{i.branch?.code}</td>
                      <td className="p-3 text-muted-foreground">{i.product?.name || "—"}</td>
                      <td className="p-3 font-mono">{i.quantity_affected || "—"}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {DETECTION_CONTEXT_LABELS[i.detection_context] || "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {i.detection_context === "internal" && i.damage_cause
                          ? DAMAGE_CAUSE_LABELS[i.damage_cause]
                          : "—"}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={i.status} config={INCIDENT_STATUS_CONFIG} />
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap">
                          {i.pending_shipment_to_admin && i.status !== "closed" && i.status !== "resolved" && (
                            <Badge variant="outline" className="text-xs text-warning border-warning/30">Pend. envío admin</Badge>
                          )}
                          {!i.pending_shipment_to_admin && (i.status === "resolved" || i.status === "closed") && (
                            <Badge variant="outline" className="text-xs text-accent border-accent/30">Resuelto en sucursal</Badge>
                          )}
                          {i.pending_shipment_to_admin && (i.status === "resolved" || i.status === "closed") && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30">Enviado a admin</Badge>
                          )}
                          {i.shipment_reminder_9th && (
                            <Badge variant="outline" className="text-xs text-secondary">Rec. 9</Badge>
                          )}
                          {i.shipment_reminder_24th && (
                            <Badge variant="outline" className="text-xs text-secondary">Rec. 24</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(i.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva Incidencia</DialogTitle></DialogHeader>
          <CrearIncidencia onSuccess={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
