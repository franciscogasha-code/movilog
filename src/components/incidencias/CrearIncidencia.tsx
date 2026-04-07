import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useBranches, useProducts } from "@/hooks/use-branches";
import { DETECTION_CONTEXT_LABELS, DAMAGE_CAUSE_LABELS } from "@/lib/constants";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "sonner";

const INCIDENT_TYPES = [
  { value: "damaged", label: "Producto averiado" },
  { value: "missing", label: "Faltante" },
  { value: "surplus", label: "Sobrante" },
  { value: "stock_difference", label: "Diferencia de stock" },
  { value: "wrong_product", label: "Producto incorrecto" },
  { value: "other", label: "Otro" },
];

export function CrearIncidencia({ onSuccess }: { onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { data: branches } = useBranches();
  const { data: products } = useProducts();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentType, setIncidentType] = useState("damaged");
  const [detectionContext, setDetectionContext] = useState<string>("");
  const [damageCause, setDamageCause] = useState<string>("");
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [pendingShipment, setPendingShipment] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isInternal = detectionContext === "internal";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !branchId || !detectionContext) {
      toast.error("Completá título, sucursal y contexto de detección");
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Iniciá sesión"); return; }

      const insertData: any = {
        title,
        description: description || null,
        incident_type: incidentType as any,
        detection_context: detectionContext as any,
        branch_id: branchId,
        reported_by: user.id,
        product_id: productId || null,
        quantity_affected: quantity ? parseFloat(quantity) : null,
        pending_shipment_to_admin: pendingShipment,
      };

      // Only set damage_cause for internal detection
      if (isInternal && damageCause) {
        insertData.damage_cause = damageCause as any;
      }

      const { error } = await supabase.from("logistics_incidents").insert(insertData);
      if (error) throw error;

      // Log event
      await supabase.from("operational_events").insert({
        reference_type: "logistics_incident",
        reference_id: crypto.randomUUID(),
        event_type: "incident_created",
        category: "logistics" as any,
        event_description: `Incidencia creada: ${title}`,
        triggered_by: user.id,
        metadata: { detection_context: detectionContext, incident_type: incidentType },
      });

      toast.success("Incidencia registrada");
      queryClient.invalidateQueries({ queryKey: ["logistics-incidents"] });
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tipo de incidencia</Label>
          <Select value={incidentType} onValueChange={setIncidentType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {INCIDENT_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Contexto de detección *</Label>
          <Select value={detectionContext} onValueChange={setDetectionContext}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {Object.entries(DETECTION_CONTEXT_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Título *</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Descripción breve del incidente" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Sucursal *</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {branches?.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.code} - {b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Producto</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue placeholder="Opcional..." /></SelectTrigger>
            <SelectContent>
              {products?.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cantidad afectada</Label>
          <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0" />
        </div>
        {isInternal && (
          <div className="space-y-2">
            <Label>Causa del daño</Label>
            <Select value={damageCause} onValueChange={setDamageCause}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {Object.entries(DAMAGE_CAUSE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Descripción</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalle del incidente..." rows={3} />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox id="pending-shipment" checked={pendingShipment} onCheckedChange={(v) => setPendingShipment(v === true)} />
        <label htmlFor="pending-shipment" className="text-sm text-muted-foreground">
          Pendiente de envío a administración
        </label>
      </div>

      {detectionContext && !isInternal && (
        <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <strong>Nota:</strong> En {DETECTION_CONTEXT_LABELS[detectionContext]}, la causa del daño y el responsable no aplican — se registra como recibido en esa condición.
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Registrando..." : "Registrar incidencia"}
      </Button>
    </form>
  );
}
