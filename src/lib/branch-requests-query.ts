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

/** Solicitudes operativas: excluye pre-ventas en borrador. */
export const operationalRequests = () =>
  supabase.from("branch_requests").select("*").eq("is_pre_sale", false);

/** Acceso completo (admin / Solicitudes). Incluye pre-ventas. */
export const allRequests = () => supabase.from("branch_requests");

/** Solo pre-ventas (bandeja Pre-Ventas). */
export const preSaleRequests = () =>
  supabase.from("branch_requests").select("*").eq("is_pre_sale", true);

/** Filtro inline reutilizable (texto). */
export const EXCLUDE_PRESALE_FILTER = { is_pre_sale: false } as const;
