import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: any;
}

const MAINT_TYPES = [
  "Aceite y filtros",
  "Frenos",
  "Neumáticos",
  "Correa distribución",
  "Suspensión",
  "Batería",
  "Diagnóstico general",
  "Otro",
];

export function MaintenanceForm({ open, onOpenChange, initial }: Props) {
  const qc = useQueryClient();
  const editing = !!initial?.id;

  const [form, setForm] = useState({
    vehicle_id: initial?.vehicle_id ?? "",
    maintenance_type: initial?.maintenance_type ?? MAINT_TYPES[0],
    description: initial?.description ?? "",
    scheduled_date: initial?.scheduled_date ?? "",
    scheduled_km: initial?.scheduled_km ?? "",
    provider: initial?.provider ?? "",
    cost: initial?.cost ?? "",
    mileage_at_service: initial?.mileage_at_service ?? "",
    completed_date: initial?.completed_date ?? "",
    status: initial?.status ?? "scheduled",
    alert_km_threshold: initial?.alert_km_threshold ?? 500,
    alert_days_threshold: initial?.alert_days_threshold ?? 7,
    recurrence_km: initial?.recurrence_km ?? "",
    recurrence_days: initial?.recurrence_days ?? "",
    notes: initial?.notes ?? "",
  });

  useEffect(() => {
    if (open && initial) setForm((f) => ({ ...f, ...initial }));
  }, [open, initial]);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, plate, nickname").eq("is_active", true).order("plate");
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!form.vehicle_id) throw new Error("Elegí un vehículo");
      if (!form.description) throw new Error("Ingresá una descripción");
      if (!form.scheduled_date && !form.scheduled_km) {
        throw new Error("Definí fecha o kilometraje programado");
      }
      const payload: any = {
        vehicle_id: form.vehicle_id,
        maintenance_type: form.maintenance_type,
        description: form.description,
        scheduled_date: form.scheduled_date || null,
        scheduled_km: form.scheduled_km ? Number(form.scheduled_km) : null,
        provider: form.provider || null,
        cost: form.cost ? Number(form.cost) : null,
        mileage_at_service: form.mileage_at_service ? Number(form.mileage_at_service) : null,
        completed_date: form.completed_date || null,
        status: form.status,
        alert_km_threshold: Number(form.alert_km_threshold) || 500,
        alert_days_threshold: Number(form.alert_days_threshold) || 7,
        recurrence_km: form.recurrence_km ? Number(form.recurrence_km) : null,
        recurrence_days: form.recurrence_days ? Number(form.recurrence_days) : null,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("vehicle_maintenance").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicle_maintenance").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Mantenimiento actualizado" : "Mantenimiento registrado");
      qc.invalidateQueries({ queryKey: ["vehicle-maintenance"] });
      qc.invalidateQueries({ queryKey: ["maintenance-alerts"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar mantenimiento" : "Nuevo mantenimiento"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Vehículo *</Label>
            <Select value={form.vehicle_id} onValueChange={(v) => setForm({ ...form, vehicle_id: v })}>
              <SelectTrigger><SelectValue placeholder="Elegí un vehículo" /></SelectTrigger>
              <SelectContent>
                {vehicles?.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `— ${v.nickname}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo *</Label>
            <Select value={form.maintenance_type} onValueChange={(v) => setForm({ ...form, maintenance_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAINT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">Programado</SelectItem>
                <SelectItem value="in_progress">En curso</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Descripción *</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>Fecha programada</Label>
            <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
          </div>
          <div>
            <Label>Km programado</Label>
            <Input type="number" value={form.scheduled_km} onChange={(e) => setForm({ ...form, scheduled_km: e.target.value })} />
          </div>
          <div>
            <Label>Umbral alerta (km)</Label>
            <Input type="number" value={form.alert_km_threshold} onChange={(e) => setForm({ ...form, alert_km_threshold: e.target.value })} />
          </div>
          <div>
            <Label>Umbral alerta (días)</Label>
            <Input type="number" value={form.alert_days_threshold} onChange={(e) => setForm({ ...form, alert_days_threshold: e.target.value })} />
          </div>
          <div>
            <Label>Recurrencia (km)</Label>
            <Input type="number" placeholder="Opcional" value={form.recurrence_km} onChange={(e) => setForm({ ...form, recurrence_km: e.target.value })} />
          </div>
          <div>
            <Label>Recurrencia (días)</Label>
            <Input type="number" placeholder="Opcional" value={form.recurrence_days} onChange={(e) => setForm({ ...form, recurrence_days: e.target.value })} />
          </div>
          <div>
            <Label>Taller / proveedor</Label>
            <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
          </div>
          <div>
            <Label>Costo (₲)</Label>
            <Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </div>
          {form.status === "completed" && (
            <>
              <div>
                <Label>Fecha completado</Label>
                <Input type="date" value={form.completed_date} onChange={(e) => setForm({ ...form, completed_date: e.target.value })} />
              </div>
              <div>
                <Label>Km al servicio</Label>
                <Input type="number" value={form.mileage_at_service} onChange={(e) => setForm({ ...form, mileage_at_service: e.target.value })} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Label>Notas</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
