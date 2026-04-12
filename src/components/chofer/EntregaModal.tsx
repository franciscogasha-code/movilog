import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranches } from "@/hooks/use-branches";
import { toast } from "sonner";

interface Props {
  fulfillmentId: string;
  mode: "branch" | "customer" | "failed" | "hub";
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const FAILURE_REASONS = [
  "Cliente ausente",
  "Dirección incorrecta",
  "Cliente rechazó mercadería",
  "Sucursal cerrada",
  "Problema de acceso",
  "Otro",
];

export function EntregaModal({ fulfillmentId, mode, open, onClose, onSuccess }: Props) {
  const { data: branches } = useBranches();
  const [submitting, setSubmitting] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const [observation, setObservation] = useState("");
  const [hubBranchId, setHubBranchId] = useState("");
  const [failureReason, setFailureReason] = useState("");

  const hubBranches = branches?.filter(b => b.is_central_warehouse) || [];
  const allBranches = branches || [];

  const title = {
    branch: "Entregar en sucursal",
    customer: "Entregar a cliente",
    failed: "Registrar entrega fallida",
    hub: "Dejar en punto de acopio",
  }[mode];

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let action: string;
      let metadata: Record<string, any> = {};

      switch (mode) {
        case "branch":
          action = "deliver_branch";
          metadata = { observation };
          break;
        case "customer":
          if (!receiverName.trim()) {
            toast.error("Ingresá el nombre del receptor");
            setSubmitting(false);
            return;
          }
          action = "deliver_customer";
          metadata = { receiver_name: receiverName, observation };
          break;
        case "failed":
          if (!failureReason) {
            toast.error("Seleccioná un motivo");
            setSubmitting(false);
            return;
          }
          action = "delivery_failed";
          metadata = { reason: failureReason, observation };
          break;
        case "hub":
          if (!hubBranchId) {
            toast.error("Seleccioná el depósito/sucursal");
            setSubmitting(false);
            return;
          }
          action = "drop_at_hub";
          metadata = { hub_branch_id: hubBranchId, observation };
          break;
        default:
          return;
      }

      const { data, error } = await supabase.rpc("fn_driver_action", {
        p_fulfillment_id: fulfillmentId,
        p_action: action,
        p_metadata: metadata,
      });

      if (error) throw error;

      const result = data as any;
      if (result?.success) {
        const msgs = {
          branch: "Entregado en sucursal",
          customer: "Entregado a cliente",
          failed: "Entrega fallida registrada",
          hub: "Carga dejada en acopio",
        };
        toast.success(msgs[mode]);
        onSuccess();
      } else {
        toast.error("Error inesperado");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {mode === "customer" && (
            <div className="space-y-2">
              <Label>Nombre del receptor *</Label>
              <Input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Quién recibe la mercadería"
              />
            </div>
          )}

          {mode === "failed" && (
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <Select value={failureReason} onValueChange={setFailureReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar motivo..." />
                </SelectTrigger>
                <SelectContent>
                  {FAILURE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "hub" && (
            <div className="space-y-2">
              <Label>Depósito / sucursal de acopio *</Label>
              <Select value={hubBranchId} onValueChange={setHubBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {hubBranches.length > 0 && (
                    <>
                      {hubBranches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          ⭐ {b.code} - {b.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {allBranches
                    .filter((b) => !b.is_central_warehouse)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.code} - {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">⭐ = depósito central</p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Observación (opcional)</Label>
            <Textarea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Nota adicional..."
              rows={2}
            />
          </div>

          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full"
            variant={mode === "failed" ? "destructive" : "default"}
          >
            {submitting ? "Procesando..." : "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
