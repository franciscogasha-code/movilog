import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export const AUTOSAVE_DRAFT_NAME = "Autoguardado catálogo";
const AUTOSAVE_PREFIX = "Autoguardado catálogo";
const MAX_AUTOSAVES = 6;

function autosaveName() {
  const d = new Date();
  const fecha = d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  return `${AUTOSAVE_PREFIX} ${fecha} ${hora}`;
}

/**
 * Respaldo automático de la selección de catálogo en el servidor.
 *
 * Cada sesión de trabajo genera SU PROPIO borrador (no se pisa el anterior),
 * conservando hasta 6 autoguardados históricos. Así, cargar o cambiar de
 * selección nunca destruye el trabajo previo de otro cliente.
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
        const payload = {
          user_id: userId,
          product_ids: selectedIds,
          customer: (customer ?? {}) as never,
        };

        if (draftIdRef.current) {
          const { error } = await supabase
            .from("sales_catalog_drafts")
            .update(payload)
            .eq("id", draftIdRef.current);
          if (!error) lastSaved.current = signature;
          return;
        }

        // Nueva sesión: creamos un autoguardado propio y podamos los más viejos
        const { data, error } = await supabase
          .from("sales_catalog_drafts")
          .insert({ ...payload, name: autosaveName() })
          .select("id")
          .maybeSingle();

        if (!error && data?.id) {
          draftIdRef.current = data.id;
          lastSaved.current = signature;

          const { data: previos } = await supabase
            .from("sales_catalog_drafts")
            .select("id, name, updated_at")
            .eq("user_id", userId)
            .like("name", `${AUTOSAVE_PREFIX}%`)
            .order("updated_at", { ascending: false });

          const sobrantes = (previos ?? []).slice(MAX_AUTOSAVES).map((d) => d.id);
          if (sobrantes.length > 0) {
            await supabase.from("sales_catalog_drafts").delete().in("id", sobrantes);
          }
        }
      } catch {
        // Sin conexión: el respaldo local sigue vigente y reintentamos al próximo cambio
      }
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [enabled, userId, selectedIds, customer]);
}

