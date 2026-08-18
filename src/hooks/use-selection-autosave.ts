import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const AUTOSAVE_DRAFT_NAME = "Autoguardado catálogo";

/**
 * Respaldo automático de la selección de catálogo en el servidor.
 *
 * El respaldo local (IndexedDB) se pierde si el vendedor limpia el navegador,
 * usa otro dispositivo o el navegador descarta el almacenamiento. Este hook
 * guarda la selección en `sales_catalog_drafts` de forma continua para que
 * siempre se pueda recuperar desde "Catálogo PDF" → borradores.
 */
export function useSelectionAutosave({
  userId,
  selectedIds,
  customer,
  enabled,
}: {
  userId: string;
  selectedIds: string[];
  customer: unknown;
  enabled: boolean;
}) {
  const lastSaved = useRef<string>("");
  const draftIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    if (selectedIds.length === 0) return;

    const signature = `${selectedIds.length}:${selectedIds[0]}:${selectedIds[selectedIds.length - 1]}`;
    if (signature === lastSaved.current) return;

    const timer = window.setTimeout(async () => {
      try {
        if (!draftIdRef.current) {
          const { data } = await supabase
            .from("sales_catalog_drafts")
            .select("id")
            .eq("user_id", userId)
            .eq("name", AUTOSAVE_DRAFT_NAME)
            .maybeSingle();
          draftIdRef.current = data?.id ?? null;
        }

        const payload = {
          user_id: userId,
          name: AUTOSAVE_DRAFT_NAME,
          product_ids: selectedIds,
          customer: (customer ?? {}) as never,
        };

        const res = draftIdRef.current
          ? await supabase
              .from("sales_catalog_drafts")
              .update(payload)
              .eq("id", draftIdRef.current)
          : await supabase
              .from("sales_catalog_drafts")
              .insert(payload)
              .select("id")
              .maybeSingle();

        if (!res.error) {
          if (!draftIdRef.current && res.data && "id" in (res.data as { id?: string })) {
            draftIdRef.current = (res.data as { id: string }).id;
          }
          lastSaved.current = signature;
        }
      } catch {
        // Sin conexión: el respaldo local sigue vigente y reintentamos al próximo cambio
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [enabled, userId, selectedIds, customer]);
}
