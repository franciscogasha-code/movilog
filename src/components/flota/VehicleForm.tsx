import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useBranches } from "@/hooks/use-branches";
import { toast } from "sonner";

export type VehicleFormValues = {
  id?: string;
  plate: string;
  nickname?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: number | null;
  status: string;
  assigned_branch_id?: string | null;
  current_mileage?: number | null;
  vtv_expiry?: string | null;
  insurance_expiry?: string | null;
  notes?: string | null;
  is_active?: boolean;
};

const STATUSES = [
  { v: "available", l: "Disponible" },
  { v: "in_route", l: "En ruta" },
  { v: "maintenance", l: "En mantenimiento" },
  { v: "out_of_service", l: "Fuera de servicio" },
];

export function VehicleForm({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Partial<VehicleFormValues> | null;
}) {
  const qc = useQueryClient();
  const { data: branches } = useBranches();
  const [f, setF] = useState<VehicleFormValues>({
    plate: initial?.plate ?? "",
    nickname: initial?.nickname ?? "",
    brand: initial?.brand ?? "",
    model: initial?.model ?? "",
    year: initial?.year ?? null,
    status: initial?.status ?? "available",
    assigned_branch_id: initial?.assigned_branch_id ?? null,
    current_mileage: initial?.current_mileage ?? 0,
    vtv_expiry: initial?.vtv_expiry ?? null,
    insurance_expiry: initial?.insurance_expiry ?? null,
    notes: initial?.notes ?? "",
    is_active: initial?.is_active ?? true,
    id: initial?.id,
  });

  const isEdit = !!initial?.id;

  const save = useMutation({
    mutationFn: async () => {
      if (!f.plate.trim()) throw new Error("La patente es obligatoria");
      const payload = {
        plate: f.plate.trim().toUpperCase(),
        nickname: f.nickname?.trim() || null,
        brand: f.brand?.trim() || null,
        model: f.model?.trim() || null,
        year: f.year ? Number(f.year) : null,
        status: f.status,
        assigned_branch_id: f.assigned_branch_id || null,
        current_mileage: f.current_mileage ? Number(f.current_mileage) : 0,
        vtv_expiry: f.vtv_expiry || null,
        insurance_expiry: f.insurance_expiry || null,
        notes: f.notes?.trim() || null,
        is_active: f.is_active ?? true,
      };
      if (isEdit && f.id) {
        const { error } = await supabase.from("vehicles").update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicles").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success(isEdit ? "Vehículo actualizado" : "Vehículo creado");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Error al guardar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "Editar vehículo" : "Nuevo vehículo"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Patente *</Label>
              <Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} placeholder="ABC123" />
            </div>
            <div>
              <Label>Apodo interno</Label>
              <Input value={f.nickname ?? ""} onChange={(e) => setF({ ...f, nickname: e.target.value })} placeholder="La blanca" />
            </div>
            <div>
              <Label>Marca</Label>
              <Input value={f.brand ?? ""} onChange={(e) => setF({ ...f, brand: e.target.value })} />
            </div>
            <div>
              <Label>Modelo</Label>
              <Input value={f.model ?? ""} onChange={(e) => setF({ ...f, model: e.target.value })} />
            </div>
            <div>
              <Label>Año</Label>
              <Input type="number" value={f.year ?? ""} onChange={(e) => setF({ ...f, year: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label>Kilometraje actual</Label>
              <Input type="number" value={f.current_mileage ?? 0} onChange={(e) => setF({ ...f, current_mileage: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Estado</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sucursal asignada</Label>
              <Select value={f.assigned_branch_id ?? "__none"} onValueChange={(v) => setF({ ...f, assigned_branch_id: v === "__none" ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Sin asignar</SelectItem>
                  {branches?.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vencimiento VTV</Label>
              <Input type="date" value={f.vtv_expiry ?? ""} onChange={(e) => setF({ ...f, vtv_expiry: e.target.value || null })} />
            </div>
            <div>
              <Label>Vencimiento seguro</Label>
              <Input type="date" value={f.insurance_expiry ?? ""} onChange={(e) => setF({ ...f, insurance_expiry: e.target.value || null })} />
            </div>
          </div>
          <div>
            <Label>Observaciones</Label>
            <Textarea value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
