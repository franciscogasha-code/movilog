CREATE OR REPLACE FUNCTION public.fn_driver_action(
  p_action text,
  p_fulfillment_id uuid DEFAULT NULL,
  p_trip_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_driver record;
  v_fulfillment record;
  v_request record;
  v_is_operative boolean;
  v_default_branch uuid;
  v_central_branch uuid;
  v_new_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- UNIFICADO: roles operativos equivalentes a chofer (usando enum real app_role)
  v_is_operative := has_role(v_user_id, 'driver'::app_role)
                 OR has_role(v_user_id, 'warehouse_operator'::app_role)
                 OR has_role(v_user_id, 'jefe_logistica'::app_role)
                 OR has_role(v_user_id, 'admin'::app_role)
                 OR has_role(v_user_id, 'supervisor'::app_role)
                 OR is_owner(v_user_id);

  IF NOT v_is_operative THEN
    RAISE EXCEPTION 'Solo usuarios con rol operativo pueden ejecutar acciones de chofer';
  END IF;

  -- Buscar ficha de chofer; si no existe, construir contexto virtual
  SELECT id, assigned_branch_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE user_id = v_user_id AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF v_driver IS NULL THEN
    SELECT default_branch_id INTO v_default_branch
    FROM public.profiles WHERE user_id = v_user_id LIMIT 1;

    IF v_default_branch IS NULL THEN
      SELECT id INTO v_central_branch
      FROM public.branches
      WHERE COALESCE(is_central_warehouse, false) = true AND COALESCE(is_active, true) = true
      LIMIT 1;
      v_default_branch := v_central_branch;
    END IF;

    v_driver := ROW(NULL::uuid, v_default_branch, NULL::uuid)::record;
  END IF;

  -- Acción: pickup (retirar carga)
  IF p_action = 'pickup' THEN
    IF p_fulfillment_id IS NULL THEN
      RAISE EXCEPTION 'Falta el ID de la carga (fulfillment) a retirar';
    END IF;

    SELECT * INTO v_fulfillment
    FROM public.fulfillment_orders
    WHERE id = p_fulfillment_id
    FOR UPDATE;

    IF v_fulfillment IS NULL THEN
      RAISE EXCEPTION 'Carga no encontrada';
    END IF;

    SELECT * INTO v_request
    FROM public.branch_requests
    WHERE id = v_fulfillment.branch_request_id;

    -- Validar documento BIMS
    IF v_fulfillment.bims_transfer_number IS NULL AND v_fulfillment.bims_invoice_number IS NULL THEN
      RAISE EXCEPTION 'No se puede retirar sin documento BIMS vinculado';
    END IF;

    -- Determinar nuevo estado según flow
    IF v_request.flow_type = 'urban' THEN
      v_new_status := 'in_transit';
    ELSE
      v_new_status := 'in_consolidation';
    END IF;

    -- Vincular trip si se pasó
    UPDATE public.fulfillment_orders
    SET status = CASE WHEN v_new_status = 'in_transit' THEN 'in_transit'::fulfillment_status
                      ELSE 'in_consolidation'::fulfillment_status END,
        trip_id = COALESCE(p_trip_id, trip_id),
        current_custody_holder_id = v_user_id,
        current_custody_type = 'driver',
        current_location_type = 'in_transit',
        dispatched_at = COALESCE(dispatched_at, now()),
        dispatched_by = COALESCE(dispatched_by, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

    -- Actualizar pedido
    PERFORM public.fn_transition_request_status(
      v_fulfillment.branch_request_id,
      v_new_status,
      'Retiro realizado por operador',
      NULL,
      p_trip_id
    );

    -- Evento operativo
    INSERT INTO public.operational_events (
      reference_type, reference_id, event_type, category,
      triggered_by, event_description,
      new_custody_holder_id, new_status, previous_status
    ) VALUES (
      'fulfillment_order', p_fulfillment_id::text, 'driver_pickup', 'transport',
      v_user_id, 'Carga retirada por operador',
      v_user_id, v_new_status, v_fulfillment.status::text
    );

    RETURN jsonb_build_object('success', true, 'new_status', v_new_status, 'trip_id', p_trip_id);
  END IF;

  RAISE EXCEPTION 'Acción no soportada: %', p_action;
END;
$function$;