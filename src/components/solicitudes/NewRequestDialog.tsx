import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SolicitudCreateForm } from "./SolicitudCreateForm";
import { PreSaleCreateForm } from "./PreSaleCreateForm";

/**
 * Wrapper unificado de "Nuevo Pedido" con selector de Tipo de Solicitud.
 *
 * Reemplaza la dualidad "Nuevo Pedido" + "Nueva Pre-Venta" por un único
 * punto de entrada. Según el tipo elegido:
 *  - Reposición / Cliente / Online → SolicitudCreateForm (flujo operativo intacto).
 *  - Pre-Venta Online              → PreSaleCreateForm (borrador comercial).
 *
 * No se modifica la lógica interna de cada formulario. La pre-venta sigue
 * siendo `is_pre_sale=true`, sin impacto logístico hasta que se convierta
 * (ver fn_convert_presale_to_order).
 */
type Kind = "operational" | "pre_sale";

export function NewRequestDialog({
  onSuccess,
  fromConsultationId,
  defaultKind = "operational",
}: {
  onSuccess: () => void;
  fromConsultationId?: string | null;
  defaultKind?: Kind;
}) {
  const [kind, setKind] = useState<Kind>(defaultKind);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          Tipo de solicitud
          {kind === "pre_sale" && (
            <Badge className="bg-warning/15 text-warning border-warning/40 text-[10px] px-1.5 py-0">
              Borrador comercial
            </Badge>
          )}
        </Label>
        <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operational">Pedido operativo (Reposición / Cliente / Online)</SelectItem>
            <SelectItem value="pre_sale">Pre-Venta Online (borrador comercial sin reserva)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {kind === "pre_sale"
            ? "Cotización previa para el cliente. No reserva stock ni genera operación. Se convierte en pedido cuando el cliente confirma."
            : "Solicitud que entra al flujo logístico (preparación, transporte, entrega)."}
        </p>
      </div>

      <div className="border-t border-border/60 pt-4">
        {kind === "pre_sale" ? (
          <PreSaleCreateForm onSuccess={onSuccess} />
        ) : (
          <SolicitudCreateForm fromConsultationId={fromConsultationId} onSuccess={onSuccess} />
        )}
      </div>
    </div>
  );
}
