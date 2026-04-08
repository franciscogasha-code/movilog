/**
 * SLIS Business Rules Matrix
 * Determines whether multi-origin or mono-origin mode applies
 * based on request_type + delivery_target.
 */

export type RequestType = "reposition" | "client" | "online";
export type DeliveryTarget = "branch" | "client";
export type OriginMode = "multi" | "mono";

/**
 * Business rules matrix:
 * - Reposición + sucursal = multi-origen
 * - Transferencia + sucursal = multi-origen (same as reposition)
 * - Pedido online + sucursal = multi-origen
 * - Pedido online + cliente = mono-origen
 * - Pedido cliente + sucursal = multi-origen
 * - Pedido cliente + cliente = mono-origen
 *
 * RULE: If delivery involves a final client (billing/dispatch), force mono-origin.
 */
export function getOriginMode(requestType: RequestType, deliveryTarget: DeliveryTarget): OriginMode {
  // Reposition always targets a branch
  if (requestType === "reposition") return "multi";
  // Client destination always forces mono-origin
  if (deliveryTarget === "client") return "mono";
  // Branch destination = multi-origin
  return "multi";
}

/**
 * Returns allowed delivery targets for a given request type.
 */
export function getAllowedDeliveryTargets(requestType: RequestType): DeliveryTarget[] {
  if (requestType === "reposition") return ["branch"];
  return ["branch", "client"];
}

/**
 * Whether client fields (name, address) should be shown.
 */
export function shouldShowClientFields(requestType: RequestType, deliveryTarget: DeliveryTarget): boolean {
  if (requestType === "reposition") return false;
  return deliveryTarget === "client";
}

/**
 * Get human-readable mode label.
 */
export function getOriginModeLabel(mode: OriginMode): string {
  return mode === "multi" ? "Multi-origen" : "Mono-origen (origen único)";
}

/**
 * Get context summary string.
 */
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
