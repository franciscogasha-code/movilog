import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { INCIDENT_STATUS_CONFIG, DETECTION_CONTEXT_LABELS, DAMAGE_CAUSE_LABELS, STOCK_DISPOSITION_LABELS } from "@/lib/constants";
import { AlertTriangle, ShieldAlert, Search as SearchIcon, Plus, Calendar, Gavel } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrearIncidencia } from "@/components/incidencias/CrearIncidencia";
import { toast } from "sonner";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { branchName } from "@/lib/branch-format";

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  damaged: "Producto averiado",
  missing: "Faltante",
  surplus: "Sobrante",
  stock_difference: "Diferencia de stock",
  wrong_product: "Producto incorrecto",
  other: "Otro",
};

const ADMIN_DISPOSITIONS: Record<string, string> = {
  send_to_admin_stock: "Enviar a stock administración",
  sell_discounted: "Venta rebajada en sucursal",
  assign_responsibility: "Asignar responsabilidad a colaborador",
  bims_adjustment: "Ajuste de inventario en BIMS",
  supplier_claim: "Reclamo a proveedor",
  loss_absorbed: "Pérdida absorbida por empresa",
};

export default function Incidencias() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ["logistics-incidents", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("logistics_incidents")
        .select(`
          *,
          branch:branches!logistics_incidents_branch_id_fkey(name, code),
          product:products(name, sku)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.in("branch_id", allowedBranchIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const openCount = incidents?.filter((i) => i.status === "open").length || 0;
  const underReviewCount = incidents?.filter((i) => i.status === "under_review").length || 0;
  const pendingAdminCount = incidents?.filter((i: any) => i.pending_shipment_to_admin && !["closed", "resolved"].includes(i.status)).length || 0;

  const filtered = incidents?.filter((i: any) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return i.title.toLowerCase().includes(term) || i.branch?.name?.toLowerCase().includes(term) || i.product?.name?.toLowerCase().includes(term);
  });

  const currentIncident = incidents?.find(i => i.id === decisionId);

  const submitDecision = async (disposition: string, notes: string) => {
    if (!decisionId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const updatePayload: any = {
        admin_disposition: disposition,
        admin_disposition_notes: notes || null,
        admin_decision_by: user.id,
        admin_decision_at: new Date().toISOString(),
        status: "under_review", // Decision taken, pending execution
      };

      // If disposition closes the incident directly
      if (["loss_absorbed", "bims_adjustment"].includes(disposition)) {
        updatePayload.status = "resolved";
        updatePayload.resolved_at = new Date().toISOString();
        updatePayload.resolved_by = user.id;
        updatePayload.resolution = `Decisión admin: ${ADMIN_DISPOSITIONS[disposition]}. ${notes || ""}`;
      }

      if (disposition === "send_to_admin_stock") {
        updatePayload.pending_shipment_to_admin = true;
      }

      const { error } = await supabase.from("logistics_incidents").update(updatePayload).eq("id", decisionId);
      if (error) throw error;

      toast.success("Decisión administrativa registrada");
      queryClient.invalidateQueries({ queryKey: ["logistics-incidents"] });
      setDecisionId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const closeIncident = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("logistics_incidents").update({
        status: "closed",
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      }).eq("id", id);
      if (error) throw error;
      toast.success("Incidencia cerrada");
      queryClient.invalidateQueries({ queryKey: ["logistics-incidents"] });
    } catch (err: any) { toast.error(err.message); }
  };

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

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-destructive/10 p-3 rounded-xl"><ShieldAlert className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Abiertas</p><p className="text-2xl font-display font-bold">{openCount}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-info/10 p-3 rounded-xl"><Gavel className="h-5 w-5 text-info" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">En decisión</p><p className="text-2xl font-display font-bold">{underReviewCount}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-warning/10 p-3 rounded-xl"><AlertTriangle className="h-5 w-5 text-warning" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Pend. envío admin</p><p className="text-2xl font-display font-bold">{pendingAdminCount}</p></div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-secondary/10 p-3 rounded-xl"><Calendar className="h-5 w-5 text-secondary" /></div>
            <div><p className="text-xs text-muted-foreground uppercase">Total registradas</p><p className="text-2xl font-display font-bold">{incidents?.length || 0}</p></div>
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
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Decisión</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Flags</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i: any) => (
                    <tr key={i.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${i.pending_shipment_to_admin ? "bg-warning/5" : ""}`}>
                      <td className="p-3 font-medium max-w-[180px] truncate">{i.title}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs">{INCIDENT_TYPE_LABELS[i.incident_type] || i.incident_type}</Badge>
                      </td>
                      <td className="p-3">{branchName(i.branch)}</td>
                      <td className="p-3 text-muted-foreground">{i.product?.name || "—"}</td>
                      <td className="p-3"><StatusBadge status={i.status} config={INCIDENT_STATUS_CONFIG} /></td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {i.admin_disposition ? (
                          <Badge variant="outline" className="text-xs">{ADMIN_DISPOSITIONS[i.admin_disposition] || i.admin_disposition}</Badge>
                        ) : "—"}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1 flex-wrap">
                          {i.pending_shipment_to_admin && !["closed", "resolved"].includes(i.status) && (
                            <Badge variant="outline" className="text-xs text-warning border-warning/30">Pend. envío</Badge>
                          )}
                          {!i.pending_shipment_to_admin && ["resolved", "closed"].includes(i.status) && (
                            <Badge variant="outline" className="text-xs text-accent border-accent/30">Local</Badge>
                          )}
                          {i.pending_shipment_to_admin && ["resolved", "closed"].includes(i.status) && (
                            <Badge variant="outline" className="text-xs text-primary border-primary/30">Enviado</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          {["open", "under_review"].includes(i.status) && !i.admin_disposition && (
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setDecisionId(i.id)}>
                              <Gavel className="h-3 w-3" /> Decidir
                            </Button>
                          )}
                          {i.status === "under_review" && i.admin_disposition && (
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => closeIncident(i.id)}>
                              Cerrar
                            </Button>
                          )}
                          {i.status === "resolved" && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => closeIncident(i.id)}>
                              Archivar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva Incidencia</DialogTitle></DialogHeader>
          <CrearIncidencia onSuccess={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["logistics-incidents"] }); }} />
        </DialogContent>
      </Dialog>

      {/* Admin Decision dialog */}
      <Dialog open={!!decisionId} onOpenChange={(o) => !o && setDecisionId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Decisión Administrativa</DialogTitle>
          </DialogHeader>
          {currentIncident && (
            <AdminDecisionForm
              incident={currentIncident}
              onSubmit={submitDecision}
            />
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function AdminDecisionForm({ incident, onSubmit }: { incident: any; onSubmit: (disposition: string, notes: string) => void }) {
  const [disposition, setDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposition) { toast.error("Seleccioná una decisión"); return; }
    setSubmitting(true);
    await onSubmit(disposition, notes);
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-3 rounded-lg bg-muted/30 text-sm">
        <p className="font-semibold">{incident.title}</p>
        <p className="text-muted-foreground text-xs mt-1">{incident.description}</p>
        {incident.product && <p className="text-xs text-muted-foreground mt-1">Producto: {incident.product.name}</p>}
        {incident.quantity_affected && <p className="text-xs text-muted-foreground">Cantidad: {incident.quantity_affected}</p>}
      </div>

      <div className="space-y-2">
        <Label>Decisión administrativa *</Label>
        <Select value={disposition} onValueChange={setDisposition}>
          <SelectTrigger><SelectValue placeholder="Seleccionar decisión..." /></SelectTrigger>
          <SelectContent>
            {Object.entries(ADMIN_DISPOSITIONS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {disposition === "assign_responsibility" && (
        <div className="p-2 rounded bg-secondary/10 text-xs text-secondary">
          La asignación de responsabilidad se gestiona con el campo "responsable" en la incidencia
        </div>
      )}

      <div className="space-y-2">
        <Label>Notas de la decisión</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Instrucciones o justificación..." />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Registrando..." : "Registrar decisión"}
      </Button>
    </form>
  );
}
