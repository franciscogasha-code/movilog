/**
 * Helper centralizado para queries sobre branch_requests.
 *
 * Regla de negocio: las pre-ventas online (is_pre_sale=true) NO deben
 * aparecer en módulos operativos (Pedidos, Ruteo, Chofer, Dashboard,
 * Logística). Solo viven en la bandeja "Solicitudes / Pre-Ventas"
 * hasta que son promovidas a operación con fn_send_presale_to_operation.
 *
 * Este helper documenta los tres modos de acceso. Los módulos operativos
 * pueden usar `operationalRequests()` o aplicar `.eq("is_pre_sale", false)`
 * inline. Los módulos administrativos / Solicitudes deben usar `allRequests()`
 * y filtrar por UI según sea necesario.
 */
import { supabase } from "@/integrations/supabase/client";

/**
 * Columnas legibles de branch_requests para el rol autenticado.
 * `client_phone` y `client_email` quedan fuera: son PII de contacto y solo
 * se obtienen vía la función `fn_get_request_client_contact`.
 */
export const REQUEST_COLUMNS = "id, request_number, request_type, requesting_branch_id, source_branch_id, shipping_method, shipping_paid_by, shipping_cost, bims_invoice_number, bims_sale_reference, client_name, client_address, status, current_custody_holder_id, current_location_branch_id, expected_next_event, expected_next_event_deadline, priority, notes, created_by, accepted_by, accepted_at, rejected_by, rejected_at, rejection_reason, closed_by, closed_at, created_at, updated_at, rejection_reason_type, logistic_closed_at, logistic_closed_by, admin_closed_at, admin_closed_by, shipping_origin_paid, shipping_destination_paid, delivery_target, delivery_payer, parent_request_id, courier_billing_mode, operational_responsible_id, attached_file_path, flow_type, consolidation_override, is_pre_sale, pre_sale_status, sales_channel, pre_sale_confirmed_at, pre_sale_sent_at, pre_sale_pdf_generated_at, converted_to_request_id, created_from_presale_id, converted_at, converted_by_user_id, commercial_terms, client_uuid";

/** Obtiene teléfono/email del cliente de un pedido (solo usuarios autorizados). */
export async function fetchRequestClientContact(requestId: string) {
  const { data, error } = await supabase.rpc("fn_get_request_client_contact" as any, {
    p_request_id: requestId,
  });
  if (error) return { client_phone: null as string | null, client_email: null as string | null };
  const row = Array.isArray(data) ? (data[0] as any) : (data as any);
  return {
    client_phone: (row?.client_phone ?? null) as string | null,
    client_email: (row?.client_email ?? null) as string | null,
  };
}


/** Solicitudes operativas: excluye pre-ventas en borrador. */
export const operationalRequests = () =>
  supabase.from("branch_requests").select(REQUEST_COLUMNS).eq("is_pre_sale", false);

/**
 * Solicitudes operativas para flujos LOGÍSTICOS (ruteo, consolidación,
 * chofer, fulfillment): excluye además los estados nuevos de abastecimiento
 * (`in_supply`, `supplied`), donde el pedido aún no debe estar visible
 * para logística.
 */
export const operationalLogisticsRequests = () =>
  supabase
    .from("branch_requests")
    .select(REQUEST_COLUMNS)
    .eq("is_pre_sale", false)
    .not("status", "in", "(in_supply,supplied)");

/** Acceso completo (admin / Solicitudes). Incluye pre-ventas. */
export const allRequests = () => supabase.from("branch_requests");

/** Solo pre-ventas (bandeja Pre-Ventas). */
export const preSaleRequests = () =>
  supabase.from("branch_requests").select(REQUEST_COLUMNS).eq("is_pre_sale", true);

/** Filtro inline reutilizable (texto). */
export const EXCLUDE_PRESALE_FILTER = { is_pre_sale: false } as const;
/** Filtro inline para excluir estados de abastecimiento en vistas logísticas. */
export const EXCLUDE_SUPPLY_STATUSES = ["in_supply", "supplied"] as const;
