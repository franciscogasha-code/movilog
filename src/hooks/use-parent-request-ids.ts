import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Devuelve el set de IDs de pedidos que son "padre multi-origen".
 *
 * Detección estructural (NO por substring en `notes`):
 *  - Un pedido es padre si existe al menos un `branch_requests.parent_request_id = <su id>`.
 *
 * Esto reemplaza el filtro frágil `notes ILIKE '%[Pedido padre multi-origen]%'`
 * que causaba la regresión #306/#307 (NULL NOT ILIKE → NULL → fila excluida).
 *
 * Cache de 30s — cambia poco y se invalida implícitamente al crear pedidos.
 */
export function useParentRequestIds() {
  return useQuery<string[]>({
    queryKey: ["parent-request-ids"],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("parent_request_id")
        .not("parent_request_id", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      (data ?? []).forEach((r: any) => {
        if (r.parent_request_id) set.add(r.parent_request_id);
      });
      return Array.from(set);
    },
  });
}
