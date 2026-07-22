import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Pencil, Receipt } from "lucide-react";
import { toast } from "sonner";
import { FineForm } from "./FineForm";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-secondary/10 text-secondary" },
  paid: { label: "Pagada", color: "bg-accent/10 text-accent" },
  appealed: { label: "Apelada", color: "bg-primary/10 text-primary" },
  cancelled: { label: "Anulada", color: "bg-muted text-muted-foreground" },
};

export function FinesList({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [filterVehicle, setFilterVehicle] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-min"],
    queryFn: async () => {
      const { data } = await supabase.from("vehicles").select("id, plate").eq("is_active", true).order("plate");
      return data ?? [];
    },
  });

  const { data: fines } = useQuery({
    queryKey: ["vehicle-fines", filterVehicle, filterStatus],
    queryFn: async () => {
      let q = supabase
        .from("vehicle_fines")
        .select(`
          *,
          vehicle:vehicles(plate, nickname),
          driver:drivers(profile:profiles!drivers_user_id_fkey(full_name))
        `)
        .order("issued_at", { ascending: false })
        .limit(100);
      if (filterVehicle) q = q.eq("vehicle_id", filterVehicle);
      if (filterStatus) q = q.eq("status", filterStatus as any);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("vehicle_fines")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Multa marcada como pagada");
      qc.invalidateQueries({ queryKey: ["vehicle-fines"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPending = (fines ?? [])
    .filter((f: any) => f.status === "pending")
    .reduce((s: number, f: any) => s + Number(f.amount || 0), 0);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filterVehicle || "__all"} onValueChange={(v) => setFilterVehicle(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Vehículo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos</SelectItem>
            {vehicles?.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus || "__all"} onValueChange={(v) => setFilterStatus(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos los estados</SelectItem>
            <SelectItem value="pending">Pendiente</SelectItem>
            <SelectItem value="paid">Pagada</SelectItem>
            <SelectItem value="appealed">Apelada</SelectItem>
            <SelectItem value="cancelled">Anulada</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Pendiente: <span className="font-semibold text-destructive">₲ {totalPending.toLocaleString("de-DE")}</span></span>
          {canEdit && (
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2">
              <Receipt className="h-4 w-4" /> Nueva multa
            </Button>
          )}
        </div>
      </div>

      <Card className="glass-card"><CardContent className="p-0">
        {!fines?.length ? (
          <div className="p-8 text-center text-muted-foreground">Sin multas registradas</div>
        ) : (
          <div className="divide-y divide-border/50">
            {fines.map((f: any) => {
              const cfg = STATUS_LABELS[f.status] || STATUS_LABELS.pending;
              const overdue = f.status === "pending" && f.due_date && f.due_date < today;
              return (
                <div key={f.id} className={`p-4 ${overdue ? "bg-destructive/5" : ""}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-sm">{f.vehicle?.plate}</span>
                        <Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                        {overdue && (
                          <Badge variant="destructive" className="text-xs gap-1">
                            <AlertTriangle className="h-3 w-3" /> Vencida
                          </Badge>
                        )}
                        {f.fine_number && <span className="text-xs text-muted-foreground">#{f.fine_number}</span>}
                      </div>
                      <p className="text-sm mt-0.5">{f.infraction_type}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(f.issued_at).toLocaleString("es-PY")}
                        {f.location && ` · ${f.location}`}
                        {f.driver?.profile?.full_name && ` · ${f.driver.profile.full_name}`}
                      </p>
                      {f.due_date && <p className="text-xs text-muted-foreground">Vence: {new Date(f.due_date).toLocaleDateString("es-PY")}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="font-semibold">₲ {Number(f.amount).toLocaleString("de-DE")}</span>
                      <div className="flex gap-1">
                        {f.status === "pending" && canEdit && (
                          <Button size="sm" variant="outline" onClick={() => markPaid.mutate(f.id)} disabled={markPaid.isPending}>
                            Pagar
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="icon" variant="ghost" onClick={() => { setEditing(f); setFormOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent></Card>

      {formOpen && <FineForm open={formOpen} onOpenChange={setFormOpen} initial={editing} />}
    </div>
  );
}
