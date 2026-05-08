/**
 * Whitelists de estados de pedidos (branch_requests) compartidas entre módulos.
 *
 * REGLA DE ORO: Cualquier vista operativa (Dashboard, Pedidos, Cumplimiento, etc.)
 * que necesite separar pedidos "activos" vs "cerrados" debe importar desde acá.
 * NO duplicar arrays locales — eso causó la divergencia que ocultó pedidos
 * en producción (regresión #306/#307).
 */

/**
 * Estados activos: el pedido sigue requiriendo acción o seguimiento operativo.
 * Incluye estados legacy (`accepted`, `picking`, `dispatched`) para no romper
 * históricos en transición.
 */
export const ACTIVE_REQUEST_STATUSES = [
  // NOTE: "in_supply" y "supplied" se agregarán acá en Fase 3 (M1) cuando
  // el enum request_status incluya esos valores en DB. Agregarlos antes
  // rompe queries `.in("status", ...)` (error 22P02).
  "pending",
  "accepted",
  "in_preparation",
  "ready_for_pickup",
  "ready_for_delivery",
  "in_consolidation",
  "assigned_to_trip",
  "in_transit",
  "delivered",
  "delivered_to_third_party",
  "picking",
  "dispatched",
] as const;

/** Estados terminales / históricos. Salen de la bandeja operativa. */
export const CLOSED_REQUEST_STATUSES = [
  "received",
  "logistic_closed",
  "closed",
  "rejected",
] as const;

/**
 * Subset usado por el Dashboard para la "cola pendiente" inicial
 * (pedidos antes de que se materialice un fulfillment activo).
 * Es un subconjunto estricto de ACTIVE_REQUEST_STATUSES.
 */
export const DASHBOARD_PENDING_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "picking",
  "in_preparation",
  "ready_for_pickup",
  "ready_for_delivery",
] as const;

/** Estados de fulfillment_orders que ya NO requieren atención en la cola. */
export const FULFILLMENT_TERMINAL_STATUSES = [
  "completed",
  "cancelled",
  "received",
  "logistic_closed",
] as const;

export type ActiveRequestStatus = (typeof ACTIVE_REQUEST_STATUSES)[number];
export type ClosedRequestStatus = (typeof CLOSED_REQUEST_STATUSES)[number];
