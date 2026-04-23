CREATE OR REPLACE FUNCTION public.fn_transition_request_status(
  p_request_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL::text,
  p_rejection_reason_type text DEFAULT NULL::text,
  p_trip_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_request RECORD;
  v_old_status TEXT;
  v_new_status request_status;
  v_user_id UUID;
  v_is_admin BOOLEAN;
  v_is_origin BOOLEAN;
  v_is_destination BOOLEAN;
  v_actor_allowed BOOLEAN := FALSE;
  v_is_parent BOOLEAN;
  v_event_type TEXT;
  v_event_description TEXT;
  v_event_category event_category;
  v_has_documents BOOLEAN;
  v_expected_doc_type TEXT;
  v_has_wrong_doc_type BOOLEAN;
  v_item_count INTEGER;
  v_flow_type TEXT;
  v_source_group TEXT;
  v_dest_group TEXT;
  v_transition_valid BOOLEAN := FALSE;
  v_trip_exists BOOLEAN;
  v_is_transport_operative BOOLEAN := FALSE;
  v_is_assignment_operative BOOLEAN := FALSE;
  v_source_is_hub BOOLEAN := FALSE;
  v_auto_consolidate BOOLEAN := FALSE;
  v_internal_sync TEXT;
  v_is_parent_request BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- ════════════════════════════════════════════════════════════
  -- GUARD: bloquear transiciones manuales sobre pedidos padre.
  -- El trigger interno de sincronización setea movilog.sync_parent_status='on'
  -- para poder actualizar el estado del padre derivado de los hijos.
  -- ════════════════════════════════════════════════════════════
  v_internal_sync := current_setting('movilog.sync_parent_status', true);
  IF v_internal_sync IS DISTINCT FROM 'on' THEN
    SELECT public.fn_is_parent_request(p_request_id) INTO v_is_parent_request;
    IF v_is_parent_request THEN
      RAISE EXCEPTION 'Los pedidos padre no aceptan transiciones manuales — su estado se deriva automáticamente de los pedidos hijos.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO v_request FROM public.branch_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  v_old_status := v_request.status::text;

  BEGIN
    v_new_status := p_new_status::request_status;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Estado inválido: %', p_new_status;
  END;

  IF v_request.flow_type IS NULL THEN
    IF v_request.delivery_target = 'client' THEN
      v_flow_type := 'client_delivery';
    ELSIF v_request.source_branch_id = v_request.requesting_branch_id THEN
      v_flow_type := 'urban';
    ELSE
      v_flow_type := 'interurban';
      SELECT logistic_group INTO v_source_group FROM public.branches WHERE id = v_request.source_branch_id;
      SELECT logistic_group INTO v_dest_group FROM public.branches WHERE id = v_request.requesting_branch_id;
      IF v_source_group IS NULL OR v_dest_group IS NULL THEN
        v_flow_type := 'interurban';
        INSERT INTO public.diagnostic_logs (step_name, table_name, error_message, payload)
        VALUES (
          'transition_status_fallback_interurban',
          'branch_requests',
          'Se usó fallback interurbano porque una sucursal no tiene logistic_group. Origen: ' || COALESCE(v_source_group, 'NULL') || ', Destino: ' || COALESCE(v_dest_group, 'NULL'),
          jsonb_build_object('source_branch_id', v_request.source_branch_id, 'requesting_branch_id', v_request.requesting_branch_id, 'source_group', v_source_group, 'dest_group', v_dest_group)
        );
      ELSIF v_source_group = v_dest_group THEN
        v_flow_type := 'urban';
      ELSE
        v_flow_type := 'interurban';
      END IF;
    END IF;
  ELSE
    v_flow_type := v_request.flow_type;
  END IF;

  IF v_flow_type = 'interurban' THEN
    SELECT COALESCE(is_central_warehouse, false) INTO v_source_is_hub
    FROM public.branches WHERE id = v_request.source_branch_id;
  END IF;

  IF v_flow_type IS NULL THEN
    v_transition_valid := (
      (v_old_status = 'pending' AND p_new_status IN ('accepted', 'rejected')) OR
      (v_old_status = 'in_preparation' AND p_new_status = 'in_transit') OR
      (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
      (v_old_status = 'delivered' AND p_new_status = 'received')
    );
  ELSIF v_old_status = 'pending' AND p_new_status IN ('accepted', 'rejected') THEN
    v_transition_valid := TRUE;
  ELSIF v_old_status = 'accepted' AND p_new_status IN ('picking', 'in_preparation') THEN
    v_transition_valid := TRUE;
  ELSIF v_old_status = 'picking' AND p_new_status = 'in_preparation' THEN
    v_transition_valid := TRUE;
  ELSIF v_flow_type = 'client_delivery' THEN
    v_transition_valid := (
      (v_old_status = 'in_preparation' AND p_new_status = 'ready_for_delivery') OR
      (v_old_status = 'ready_for_delivery' AND p_new_status = 'delivered_to_third_party')
    );
  ELSIF v_flow_type = 'urban' THEN
    v_transition_valid := (
      (v_old_status = 'in_preparation' AND p_new_status = 'ready_for_pickup') OR
      (v_old_status = 'ready_for_pickup' AND p_new_status = 'in_transit') OR
      (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
      (v_old_status = 'delivered' AND p_new_status = 'received') OR
      (v_old_status = 'received' AND p_new_status = 'logistic_closed') OR
      (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
    );
  ELSIF v_flow_type = 'interurban' THEN
    v_transition_valid := (
      (v_old_status = 'in_preparation' AND p_new_status = 'ready_for_pickup') OR
      (v_old_status = 'ready_for_pickup' AND p_new_status = 'in_consolidation') OR
      (v_old_status = 'in_consolidation' AND p_new_status = 'assigned_to_trip') OR
      (v_old_status = 'assigned_to_trip' AND p_new_status = 'in_consolidation') OR
      (v_old_status = 'assigned_to_trip' AND p_new_status = 'in_transit') OR
      (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
      (v_old_status = 'delivered' AND p_new_status = 'received') OR
      (v_old_status = 'received' AND p_new_status = 'logistic_closed') OR
      (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
    );
  END IF;

  IF NOT v_transition_valid THEN
    RAISE EXCEPTION 'Transición no permitida: % → % (flujo: %)', v_old_status, p_new_status, COALESCE(v_flow_type, 'legacy');
  END IF;

  IF p_new_status = 'assigned_to_trip' THEN
    IF v_flow_type != 'interurban' THEN
      RAISE EXCEPTION 'Solo pedidos interurbanos pueden asignarse a viaje (flow_type actual: %)', COALESCE(v_flow_type, 'NULL');
    END IF;
    IF p_trip_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar o crear un viaje para asignar el pedido';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip_id) INTO v_trip_exists;
    IF NOT v_trip_exists THEN
      RAISE EXCEPTION 'El viaje especificado no existe';
    END IF;
    UPDATE public.fulfillment_orders
    SET trip_id = p_trip_id, updated_at = now()
    WHERE branch_request_id = p_request_id AND trip_id IS NULL;
  END IF;

  IF v_old_status = 'assigned_to_trip' AND p_new_status = 'in_consolidation' THEN
    UPDATE public.fulfillment_orders
    SET trip_id = NULL, updated_at = now()
    WHERE branch_request_id = p_request_id;
  END IF;

  IF v_flow_type = 'urban'
     AND v_old_status = 'ready_for_pickup'
     AND p_new_status = 'in_transit'
     AND p_trip_id IS NOT NULL THEN

    INSERT INTO public.fulfillment_orders (
      branch_request_id, source_branch_id, destination_branch_id,
      shipping_method, status, trip_id,
      current_custody_type, current_custody_holder_id,
      current_location_type, current_location_branch_id,
      dispatched_at, dispatched_by, created_at, updated_at
    )
    SELECT
      p_request_id, v_request.source_branch_id, v_request.requesting_branch_id,
      v_request.shipping_method, 'in_transit'::fulfillment_status, p_trip_id,
      'driver', v_user_id,
      'vehicle', NULL,
      now(), v_user_id, now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id
    );

    UPDATE public.fulfillment_orders
    SET trip_id = p_trip_id,
        status = 'in_transit'::fulfillment_status,
        current_custody_type = 'driver',
        current_custody_holder_id = v_user_id,
        current_location_type = 'vehicle',
        current_location_branch_id = NULL,
        dispatched_at = COALESCE(dispatched_at, now()),
        dispatched_by = COALESCE(dispatched_by, v_user_id),
        updated_at = now()
    WHERE branch_request_id = p_request_id
      AND (trip_id IS NULL OR trip_id = p_trip_id);
  END IF;

  v_is_admin := has_role(v_user_id, 'admin'::app_role) OR has_role(v_user_id, 'supervisor'::app_role) OR is_owner(v_user_id);
  v_is_origin := can_access_branch(v_user_id, v_request.source_branch_id);
  v_is_destination := can_access_branch(v_user_id, v_request.requesting_branch_id);
  v_is_transport_operative := has_role(v_user_id, 'driver'::app_role)
                           OR has_role(v_user_id, 'warehouse_operator'::app_role)
                           OR has_role(v_user_id, 'jefe_logistica'::app_role)
                           OR has_role(v_user_id, 'admin'::app_role)
                           OR has_role(v_user_id, 'supervisor'::app_role)
                           OR is_owner(v_user_id);
  v_is_assignment_operative := has_role(v_user_id, 'warehouse_operator'::app_role)
                           OR has_role(v_user_id, 'jefe_logistica'::app_role)
                           OR has_role(v_user_id, 'admin'::app_role)
                           OR has_role(v_user_id, 'supervisor'::app_role)
                           OR is_owner(v_user_id);

  IF v_is_admin THEN
    v_actor_allowed := TRUE;
  ELSIF p_new_status IN ('in_preparation', 'rejected', 'ready_for_pickup', 'ready_for_delivery') THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status = 'delivered_to_third_party' THEN
    v_actor_allowed := v_is_origin OR v_is_transport_operative;
  ELSIF p_new_status = 'in_transit' AND v_old_status IN ('ready_for_pickup', 'assigned_to_trip') THEN
    v_actor_allowed := v_is_transport_operative;
  ELSIF p_new_status = 'in_consolidation' AND v_old_status = 'ready_for_pickup' THEN
    v_actor_allowed := v_is_transport_operative OR (v_source_is_hub AND v_is_origin);
  ELSIF p_new_status = 'in_consolidation' AND v_old_status = 'assigned_to_trip' THEN
    v_actor_allowed := v_is_assignment_operative;
  ELSIF p_new_status = 'delivered' THEN
    v_actor_allowed := v_is_transport_operative;
  ELSIF p_new_status IN ('received', 'logistic_closed', 'closed') THEN
    v_actor_allowed := v_is_destination OR v_is_admin;
  ELSIF p_new_status IN ('accepted', 'picking') THEN
    v_actor_allowed := v_is_origin;
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'No tienes permisos para ejecutar esta transición';
  END IF;

  IF (v_old_status = 'in_preparation' AND p_new_status IN ('ready_for_pickup', 'ready_for_delivery')) THEN
    SELECT COUNT(*) INTO v_item_count FROM public.branch_request_items WHERE request_id = p_request_id;
    IF v_item_count = 0 THEN
      RAISE EXCEPTION 'El pedido debe tener al menos un ítem para avanzar';
    END IF;
  END IF;

  UPDATE public.branch_requests
  SET status = v_new_status,
      rejection_reason = COALESCE(p_rejection_reason_type, rejection_reason),
      updated_at = now()
  WHERE id = p_request_id;

  v_auto_consolidate := (
    v_flow_type = 'interurban'
    AND v_source_is_hub
    AND p_new_status = 'ready_for_pickup'
  );

  IF v_auto_consolidate THEN
    UPDATE public.branch_requests
    SET status = 'in_consolidation'::request_status,
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE public.fulfillment_orders
    SET status = 'at_hub'::fulfillment_status,
        current_custody_type = 'branch',
        current_custody_holder_id = NULL,
        current_location_type = 'branch',
        current_location_branch_id = v_request.source_branch_id,
        trip_id = NULL,
        updated_at = now()
    WHERE branch_request_id = p_request_id
      AND status NOT IN ('delivered'::fulfillment_status, 'received'::fulfillment_status);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', p_request_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'flow_type', v_flow_type,
    'auto_consolidated', v_auto_consolidate
  );
END;
$function$;