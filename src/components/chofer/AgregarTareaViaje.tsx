import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBranches } from "@/hooks/use-branches";
import { toast } from "sonner";

const TASK_TYPES = [
  { value: "pickup_branch", label: "Retiro en sucursal de paso" },
  { value: "delivery_client", label: "Entrega a cliente" },
  { value: "pickup_supplier", label: "Retiro de proveedor" },
];

interface Props {
  tripId: string;
  onSuccess: () => void;
}

export function AgregarTareaViaje({ tripId, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const { data: branches } = useBranches();
  const [submitting, setSubmitting] = useState(false);
  const [taskType, setTaskType] = useState("pickup_branch");
  const [branchId, setBranchId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciar sesión"); return; }

      // Get current planned_stops from the trip
      const { data: trip, error: tripErr } = await supabase
        .from("trips")
        .select("planned_stops")
        .eq("id", tripId)
        .single();
      if (tripErr) throw tripErr;

      const currentStops = (trip.planned_stops as any[]) || [];
      const newStop = {
        id: crypto.randomUUID(),
        type: taskType,
        branch_id: taskType === "pickup_branch" ? branchId : null,
        client_name: taskType !== "pickup_branch" ? clientName : null,
        client_address: taskType === "delivery_client" ? clientAddress : null,
        notes,
        added_in_transit: true,
        added_at: new Date().toISOString(),
        added_by: user.id,
        completed: false,
      };

      const { error } = await supabase
        .from("trips")
        .update({ planned_stops: [...currentStops, newStop] })
        .eq("id", tripId);
      if (error) throw error;

      // Log event
      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: tripId,
        event_type: "task_added_in_transit",
        category: "logistics" as any,
        event_description: `Tarea agregada en tránsito: ${TASK_TYPES.find(t => t.value === taskType)?.label}`,
        triggered_by: user.id,
        metadata: { task: newStop },
      });

      toast.success("Tarea agregada al viaje");
      queryClient.invalidateQueries({ queryKey: ["trip-detail"] });
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Tipo de tarea</Label>
        <select value={taskType} onChange={e => setTaskType(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
          {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {taskType === "pickup_branch" && (
        <div className="space-y-2">
          <Label>Sucursal</Label>
          <select value={branchId} onChange={e => setBranchId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Seleccionar...</option>
            {branches?.map(b => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
        </div>
      )}

      {taskType !== "pickup_branch" && (
        <>
          <div className="space-y-2">
            <Label>{taskType === "delivery_client" ? "Cliente" : "Proveedor"}</Label>
            <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nombre" />
          </div>
          {taskType === "delivery_client" && (
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Dirección de entrega" />
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..." rows={2} />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Agregando..." : "Agregar tarea"}
      </Button>
    </form>
  );
}
