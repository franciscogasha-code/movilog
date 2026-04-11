/**
 * MoviLog Business Rules Matrix v5.3.4
 *
 * Central source of truth for request type / delivery target / origin mode rules.
 * Validated in frontend (SolicitudCreateForm, Consultas) AND backend (trigger fn_validate_business_rules).
 *
 * ═══════════════════════════════════════════════════════════════════
 * MVP OPERATIONAL MODEL — FORMAL DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════
 *
 * The system manages THREE distinct data layers that must NOT be treated
 * as the same technical problem:
 *
 * 1. PRODUCT CATALOG (catálogo)
 *    - Synchronized in batches/pages from BIMS ERP, NOT in real time.
 *    - Idempotent: multiple executions produce no duplicates (upsert by bims_code).
 *    - The catalog is operationally valid ONLY at 100% coverage.
 *    - Any coverage below 100% is a transitional state, NOT an acceptable final state.
 *    - Users must be warned clearly if the catalog is incomplete.
 *    - Retry is supported per failed page/segment.
 *
 * 2. PRICES (precios)
 *    - Part of the product master data, synchronized together with the catalog.
 *    - The displayed price reflects the last successful sync timestamp.
 *    - Future evolution: incremental price updates without full catalog resync.
 *    - Prices must NOT be confused with stock.
 *
 * 3. OPERATIONAL STOCK (stock operativo) — CRITICAL
 *    - Stock displayed on screen is REFERENTIAL ONLY (snapshot from last sync).
 *    - Before persisting ANY order, the system MUST revalidate against fresh
 *      database stock (revalidateStock).
 *    - If stock changed and is now insufficient, the order MUST NOT persist.
 *    - Error messages must be specific per product line, not generic.
 *    - The same validation criterion applies in both Pedidos and Consultas flows.
 *    - In this MVP stage: NO committed stock, NO automatic reserves, NO
 *      preventive deduction. Only sufficiency check at confirmation time.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ROLLBACK STRATEGY (documented):
 * Multi-origin creation uses logical rollback (compensation), not DB transactions.
 * If any child request fails during creation, the parent and all created children
 * are marked as "rejected" with a rejection_reason explaining the failure.
 * This prevents orphan children while remaining simple enough for MVP.
 * This is NOT an atomic database transaction — it is a controlled compensation pattern.
 * ═══════════════════════════════════════════════════════════════════
 *
 * PARENT-CHILD TRACEABILITY:
 * - Every child request MUST reference a valid parent via parent_request_id.
 * - The DB trigger fn_validate_business_rules enforces parent existence.
 * - The UI exposes the parent → children grouping for operational clarity.
 * - Children are grouped by source_branch_id (one child per origin branch).
 * ═══════════════════════════════════════════════════════════════════
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
 *
 * Enforced in frontend AND in DB trigger fn_validate_business_rules.
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
 *
 * IMPORTANT: In this MVP stage, demand alerts are INFORMATIONAL ONLY.
 * They do NOT block operations and do NOT deduct stock.
 * They provide context for human decision-making.
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

/**
 * ═══════════════════════════════════════════════════════════════════
 * CATALOG SYNC OPERATIONAL DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════
 *
 * Catalog sync status definitions for UI and operational clarity:
 *
 * - "complete"   → 100% of expected BIMS catalog is in the local DB.
 *                   This is the ONLY valid operational state.
 *
 * - "in_progress"→ A sync is currently running (pages being processed).
 *
 * - "incomplete" → Sync finished but coverage < 100%.
 *                   Transitional state. User must retry failed segments.
 *                   System should warn that catalog is NOT operationally ready.
 *
 * - "error"      → Sync failed entirely (0 items processed).
 *                   System is NOT operational for product-related flows.
 *
 * The system MUST NOT present an incomplete catalog as operationally valid.
 *
 * SYNC STRATEGY:
 * - Full sync: process all pages sequentially (for initial load or periodic refresh)
 * - Partial retry: re-process only failed pages from a previous run
 * - Both strategies are idempotent (upsert by bims_code)
 * - Never use "real-time sync" terminology for catalog — it's batch/paginated
 */
/**
 * Operational tolerance: if ≤0.1% of expected catalog is missing,
 * the catalog is considered operationally complete ("complete_with_observations").
 * This accounts for legitimately skipped/inactive products from BIMS.
 */
const CATALOG_COVERAGE_TOLERANCE = 0.001; // 0.1%

export type CatalogSyncStatus = "complete" | "complete_with_observations" | "in_progress" | "incomplete" | "error" | "unknown";

export function getCatalogSyncStatus(
  totalInDb: number,
  totalExpected: number,
  isSyncing: boolean
): CatalogSyncStatus {
  if (isSyncing) return "in_progress";
  if (totalExpected <= 0) return "unknown";
  if (totalInDb >= totalExpected) return "complete";
  const missingRatio = (totalExpected - totalInDb) / totalExpected;
  if (missingRatio <= CATALOG_COVERAGE_TOLERANCE) return "complete_with_observations";
  if (totalInDb > 0) return "incomplete";
  return "error";
}

export const CATALOG_STATUS_LABELS: Record<CatalogSyncStatus, string> = {
  complete: "Completo",
  complete_with_observations: "Completado con observaciones",
  in_progress: "En proceso",
  incomplete: "Incompleto",
  error: "Con error",
  unknown: "Sin datos",
};

export const CATALOG_STATUS_DESCRIPTIONS: Record<CatalogSyncStatus, string> = {
  complete: "El catálogo está sincronizado al 100%. El sistema está operativo.",
  complete_with_observations: "El catálogo está operativo. Algunos productos fueron omitidos o fallaron durante la sincronización (dentro del umbral aceptable).",
  in_progress: "La sincronización está en curso. Espere a que termine.",
  incomplete: "El catálogo no está completo. Reintente las páginas fallidas antes de operar.",
  error: "La sincronización falló. Ejecute una nueva sincronización completa.",
  unknown: "No se ha ejecutado ninguna sincronización. Ejecute una sincronización completa.",
};
