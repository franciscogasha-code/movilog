import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { LogisticsFieldsForm, type LogisticsFieldsValue } from "./LogisticsFieldsForm";
import type { DeliveryTarget } from "@/lib/business-rules";

/**
 * StartOperationModal — transición `supplied` → `pending`.
 *
 * Reutiliza LogisticsFieldsForm (paridad exacta con SolicitudCreateForm) y
 * llama a fn_start_operation_from_supplied con el payload completo.
 *
 * No modifica ninguna otra ruta de creación/transición. Solo se abre desde
 * SolicitudDetail cuando status='supplied'.
 */
export function StartOperationModal({
  requestId,
  open,
  onOpenChange,
  defaultClientName,
  defaultClientAddress,
  defaultNotes,
  onStarted,
}: {
  requestId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultClientName?: string | null;
  defaultClientAddress?: string | null;
  defaultNotes?: string | null;
  onStarted: () => void;
}) {
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>("client");
  const [value, setValue] = useState<LogisticsFieldsValue>({
    shippingMethod: "own_fleet",
    deliveryPaidBy: "company",
    courierBillingMode: "on_invoice",
    shippingAmount: "",
    clientName: defaultClientName ?? "",
    clientAddress: defaultClientAddress ?? "",
    notes: defaultNotes ?? "",
    operationalResponsibleId: "",
  });

  useEffect(() => {
    if (open) {
      setValue((v) => ({
        ...v,
        clientName: defaultClientName ?? v.clientName,
        clientAddress: defaultClientAddress ?? v.clientAddress,
        notes: defaultNotes ?? v.notes,
      }));
    }
  }, [open, defaultClientName, defaultClientAddress, defaultNotes]);

  // Operativos online (mismo criterio que SolicitudCreateForm)
  const { data: operationalProfiles = [] } = useQuery({
    queryKey: ["operational-profiles-online"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .order("full_name");
      return (data ?? []) as Array<{ user_id: string; full_name: string }>;
    },
  });

  const addressRequired =
    deliveryTarget === "client" &&
    (value.shippingMethod === "delivery" || value.shippingMethod === "courier");
  const missingAddress = addressRequired && !value.clientAddress.trim();

  const canSubmit = useMemo(() => {
    if (!deliveryTarget || !value.shippingMethod) return false;
    if (missingAddress) return false;
    return true;
  }, [deliveryTarget, value.shippingMethod, missingAddress]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        request_id: requestId,
        delivery_target: deliveryTarget,
        shipping_method: value.shippingMethod,
        delivery_payer:
          value.shippingMethod === "delivery" ? value.deliveryPaidBy : null,
        courier_billing_mode:
          value.shippingMethod === "courier" ? value.courierBillingMode : null,
        shipping_cost: value.shippingAmount || null,
        shipping_origin_paid: 0,
        shipping_destination_paid: 0,
        client_address: value.clientAddress || null,
        notes: value.notes || null,
        operational_responsible_id: value.operationalResponsibleId || null,
      };

      const { error } = await supabase.rpc("fn_start_operation_from_supplied" as any, {
        p_payload: payload,
      });
      if (error) throw error;

      toast.success("Operación iniciada. El pedido entró al flujo logístico.");
      qc.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      onStarted();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo iniciar la operación");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" /> Iniciar operación
          </DialogTitle>
          <DialogDescription>
            Definí destino, método de entrega y datos logísticos. Al confirmar, el pedido pasa a
            <strong> Pendiente</strong> y entra al flujo operativo normal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Destino *</Label>
            <Select value={deliveryTarget} onValueChange={(v) => setDeliveryTarget(v as DeliveryTarget)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="branch">Sucursal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <LogisticsFieldsForm
            operationalRequestType="online"
            deliveryTarget={deliveryTarget}
            formRequestType="online"
            value={value}
            onChange={(patch) => setValue((v) => ({ ...v, ...patch }))}
            operationalProfiles={operationalProfiles}
          />

          {missingAddress && (
            <p className="text-xs text-destructive">
              Delivery / encomienda a cliente requiere dirección.
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Truck className="h-4 w-4 mr-2" />}
              Iniciar operación
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
