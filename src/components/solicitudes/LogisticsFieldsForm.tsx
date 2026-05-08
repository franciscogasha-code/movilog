import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  type RequestType,
  type DeliveryTarget,
  type ShippingMethod,
  shouldShowClientFields,
  validateShippingMethod,
} from "@/lib/business-rules";

/**
 * LogisticsFieldsForm — bloque "Step 4: Logística" extraído de
 * SolicitudCreateForm para que pueda reutilizarse desde el flujo
 * de "Iniciar operación" (pedidos en estado supplied).
 *
 * IMPORTANTE: este componente es 100% controlado y NO altera el
 * comportamiento, payload ni layout actual de SolicitudCreateForm.
 * El JSX es exactamente el mismo bloque que existía inline.
 *
 * Para garantizar paridad con el form original, las reglas derivadas
 * (showDeliveryPaidBy, showCourierBilling, showShippingAmount,
 *  showClientFieldsFlag, shippingError) se calculan acá pero replican
 * exactamente las del form original. Si en el futuro cambian las
 * business-rules, ambos sitios reaccionan igual.
 */
export interface LogisticsFieldsValue {
  shippingMethod: ShippingMethod;
  deliveryPaidBy: "company" | "client";
  courierBillingMode: "on_invoice" | "collect_at_destination";
  shippingAmount: string;
  clientName: string;
  clientAddress: string;
  notes: string;
  operationalResponsibleId: string;
}

export interface LogisticsFieldsFormProps {
  /** Tipo operativo efectivo (no acepta pre_sale_online; el caller debe mapearlo). */
  operationalRequestType: RequestType;
  deliveryTarget: DeliveryTarget;
  /** Tipo "crudo" del form (para mostrar selector de responsable solo en "online"). */
  formRequestType: RequestType | "pre_sale_online";
  value: LogisticsFieldsValue;
  onChange: (patch: Partial<LogisticsFieldsValue>) => void;
  /** Lista de perfiles habilitados como responsable operativo (solo se usa para "online"). */
  operationalProfiles?: Array<{ user_id: string; full_name: string }>;
  /** Si está presente, se muestra como error global del bloque (no usado hoy, reservado). */
  shippingErrorOverride?: string | null;
}

export function LogisticsFieldsForm({
  operationalRequestType,
  deliveryTarget,
  formRequestType,
  value,
  onChange,
  operationalProfiles,
}: LogisticsFieldsFormProps) {
  const {
    shippingMethod,
    deliveryPaidBy,
    courierBillingMode,
    shippingAmount,
    clientName,
    clientAddress,
    notes,
    operationalResponsibleId,
  } = value;

  // Derivadas — paridad exacta con SolicitudCreateForm.
  const showClientFieldsFlag = shouldShowClientFields(operationalRequestType, deliveryTarget);
  const showDeliveryPaidBy = shippingMethod === "delivery";
  const showCourierBilling = shippingMethod === "courier";
  const showShippingAmount =
    shippingMethod === "delivery" ||
    (shippingMethod === "courier" && courierBillingMode === "on_invoice");
  // Validación informativa (consumida vía prop opcional si el caller la quiere mostrar).
  void validateShippingMethod(operationalRequestType, deliveryTarget, shippingMethod);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">4. Logística</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="space-y-2">
          <Label>Método de envío</Label>
          <select
            value={shippingMethod}
            onChange={(e) => onChange({ shippingMethod: e.target.value as ShippingMethod })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="own_fleet">Flota propia</option>
            <option value="courier">Encomienda</option>
            <option value="pickup">Retiro en sucursal</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>
      </div>

      {showDeliveryPaidBy && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
          <Label>¿Quién paga el delivery?</Label>
          <div className="flex gap-3">
            <Badge variant={deliveryPaidBy === "company" ? "default" : "outline"} className="cursor-pointer" onClick={() => onChange({ deliveryPaidBy: "company" })}>
              Empresa paga
            </Badge>
            <Badge variant={deliveryPaidBy === "client" ? "default" : "outline"} className="cursor-pointer" onClick={() => onChange({ deliveryPaidBy: "client" })}>
              Cliente paga
            </Badge>
          </div>
        </div>
      )}

      {showCourierBilling && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
          <Label>Modalidad de cobro de encomienda</Label>
          <div className="flex gap-3">
            <Badge variant={courierBillingMode === "on_invoice" ? "default" : "outline"} className="cursor-pointer" onClick={() => onChange({ courierBillingMode: "on_invoice" })}>
              En factura
            </Badge>
            <Badge variant={courierBillingMode === "collect_at_destination" ? "default" : "outline"} className="cursor-pointer" onClick={() => onChange({ courierBillingMode: "collect_at_destination" })}>
              Cobro en destino
            </Badge>
          </div>
        </div>
      )}

      {showShippingAmount && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
          <Label>Monto de envío (Gs.)</Label>
          <Input
            type="number"
            min={0}
            value={shippingAmount}
            onChange={(e) => onChange({ shippingAmount: e.target.value })}
            placeholder="Ingresá el monto del envío"
          />
        </div>
      )}

      {showClientFieldsFlag && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 rounded-lg bg-muted/50 border border-border/50">
          <div className="space-y-2">
            <Label>Cliente (nombre)</Label>
            <Input value={clientName} onChange={(e) => onChange({ clientName: e.target.value })} placeholder="Nombre del cliente" />
          </div>
          <div className="space-y-2">
            <Label>Dirección de entrega</Label>
            <Input value={clientAddress} onChange={(e) => onChange({ clientAddress: e.target.value })} placeholder="Dirección" />
          </div>
        </div>
      )}

      {formRequestType === "online" && operationalProfiles && operationalProfiles.length > 0 && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
          <Label>Responsable operativo (opcional)</Label>
          <select
            value={operationalResponsibleId}
            onChange={(e) => onChange({ operationalResponsibleId: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin asignar</option>
            {operationalProfiles.map((p) => (
              <option key={p.user_id} value={p.user_id}>{p.full_name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Persona que ejecutará la operativa de este pedido</p>
        </div>
      )}

      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea
          value={notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Observaciones adicionales..."
          rows={2}
        />
      </div>
    </div>
  );
}
