CREATE OR REPLACE FUNCTION public.fn_driver_action(p_fulfillment_id uuid, p_action text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fulfillment RECORD;
  v_user_id uuid;
  v_driver RECORD;
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
  v_active_trip_id uuid;
  v_target_driver RECORD;
  v_validation jsonb;
  v_request_flow_type text;
  v_request_id uuid;
  v_is_operative boolean;
  v_default_branch uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- UNIFICADO: chofer y operador_logistico son operativamente equivalentes.
  -- jefe_logistica / admin / supervisor / owner pueden operar también.
  v_is_operative := has_role(v_user_id, 'driver'::app_role)
                 OR has_role(v_user_id, 'operador_logistico'::app_role)
                 OR has_role(v_user_id, 'jefe_logistica'::app_role)
                 OR has_role(v_user_id, 'admin'::app_role)
                 OR has_role(v_user_id, 'supervisor'::app_role)
                 OR is_owner(v_user_id);

  IF NOT v_is_operative THEN
    RAISE EXCEPTION 'No tenés permiso para ejecutar acciones operativas';
  END IF;

  -- Buscar registro de chofer; si no existe, usamos perfil operativo virtual.
  SELECT id, assigned_branch_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE user_id = v_user_id AND is_active = true;

  IF v_driver IS NULL THEN
    -- Perfil virtual: tomamos sucursal por defecto del profile o, en su defecto,
    -- el depósito central / primera sucursal activa.
    SELECT default_branch_id INTO v_default_branch
    FROM public.profiles WHERE user_id = v_user_id;

    IF v_default_branch IS NULL THEN
      SELECT id INTO v_default_branch FROM public.branches
      WHERE is_active = true AND is_central_warehouse = true LIMIT 1;
    END IF;

    IF v_default_branch IS NULL THEN
      SELECT id INTO v_default_branch FROM public.branches
      WHERE is_active = true ORDER BY created_at LIMIT 1;
    END IF;

    v_driver := ROW(NULL::uuid, v_default_branch, NULL::uuid)::record;
  END IF;

  SELECT * INTO v_fulfillment
  FROM public.fulfillment_orders
  WHERE id = p_fulfillment_id
  FOR UPDATE;

  IF v_fulfillment IS NULL THEN
    RAISE EXCEPTION 'Fulfillment no encontrado';
  END IF;

  v_old_status := v_fulfillment.status::text;
  v_old_custody_type := v_fulfillment.current_custody_type;
  v_old_custody_holder := v_fulfillment.current_custody_holder_id;
  v_old_location_type := v_fulfillment.current_location_type;
  v_old_location_branch := v_fulfillment.current_location_branch_id;
  v_old_trip_id := v_fulfillment.trip_id;

  SELECT id INTO v_active_trip_id
  FROM public.trips
  WHERE driver_id = v_driver.id AND status = 'in_progress'
  ORDER BY started_at DESC LIMIT 1;

  IF p_action = 'pickup' THEN
    IF v_old_status NOT IN ('pending','waiting_for_cut','waiting_for_courier','picking') THEN
      RAISE EXCEPTION 'No se puede retirar en estado: %', v_old_status;
    END IF;
    v_validation := fn_validate_pickup_documentation(p_fulfillment_id);
    IF NOT (v_validation->>'allowed')::boolean THEN
      RAISE EXCEPTION '%', v_validation->>'reason';
    END IF;
    v_new_status := 'in_consolidation';
    v_new_custody_type := 'driver';
    v_new_custody_holder := v_user_id;
    v_new_location_type := 'in_transit';
    v_new_location_branch := NULL;
    v_new_trip_id := v_active_trip_id;
    v_event_type := 'pickup';
    v_event_description := 'Carga retirada por chofer';
    v_event_category := 'pickup'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        trip_id = v_new_trip_id,
        dispatched_at = COALESCE(dispatched_at, now()),
        dispatched_by = COALESCE(dispatched_by, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'leave_at_hub' THEN
    IF v_old_status NOT IN ('in_consolidation','in_transit') THEN
      RAISE EXCEPTION 'No se puede dejar en acopio en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;
    IF (p_metadata->>'hub_branch_id') IS NULL THEN
      RAISE EXCEPTION 'Debe indicar la sucursal/depósito de acopio';
    END IF;
    v_new_status := 'at_hub';
    v_new_custody_type := 'branch';
    v_new_custody_holder := NULL;
    v_new_location_type := 'branch';
    v_new_location_branch := (p_metadata->>'hub_branch_id')::uuid;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'leave_at_hub';
    v_event_description := 'Dejado en acopio';
    v_event_category := 'custody_change'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'pickup_from_hub' THEN
    IF v_old_status <> 'at_hub' THEN
      RAISE EXCEPTION 'Solo se puede tomar carga en estado at_hub, actual: %', v_old_status;
    END IF;
    v_new_status := 'in_consolidation';
    v_new_custody_type := 'driver';
    v_new_custody_holder := v_user_id;
    v_new_location_type := 'in_transit';
    v_new_location_branch := NULL;
    v_new_trip_id := v_active_trip_id;
    v_event_type := 'pickup_from_hub';
    v_event_description := 'Tomado desde acopio';
    v_event_category := 'pickup'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        trip_id = v_new_trip_id,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'deliver_to_branch' THEN
    IF v_old_status NOT IN ('in_consolidation','in_transit') THEN
      RAISE EXCEPTION 'No se puede entregar en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;
    v_new_status := 'delivered_to_branch';
    v_new_custody_type := 'branch';
    v_new_custody_holder := NULL;
    v_new_location_type := 'branch';
    v_new_location_branch := v_fulfillment.destination_branch_id;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'deliver_to_branch';
    v_event_description := 'Entregado en sucursal destino';
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        received_at = now(),
        received_by = v_user_id,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'deliver_to_client' THEN
    IF v_old_status NOT IN ('in_consolidation','in_transit') THEN
      RAISE EXCEPTION 'No se puede entregar en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;
    v_new_status := 'delivered_to_third_party';
    v_new_custody_type := 'delivered';
    v_new_custody_holder := NULL;
    v_new_location_type := 'client';
    v_new_location_branch := NULL;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'deliver_to_client';
    v_event_description := 'Entregado al cliente';
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = v_new_custody_type,
        current_custody_holder_id = v_new_custody_holder,
        current_location_type = v_new_location_type,
        current_location_branch_id = v_new_location_branch,
        received_at = now(),
        received_by = v_user_id,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'delivery_failed' THEN
    IF v_old_status NOT IN ('in_consolidation','in_transit') THEN
      RAISE EXCEPTION 'No se puede registrar entrega fallida en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;
    v_new_status := 'delivery_failed';
    v_new_custody_type := v_old_custody_type;
    v_new_custody_holder := v_old_custody_holder;
    v_new_location_type := v_old_location_type;
    v_new_location_branch := v_old_location_branch;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'delivery_failed';
    v_event_description := COALESCE(p_metadata->>'reason', 'Entrega fallida');
    v_event_category := 'delivery'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        delivery_failed_at = now(),
        delivery_failed_reason = p_metadata->>'reason',
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'transfer_custody' THEN
    IF v_old_custody_holder IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;
    IF (p_metadata->>'target_user_id') IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el chofer destino';
    END IF;
    SELECT id, user_id INTO v_target_driver
    FROM public.drivers WHERE user_id = (p_metadata->>'target_user_id')::uuid AND is_active = true;
    IF v_target_driver IS NULL THEN
      RAISE EXCEPTION 'El chofer destino no está activo';
    END IF;
    v_new_status := v_old_status;
    v_new_custody_type := 'driver';
    v_new_custody_holder := v_target_driver.user_id;
    v_new_location_type := v_old_location_type;
    v_new_location_branch := v_old_location_branch;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'transfer_custody';
    v_event_description := 'Custodia transferida';
    v_event_category := 'custody_change'::event_category;

    UPDATE public.fulfillment_orders
    SET current_custody_holder_id = v_new_custody_holder,
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSE
    RAISE EXCEPTION 'Acción no reconocida: %', p_action;
  END IF;

  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, event_description, event_category,
    triggered_by, previous_status, new_status,
    previous_custody_holder_id, new_custody_holder_id,
    previous_location_branch_id, new_location_branch_id, metadata
  ) VALUES (
    'fulfillment_order', p_fulfillment_id, v_event_type, v_event_description, v_event_category,
    v_user_id, v_old_status, v_new_status,
    v_old_custody_holder, v_new_custody_holder,
    v_old_location_branch, v_new_location_branch, p_metadata
  );

  RETURN jsonb_build_object('success', true, 'new_status', v_new_status, 'trip_id', v_new_trip_id);
END;
$function$;