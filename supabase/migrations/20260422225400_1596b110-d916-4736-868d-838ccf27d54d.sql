-- 1. Columnas mínimas para habilitar corte
ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS cleared_for_pickup BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleared_for_pickup_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cleared_for_pickup_by UUID NULL;

-- 2. RPC para habilitar cargas en acopio (solo roles logísticos autorizados)
CREATE OR REPLACE FUNCTION public.fn_clear_for_pickup(p_request_ids UUID[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_authorized boolean;
  v_updated_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Solo roles logísticos autorizados
  v_authorized :=
       has_role(v_user_id, 'admin'::app_role)
    OR has_role(v_user_id, 'supervisor'::app_role)
    OR has_role(v_user_id, 'jefe_logistica'::app_role)
    OR has_role(v_user_id, 'warehouse_operator'::app_role)
    OR is_owner(v_user_id);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'No autorizado para habilitar cargas para corte';
  END IF;

  IF p_request_ids IS NULL OR array_length(p_request_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'updated', 0);
  END IF;

  -- Solo sobre fulfillment_orders en at_hub que aún no estén habilitadas
  -- NO toca status, trip_id, custodia ni location.
  UPDATE public.fulfillment_orders
  SET cleared_for_pickup = true,
      cleared_for_pickup_at = now(),
      cleared_for_pickup_by = v_user_id,
      updated_at = now()
  WHERE branch_request_id = ANY(p_request_ids)
    AND status = 'at_hub'::fulfillment_status
    AND cleared_for_pickup = false;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated_count
  );
END;
$function$;