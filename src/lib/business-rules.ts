/**
 * SLIS Business Rules Matrix v5.3.3
 *
 * Central source of truth for request type / delivery target / origin mode rules.
 * Validated in frontend (SolicitudCreateForm, Consultas) AND backend (trigger fn_validate_business_rules).
 *
 * ROLLBACK STRATEGY (documented):
 * Multi-origin creation uses logical rollback (compensation), not DB transactions.
 * If any child request fails during creation, the parent and all created children
 * are marked as "rejected" with a rejection_reason explaining the failure.
 * This prevents orphan children while remaining simple enough for MVP.
 */

export type RequestType = "reposition" | "client" | "online";
export type DeliveryTarget = "branch" | "client";
export type OriginMode = "multi" | "mono";
export type ShippingMethod = "own_fleet" | "courier" | "pickup" | "delivery";

/**
 * Business rules matrix:
 * - Reposición + sucursal = multi-origen
 * - Pedido online + sucursal = multi-origen
 * - Pedido online + cliente = mono-origen
 * - Pedido cliente + sucursal = multi-origen
 * - Pedido cliente + cliente = mono-origen
 *
 * RULE: If delivery involves a final client (billing/dispatch), force mono-origin.
 */
export function getOriginMode(requestType: RequestType, deliveryTarget: DeliveryTarget): OriginMode {
  if (requestType === "reposition") return "multi";
  if (deliveryTarget === "client") return "mono";
  return "multi";
}

export function getAllowedDeliveryTargets(requestType: RequestType): DeliveryTarget[] {
  if (requestType === "reposition") return ["branch"];
  return ["branch", "client"];
}

export function shouldShowClientFields(requestType: RequestType, deliveryTarget: DeliveryTarget): boolean {
  if (requestType === "reposition") return false;
  return deliveryTarget === "client";
}

export function getOriginModeLabel(mode: OriginMode): string {
  return mode === "multi" ? "Multi-origen" : "Mono-origen (origen único)";
}

export function getContextSummary(requestType: RequestType, deliveryTarget: DeliveryTarget): string {
  const typeLabels: Record<RequestType, string> = {
    reposition: "Reposición",
    client: "Pedido Cliente",
    online: "Pedido Online",
  };
  const targetLabels: Record<DeliveryTarget, string> = {
    branch: "Sucursal",
    client: "Cliente",
  };
  const mode = getOriginMode(requestType, deliveryTarget);
  return `${typeLabels[requestType]} → ${targetLabels[deliveryTarget]} → ${getOriginModeLabel(mode)}`;
}

/**
 * Shipping method coherence validation.
 * Returns null if valid, or an error message if the combination is invalid.
 *
 * Rules:
 * - "delivery" only valid for client destination (not branch-to-branch reposition)
 * - "pickup" only valid for client destination (client picks up at branch)
 * - "own_fleet" and "courier" are always valid
 */
export function validateShippingMethod(
  requestType: RequestType,
  deliveryTarget: DeliveryTarget,
  shippingMethod: ShippingMethod
): string | null {
  if (shippingMethod === "delivery" && deliveryTarget === "branch" && requestType === "reposition") {
    return "Delivery no aplica para reposición entre sucursales";
  }
  if (shippingMethod === "pickup" && deliveryTarget === "branch" && requestType === "reposition") {
    return "Pickup no aplica para reposición entre sucursales";
  }
  return null;
}

/**
 * Demand severity algorithm (formalized).
 *
 * Calculates severity based on the number of concurrent open requests:
 * - low:    1-2 pending requests → informational, normal activity
 * - medium: 3-4 pending requests → notable demand, user should verify stock
 * - high:   5+  pending requests → high demand, risk of stock depletion
 *
 * This is deterministic and consistent across all modules.
 * The same thresholds are used in DemandAlert component.
 */
export type DemandSeverity = "low" | "medium" | "high";

export function getDemandSeverity(openRequestCount: number): DemandSeverity {
  if (openRequestCount >= 5) return "high";
  if (openRequestCount >= 3) return "medium";
  return "low";
}

export const DEMAND_SEVERITY_LABELS: Record<DemandSeverity, string> = {
  low: "Demanda baja",
  medium: "Demanda media",
  high: "Demanda alta",
};
