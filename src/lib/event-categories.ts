import type { Database } from "@/integrations/supabase/types";

/**
 * Fuente única de verdad para `operational_events.category`.
 *
 * El enum real en Postgres es `event_category` con estos valores:
 *   request, fulfillment, document, trip, inventory, incident,
 *   vehicle, collection, stock, preparation, transport, reception, closure
 *
 * NOTA HISTÓRICA: NO existe el valor "logistics" en este enum.
 * "logistics" es válido sólo en `ai_anomalies.area` (text libre).
 * Usar "logistics" aquí provoca: invalid input value for enum event_category.
 */
export type EventCategory = Database["public"]["Enums"]["event_category"];

/** Categoría correcta para eventos del módulo Ruteo / Chofer. */
export const TRIP_EVENT_CATEGORY: Record<string, EventCategory> = {
  // Planificación del viaje
  trip_planned: "trip",
  trip_edited: "trip",
  trip_cancelled: "trip",
  // Operación del viaje
  trip_started: "transport",
  trip_completed: "transport",
  cutoff_started: "transport",
  cutoff_ended: "transport",
  task_added_in_transit: "transport",
  // Incidentes operativos
  driver_pickup_rejected: "incident",
};

export function categoryForTripEvent(eventType: keyof typeof TRIP_EVENT_CATEGORY): EventCategory {
  return TRIP_EVENT_CATEGORY[eventType];
}
