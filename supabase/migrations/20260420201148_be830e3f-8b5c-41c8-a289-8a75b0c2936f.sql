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

    IF v_request.flow_type = 'urban' THEN
      v_new_status := 'in_transit';
    ELSE
      v_new_status := 'in_consolidation';
    END IF;

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

    v_new_status := 'in_consolidation';
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

  ELSIF p_action = 'drop_at_hub' THEN
    IF v_old_status NOT IN ('in_consolidation', 'in_transit') THEN
      RAISE EXCEPTION 'No se puede dejar en acopio en estado: %', v_old_status;
    END IF;

    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    IF NULLIF(p_metadata->>'hub_branch_id', '') IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el depósito o sucursal de acopio';
    END IF;

    v_new_status := 'at_hub';
    v_new_custody_type := 'branch';
    v_new_custody_holder := NULL;
    v_new_location_type := 'branch';
    v_new_location_branch := (p_metadata->>'hub_branch_id')::uuid;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_drop_at_hub';
    v_event_description := 'Carga dejada en acopio';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    -- Sincronizar branch_request: pasa a in_consolidation cuando queda en acopio
    IF v_fulfillment.branch_request_id IS NOT NULL THEN
      UPDATE public.branch_requests
      SET status = 'in_consolidation'::request_status,
          current_location_branch_id = v_new_location_branch,
          current_custody_holder_id = NULL,
          updated_at = now()
      WHERE id = v_fulfillment.branch_request_id
        AND status::text IN ('in_transit', 'in_consolidation');
    END IF;

  ELSIF p_action = 'deliver_branch' THEN
    IF v_old_status NOT IN ('in_consolidation', 'in_transit') THEN
      RAISE EXCEPTION 'No se puede entregar en sucursal en estado: %', v_old_status;
    END IF;

    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := 'delivered';
    v_new_custody_type := 'branch';
    v_new_custody_holder := NULL;
    v_new_location_type := 'branch';
    v_new_location_branch := v_fulfillment.destination_branch_id;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_to_branch';
    v_event_description := 'Entregado en sucursal destino';
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        received_at = COALESCE(received_at, now()),
        received_by = COALESCE(received_by, v_user_id),
        received_at_branch = COALESCE(received_at_branch, now()),
        received_by_branch = COALESCE(received_by_branch, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

    PERFORM public.fn_transition_request_status(
      v_fulfillment.branch_request_id,
      'delivered',
      'Entregado en sucursal destino',
      NULL,
      v_old_trip_id
    );

  ELSIF p_action = 'deliver_customer' THEN
    IF v_old_status NOT IN ('in_consolidation', 'in_transit') THEN
      RAISE EXCEPTION 'No se puede entregar al cliente en estado: %', v_old_status;
    END IF;

    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := 'delivered';
    v_new_custody_type := 'customer';
    v_new_custody_holder := NULL;
    v_new_location_type := 'customer';
    v_new_location_branch := NULL;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_to_customer';
    v_event_description := 'Entregado al cliente';
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        received_at = COALESCE(received_at, now()),
        received_by = COALESCE(received_by, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

    PERFORM public.fn_transition_request_status(
      v_fulfillment.branch_request_id,
      'delivered',
      'Entregado al cliente',
      NULL,
      v_old_trip_id
    );

  ELSIF p_action = 'delivery_failed' THEN
    IF v_old_status NOT IN ('in_consolidation', 'in_transit') THEN
      RAISE EXCEPTION 'No se puede registrar entrega fallida en estado: %', v_old_status;
    END IF;

    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := v_old_status;
    v_new_custody_type := v_old_custody_type;
    v_new_custody_holder := v_old_custody_holder;
    v_new_location_type := v_old_location_type;
    v_new_location_branch := v_old_location_branch;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_failed';
    v_event_description := COALESCE(NULLIF(p_metadata->>'reason', ''), 'Entrega fallida');
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET delivery_failed_at = now(),
        delivery_failed_reason = COALESCE(NULLIF(p_metadata->>'reason', ''), delivery_failed_reason),
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'transfer_to_driver' THEN
    IF v_old_status NOT IN ('in_consolidation', 'in_transit') THEN
      RAISE EXCEPTION 'No se puede transferir en estado: %', v_old_status;
    END IF;

    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    IF NULLIF(p_metadata->>'target_user_id', '') IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el operador destino';
    END IF;

    SELECT id, user_id
    INTO v_target_driver
    FROM public.drivers
    WHERE user_id = (p_metadata->>'target_user_id')::uuid
      AND COALESCE(is_active, true) = true
    LIMIT 1;

    v_new_status := v_old_status;
    v_new_custody_type := 'driver';
    v_new_custody_holder := (p_metadata->>'target_user_id')::uuid;
    v_new_location_type := v_old_location_type;
    v_new_location_branch := v_old_location_branch;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_custody_transfer';
    v_event_description := 'Custodia transferida a otro operador';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSE
    RAISE EXCEPTION 'Acción no reconocida: %', p_action;
  END IF;

  INSERT INTO public.operational_events (
    reference_type,
    reference_id,
    event_type,
    event_description,
    category,
    previous_status,
    new_status,
    previous_custody_holder_id,
    new_custody_holder_id,
    previous_location_branch_id,
    new_location_branch_id,
    triggered_by,
    metadata
  ) VALUES (
    'fulfillment_order',
    p_fulfillment_id,
    v_event_type,
    v_event_description,
    v_event_category,
    v_old_status,
    v_new_status,
    v_old_custody_holder,
    v_new_custody_holder,
    v_old_location_branch,
    v_new_location_branch,
    v_user_id,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'old_location_type', v_old_location_type,
      'new_location_type', v_new_location_type,
      'old_custody_type', v_old_custody_type,
      'new_custody_type', v_new_custody_type,
      'trip_id', v_new_trip_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'fulfillment_id', p_fulfillment_id,
    'new_status', v_new_status,
    'trip_id', v_new_trip_id
  );
END;
$function$;