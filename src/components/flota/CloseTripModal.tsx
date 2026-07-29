import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { toLocalDatetimeInput } from "@/lib/datetime-local";

export function CloseTripModal({
  open,
  onOpenChange,
  trip,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trip: {
    id: string;
    vehicle_id: string;
    start_mileage: number;
    started_at: string;
    vehicle?: { plate: string; nickname?: string | null } | null;
  } | null;
}) {
  const qc = useQueryClient();
  const { user, isOwner, hasRole } = useAuth();
  const isPrivileged = isOwner || hasRole("admin") || hasRole("supervisor");

  const [endMileage, setEndMileage] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [endPhoto, setEndPhoto] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setEndMileage(""); setEndedAt(""); setEndPhoto(""); setNotes("");
    }
  }, [open]);

  useEffect(() => {
    if (endPhoto && !endedAt) setEndedAt(new Date().toISOString().slice(0, 16));
  }, [endPhoto, endedAt]);

  const endNum = Number(endMileage);
  const kmRecorridos = endMileage && trip ? endNum - trip.start_mileage : null;
  const invalidEnd = endMileage && trip && endNum < trip.start_mileage;

  const submit = useMutation({
    mutationFn: async () => {
      if (!trip) return;
      if (!endMileage) throw new Error("Km final requerido");
      if (endNum < trip.start_mileage) throw new Error("El km final debe ser mayor o igual al inicial");
      if (!endPhoto) throw new Error("Foto del odómetro final requerida");
      if (!endedAt) throw new Error("Fecha de fin requerida");

      const patch: any = {
        end_mileage: endNum,
        ended_at: new Date(endedAt).toISOString(),
        end_odometer_photo_path: endPhoto,
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: user?.id ?? null,
      };
      if (notes.trim()) patch.notes = notes.trim();

      const { error } = await supabase.from("vehicle_usages").update(patch).eq("id", trip.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-usages"] });
      qc.invalidateQueries({ queryKey: ["vehicle-open-trips"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["vehicles-active"] });
      toast.success("Viaje terminado");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const canSubmit = !!endMileage && !!endPhoto && !!endedAt && !invalidEnd;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            Terminar viaje {trip?.vehicle?.plate ? `— ${trip.vehicle.plate}` : ""}
          </DialogTitle>
        </DialogHeader>

        {trip && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Iniciado: {new Date(trip.started_at).toLocaleString("es-PY")} · Km inicial: {trip.start_mileage.toLocaleString("de-DE")}
              {isPrivileged && <span className="ml-2 text-secondary">(cierre por admin/supervisor)</span>}
            </div>

            <div>
              <Label>Km final *</Label>
              <Input type="number" value={endMileage} onChange={(e) => setEndMileage(e.target.value)} />
              {invalidEnd && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" /> Debe ser mayor o igual al km inicial
                </p>
              )}
              {kmRecorridos !== null && !invalidEnd && (
                <p className="text-xs text-muted-foreground mt-1">Recorridos: {kmRecorridos.toLocaleString("de-DE")} km</p>
              )}
            </div>

            <div>
              <Label>Foto odómetro final *</Label>
              <FileUpload bucket="vehicle-photos" folder={`usages/${trip.vehicle_id}/end`} signed onUpload={setEndPhoto} />
              <p className="text-xs text-muted-foreground mt-1">La fecha de fin se completa al subir la foto</p>
            </div>

            <div>
              <Label>Fin *</Label>
              <Input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} readOnly disabled />
            </div>

            <div>
              <Label>Observaciones (opcional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Agregar nota" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || !canSubmit}>
            {submit.isPending ? "Cerrando..." : "Terminar viaje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
