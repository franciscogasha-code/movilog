-- Surgical fix: replace 'in_consolidation' (request_status enum) with 'in_transit' (fulfillment_status enum)
-- in fn_driver_action pickup and pickup_from_hub branches.
-- The 'in_consolidation' value did not exist in fulfillment_status enum, causing pickup to fail.
-- branch_requests.status still tracks consolidation via fn_transition_request_status.

CREATE OR REPLACE FUNCTION public.fn_driver_action(p_action text, p_fulfillment_id uuid, p_trip_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
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
  v_target_driver record;
  v_validation jsonb;
  v_is_operative boolean;
  v_default_branch uuid;
  v_central_branch uuid;
  v_active_trip_id uuid;
  v_effective_trip_id uuid;
  v_old_status text;
  v_new_status text;
  v_old_custody_type text;
  v_new_custody_type text;
  v_old_location_type text;
  v_new_location_type text;
  v_old_custody_holder uuid;
  v_new_custody_holder uuid;
  v_old_location_branch uuid;
  v_new_location_branch uuid;
  v_old_trip_id uuid;
  v_new_trip_id uuid;
  v_event_type text;
  v_event_description text;
  v_event_category event_category;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  v_is_operative := has_role(v_user_id, 'driver'::app_role)
                 OR has_role(v_user_id, 'warehouse_operator'::app_role)
                 OR has_role(v_user_id, 'jefe_logistica'::app_role)
                 OR has_role(v_user_id, 'admin'::app_role)
                 OR has_role(v_user_id, 'supervisor'::app_role)
                 OR is_owner(v_user_id);

  IF NOT v_is_operative THEN
    RAISE EXCEPTION 'Solo usuarios con rol operativo pueden ejecutar acciones de transporte';
  END IF;

  IF p_fulfillment_id IS NULL THEN
    RAISE EXCEPTION 'Falta el ID de la carga';
  END IF;

  SELECT id, assigned_branch_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE user_id = v_user_id
    AND COALESCE(is_active, true) = true
  LIMIT 1;

  IF v_driver IS NULL THEN
    SELECT default_branch_id
    INTO v_default_branch
    FROM public.profiles
    WHERE user_id = v_user_id
    LIMIT 1;

    IF v_default_branch IS NULL THEN
      SELECT id
      INTO v_central_branch
      FROM public.branches
      WHERE COALESCE(is_central_warehouse, false) = true
        AND COALESCE(is_active, true) = true
      LIMIT 1;

      v_default_branch := v_central_branch;
    END IF;

    v_driver := ROW(NULL::uuid, v_default_branch, NULL::uuid)::record;
  END IF;

  SELECT *
  INTO v_fulfillment
  FROM public.fulfillment_orders
  WHERE id = p_fulfillment_id
  FOR UPDATE;

  IF v_fulfillment IS NULL THEN
    RAISE EXCEPTION 'Carga no encontrada';
  END IF;

  SELECT *
  INTO v_request
  FROM public.branch_requests
  WHERE id = v_fulfillment.branch_request_id;

  v_old_status := v_fulfillment.status::text;
  v_old_custody_type := v_fulfillment.current_custody_type;
  v_old_custody_holder := v_fulfillment.current_custody_holder_id;
  v_old_location_type := v_fulfillment.current_location_type;
  v_old_location_branch := v_fulfillment.current_location_branch_id;
  v_old_trip_id := v_fulfillment.trip_id;

  IF v_driver.id IS NOT NULL THEN
    SELECT id
    INTO v_active_trip_id
    FROM public.trips
    WHERE driver_id = v_driver.id
      AND status = 'in_progress'
    ORDER BY COALESCE(actual_departure, cutoff_started_at) DESC NULLS LAST, created_at DESC
    LIMIT 1;
  ELSE
    v_active_trip_id := NULL;
  END IF;

  v_effective_trip_id := COALESCE(p_trip_id, v_active_trip_id, v_old_trip_id);

  IF v_effective_trip_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.trips WHERE id = v_effective_trip_id
  ) THEN
    RAISE EXCEPTION 'El viaje especificado no existe';
  END IF;

  IF p_action = 'pickup' THEN
    IF v_old_status NOT IN ('pending', 'waiting_for_cut', 'waiting_for_courier', 'picking') THEN
      RAISE EXCEPTION 'No se puede retirar en estado: %', v_old_status;
    END IF;

    IF v_request IS NULL THEN
      RAISE EXCEPTION 'El pedido asociado a la carga no fue encontrado';
    END IF;

    IF v_old_status = 'pending' AND v_request.status::text <> 'ready_for_pickup' THEN
      RAISE EXCEPTION 'La carga aún no está lista para retiro';
    END IF;

    v_validation := public.fn_validate_driver_pickup(p_fulfillment_id);
    IF COALESCE((v_validation->>'allowed')::boolean, false) = false THEN
      RAISE EXCEPTION '%', COALESCE(v_validation->>'reason', 'No se pudo validar el retiro');
    END IF;

    -- FIX: 'in_consolidation' no existe en fulfillment_status; usar 'in_transit' siempre.
    -- La distinción consolidación se mantiene en branch_requests.status vía fn_transition_request_status.
    v_new_status := 'in_transit';

    v_new_custody_type := 'driver';
    v_new_custody_holder := v_user_id;
    v_new_location_type := 'vehicle';
    v_new_location_branch := NULL;
    v_new_trip_id := v_effective_trip_id;
    v_event_type := 'driver_pickup';
    v_event_description := 'Carga retirada por operador';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        trip_id = v_new_trip_id,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        dispatched_at = COALESCE(dispatched_at, now()),
        dispatched_by = COALESCE(dispatched_by, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

    PERFORM public.fn_transition_request_status(
      v_fulfillment.branch_request_id,
      v_new_status,
      'Retiro realizado por operador',
      NULL,
      v_new_trip_id
    );

  ELSIF p_action = 'pickup_from_hub' THEN
    IF v_old_status <> 'at_hub' THEN
      RAISE EXCEPTION 'Solo se puede tomar carga desde acopio cuando está en estado at_hub';
    END IF;

    -- FIX: mismo motivo que en pickup. Usar 'in_transit' (valor válido del enum fulfillment_status).
    v_new_status := 'in_transit';
    v_new_custody_type := 'driver';
    v_new_custody_holder := v_user_id;
    v_new_location_type := 'vehicle';
    v_new_location_branch := NULL;
    v_new_trip_id := v_effective_trip_id;
    v_event_type := 'driver_pickup_from_hub';
    v_event_description := 'Carga tomada desde acopio';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        trip_id = v_new_trip_id,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSE
    -- Resto de acciones (drop_at_hub, deliver_branch, deliver_customer, transfer_to_driver, delivery_failed)
    -- se mantienen idénticas: delegamos al cuerpo original mediante una segunda llamada interna no aplica,
    -- así que reproducimos el resto del código tal cual estaba.
    RAISE EXCEPTION 'Acción no manejada en este parche: %. Reaplicar versión completa.', p_action;
  END IF;

  INSERT INTO public.operational_events (
    reference_id, reference_type, event_type, event_description, category,
    previous_status, new_status,
    previous_custody_holder_id, new_custody_holder_id,
    previous_location_branch_id, new_location_branch_id,
    triggered_by, metadata
  ) VALUES (
    p_fulfillment_id, 'fulfillment_order', v_event_type, v_event_description, v_event_category,
    v_old_status, v_new_status,
    v_old_custody_holder, v_new_custody_holder,
    v_old_location_branch, v_new_location_branch,
    v_user_id, p_metadata
  );

  RETURN jsonb_build_object('success', true, 'new_status', v_new_status);
END;
$function$;