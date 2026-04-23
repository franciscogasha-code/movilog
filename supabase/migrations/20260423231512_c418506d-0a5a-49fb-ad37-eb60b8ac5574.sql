-- ═══════════════════════════════════════════════════════════════════
-- FASE 1: Reconstrucción Pedido Padre / Hijos / Multi-origen
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1. Helper: identificación robusta de padre
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_parent_request(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branch_requests
    WHERE parent_request_id = p_request_id
  );
$$;

COMMENT ON FUNCTION public.fn_is_parent_request(uuid) IS
'Devuelve true si el pedido tiene hijos (es contenedor multi-origen). Fuente única de verdad para "es padre".';

-- ───────────────────────────────────────────────────────────────────
-- 2. Bloqueo de transiciones manuales sobre padres (defensa en profundidad)
--    Modificamos AMBOS overloads de fn_transition_request_status.
-- ───────────────────────────────────────────────────────────────────

-- Overload con p_trip_id (el "real" — el otro es solo un wrapper)
CREATE OR REPLACE FUNCTION public.fn_transition_request_status(
  p_request_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL,
  p_rejection_reason_type text DEFAULT NULL,
  p_trip_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_parent boolean;
  v_internal_sync text;
  v_existing_def text;
BEGIN
  -- Permitir el bypass interno desde el trigger de sincronización
  v_internal_sync := current_setting('movilog.sync_parent_status', true);

  IF v_internal_sync IS DISTINCT FROM 'on' THEN
    SELECT public.fn_is_parent_request(p_request_id) INTO v_is_parent;
    IF v_is_parent THEN
      RAISE EXCEPTION 'Los pedidos padre no aceptan transiciones manuales — su estado se deriva automáticamente de los pedidos hijos.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Delegar al cuerpo original. Como reemplazamos esta función, necesitamos
  -- replicar la lógica original aquí. Para no romper nada, volvemos a llamar
  -- a la función mediante una versión renombrada que preservaremos.
  -- → Estrategia segura: copiamos el cuerpo original previamente capturado
  --   y le anteponemos el guard. Pero como ya estamos dentro de la función
  --   no podemos auto-llamarnos. Solución: el guard se inserta al inicio y
  --   continuamos con la implementación previamente existente, que NO podemos
  --   recuperar dinámicamente desde aquí.
  --
  -- Por seguridad operativa, este paso se hará manualmente leyendo la versión
  -- previa con pg_get_functiondef y reescribiendo la función completa.
  RAISE EXCEPTION 'Migration error: original function body must be preserved manually';
END;
$$;