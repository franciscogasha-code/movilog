import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileUpload } from "@/components/shared/FileUpload";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: any;
}

export function FineForm({ open, onOpenChange, initial }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const editing = !!initial?.id;

  const [form, setForm] = useState({
    vehicle_id: initial?.vehicle_id ?? "",
    driver_id: initial?.driver_id ?? "",
    fine_number: initial?.fine_number ?? "",
    issued_at: initial?.issued_at ? initial.issued_at.slice(0, 16) : new Date().toISOString().slice(0, 16),
    location: initial?.location ?? "",
    infraction_type: initial?.infraction_type ?? "",
    amount: initial?.amount ?? "",
    due_date: initial?.due_date ?? "",
    status: initial?.status ?? "pending",
    paid_at: initial?.paid_at ? initial.paid_at.slice(0, 16) : "",
    receipt_photo_url: initial?.receipt_photo_url ?? "",
    notes: initial?.notes ?? "",
  });

  useEffect(() => {
    if (open && initial) {
      setForm((f) => ({
        ...f,
        ...initial,
        issued_at: initial.issued_at ? initial.issued_at.slice(0, 16) : f.issued_at,
        paid_at: initial.paid_at ? initial.paid_at.slice(0, 16) : "",
      }));
    }
  }, [open, initial]);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, plate, nickname").eq("is_active", true).order("plate");
      if (error) throw error;
      return data;
    },
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, user_id, profile:profiles!drivers_user_id_fkey(full_name)")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!form.vehicle_id) throw new Error("Elegí un vehículo");
      if (!form.infraction_type) throw new Error("Ingresá el tipo de infracción");
      if (!form.amount) throw new Error("Ingresá el monto");
      const payload: any = {
        vehicle_id: form.vehicle_id,
        driver_id: form.driver_id || null,
        fine_number: form.fine_number || null,
        issued_at: new Date(form.issued_at).toISOString(),
        location: form.location || null,
        infraction_type: form.infraction_type,
        amount: Number(form.amount),
        due_date: form.due_date || null,
        status: form.status,
        paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : null,
        paid_by: form.status === "paid" ? user?.id ?? null : null,
        receipt_photo_url: form.receipt_photo_url || null,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("vehicle_fines").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        payload.created_by = user?.id ?? null;
        const { error } = await supabase.from("vehicle_fines").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Multa actualizada" : "Multa registrada");
      qc.invalidateQueries({ queryKey: ["vehicle-fines"] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{editing ? "Editar multa" : "Nueva multa"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Vehículo *</Label>
            <Select value={form.vehicle_id} onValueChange={(v) => setForm({ ...form, vehicle_id: v })}>
              <SelectTrigger><SelectValue placeholder="Elegí un vehículo" /></SelectTrigger>
              <SelectContent>
                {vehicles?.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Chofer</Label>
            <Select value={form.driver_id || "__none"} onValueChange={(v) => setForm({ ...form, driver_id: v === "__none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— Sin asignar —</SelectItem>
                {drivers?.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.profile?.full_name || "Chofer"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nº de multa</Label>
            <Input value={form.fine_number} onChange={(e) => setForm({ ...form, fine_number: e.target.value })} />
          </div>
          <div>
            <Label>Fecha *</Label>
            <Input type="datetime-local" value={form.issued_at} onChange={(e) => setForm({ ...form, issued_at: e.target.value })} />
          </div>
          <div>
            <Label>Lugar</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <Label>Vencimiento</Label>
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label>Tipo de infracción *</Label>
            <Input value={form.infraction_type} onChange={(e) => setForm({ ...form, infraction_type: e.target.value })} placeholder="Ej: Exceso de velocidad" />
          </div>
          <div>
            <Label>Monto (₲) *</Label>
            <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <Label>Estado</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v, paid_at: v === "paid" && !form.paid_at ? new Date().toISOString().slice(0, 16) : form.paid_at })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="paid">Pagada</SelectItem>
                <SelectItem value="appealed">Apelada</SelectItem>
                <SelectItem value="cancelled">Anulada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.status === "paid" && (
            <>
              <div>
                <Label>Fecha de pago</Label>
                <Input type="datetime-local" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label>Recibo de pago</Label>
                <FileUpload
                  bucket="vehicle-photos"
                  folder="fines"
                  value={form.receipt_photo_url}
                  onChange={(url) => setForm({ ...form, receipt_photo_url: url })}
                  accept="image/*"
                />
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
