CREATE OR REPLACE FUNCTION public.fn_transition_request_status(p_request_id uuid, p_new_status text, p_reason text DEFAULT NULL::text, p_rejection_reason_type text DEFAULT NULL::text, p_trip_id uuid DEFAULT NULL::uuid)
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
  v_fo_exists BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

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

  IF v_old_status IN ('accepted', 'in_preparation') AND p_new_status = 'rejected' THEN
    v_transition_valid := TRUE;
  ELSIF v_flow_type IS NULL THEN
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

    SELECT EXISTS (
      SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id
    ) INTO v_fo_exists;

    IF NOT v_fo_exists THEN
      INSERT INTO public.fulfillment_orders (
        branch_request_id, source_branch_id, destination_branch_id,
        shipping_method, status, trip_id,
        current_custody_type, current_custody_holder_id,
        current_location_type, current_location_branch_id,
        created_at, updated_at
      ) VALUES (
        p_request_id, v_request.source_branch_id, v_request.requesting_branch_id,
        v_request.shipping_method, 'at_hub'::fulfillment_status, p_trip_id,
        'branch', NULL,
        'branch', v_request.source_branch_id,
        now(), now()
      );
    ELSE
      UPDATE public.fulfillment_orders
      SET trip_id = p_trip_id, updated_at = now()
      WHERE branch_request_id = p_request_id AND trip_id IS NULL;
    END IF;
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
  ELSIF p_new_status = 'assigned_to_trip' AND v_old_status = 'in_consolidation' THEN
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
      rejection_reason = CASE
        WHEN p_new_status = 'rejected' THEN COALESCE(p_reason, rejection_reason)
        ELSE rejection_reason
      END,
      rejection_reason_type = CASE
        WHEN p_new_status = 'rejected' AND p_rejection_reason_type IS NOT NULL
          THEN p_rejection_reason_type::public.rejection_reason_type
        ELSE rejection_reason_type
      END,
      rejected_by = CASE
        WHEN p_new_status = 'rejected' THEN COALESCE(v_user_id, rejected_by)
        ELSE rejected_by
      END,
      rejected_at = CASE
        WHEN p_new_status = 'rejected' THEN now()
        ELSE rejected_at
      END,
      updated_at = now()
  WHERE id = p_request_id;

  IF p_new_status = 'rejected' THEN
    UPDATE public.fulfillment_orders
    SET status = 'cancelled'::fulfillment_status,
        trip_id = NULL,
        updated_at = now()
    WHERE branch_request_id = p_request_id
      AND status NOT IN ('completed'::fulfillment_status,
                         'cancelled'::fulfillment_status,
                         'received'::fulfillment_status,
                         'logistic_closed'::fulfillment_status);
  END IF;

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

CREATE OR REPLACE FUNCTION public.fn_saneamiento_lanzamiento(
  p_cutoff timestamptz,
  p_actor uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req RECORD;
  v_path TEXT[];
  v_step TEXT;
  v_current TEXT;
  v_now TEXT;
  v_trip_id UUID;
  v_flow TEXT;
  v_counts jsonb := '{}'::jsonb;
  v_huecos jsonb := '[]'::jsonb;
  v_padres jsonb := '[]'::jsonb;
  v_key TEXT;
  v_already BOOLEAN;
  v_is_parent BOOLEAN;
  v_closed INT := 0;
  v_rejected INT := 0;
  v_closed_indirecto INT := 0;
  v_fo_synced INT := 0;
  v_fo_rows INT := 0;
  v_fo_huerfanas INT := 0;
  v_incidencias INT := 0;
  v_remanentes INT := 0;
  v_report jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor es obligatorio (usuario de sistema SANEAMIENTO)';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_actor::text, 'role', 'authenticated')::text,
    true
  );

  FOR v_req IN
    SELECT br.id, br.status::text AS status, br.flow_type, br.request_number
    FROM public.branch_requests br
    WHERE br.created_at < p_cutoff
      AND br.is_pre_sale = false
      AND br.status::text IN (
        'pending','accepted','in_preparation','ready_for_pickup','ready_for_delivery',
        'in_consolidation','assigned_to_trip','in_transit','delivered',
        'delivered_to_third_party','received','logistic_closed','in_supply','supplied'
      )
    ORDER BY br.created_at
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE reference_id = v_req.id
        AND reference_type = 'branch_request'
        AND metadata->>'motivo' = 'saneamiento_lanzamiento'
    ) INTO v_already;
    IF v_already THEN CONTINUE; END IF;

    SELECT public.fn_is_parent_request(v_req.id) INTO v_is_parent;
    IF v_is_parent THEN
      v_padres := v_padres || jsonb_build_object(
        'request_id', v_req.id,
        'request_number', v_req.request_number,
        'status', v_req.status,
        'nota', 'Pedido padre multi-origen: cierra solo cuando cierren todos sus hijos'
      );
      CONTINUE;
    END IF;

    v_flow := COALESCE(v_req.flow_type, 'interurban');
    v_path := CASE v_req.status
      WHEN 'pending' THEN ARRAY['rejected']
      WHEN 'accepted' THEN ARRAY['rejected']
      WHEN 'in_preparation' THEN ARRAY['rejected']
      WHEN 'ready_for_pickup' THEN
        CASE WHEN v_flow = 'interurban'
          THEN ARRAY['in_consolidation','assigned_to_trip','in_transit','delivered','received','logistic_closed','closed']
          ELSE ARRAY['in_transit','delivered','received','logistic_closed','closed']
        END
      WHEN 'in_consolidation' THEN ARRAY['assigned_to_trip','in_transit','delivered','received','logistic_closed','closed']
      WHEN 'assigned_to_trip' THEN ARRAY['in_transit','delivered','received','logistic_closed','closed']
      WHEN 'in_transit' THEN ARRAY['delivered','received','logistic_closed','closed']
      WHEN 'delivered' THEN ARRAY['received','logistic_closed','closed']
      WHEN 'received' THEN ARRAY['logistic_closed','closed']
      WHEN 'logistic_closed' THEN ARRAY['closed']
      ELSE NULL
    END;

    IF v_path IS NULL THEN
      v_huecos := v_huecos || jsonb_build_object(
        'request_id', v_req.id,
        'request_number', v_req.request_number,
        'status', v_req.status,
        'motivo', 'Estado sin camino a terminal en la matriz de transiciones'
      );
      CONTINUE;
    END IF;

    IF 'assigned_to_trip' = ANY(v_path) THEN
      SELECT fo.trip_id INTO v_trip_id
      FROM public.fulfillment_orders fo
      WHERE fo.branch_request_id = v_req.id AND fo.trip_id IS NOT NULL
      ORDER BY fo.created_at DESC
      LIMIT 1;
      IF v_trip_id IS NULL THEN
        v_huecos := v_huecos || jsonb_build_object(
          'request_id', v_req.id,
          'request_number', v_req.request_number,
          'status', v_req.status,
          'motivo', 'Requiere assigned_to_trip pero no tiene viaje asociado'
        );
        CONTINUE;
      END IF;
    ELSE
      v_trip_id := NULL;
    END IF;

    IF p_dry_run THEN
      v_key := v_req.status || ' -> ' || v_path[array_length(v_path, 1)];
      v_counts := jsonb_set(v_counts, ARRAY[v_key], to_jsonb(COALESCE((v_counts ->> v_key)::int, 0) + 1));
      CONTINUE;
    END IF;

    BEGIN
      SELECT br.status::text INTO v_now FROM public.branch_requests br WHERE br.id = v_req.id;
      IF v_now IS DISTINCT FROM v_req.status THEN
        IF v_now IN ('closed', 'rejected') THEN
          v_closed_indirecto := v_closed_indirecto + 1;
        ELSE
          v_huecos := v_huecos || jsonb_build_object(
            'request_id', v_req.id,
            'request_number', v_req.request_number,
            'status', v_req.status,
            'motivo', 'El estado cambio durante el run (ahora: ' || COALESCE(v_now, 'NULL') || ')'
          );
        END IF;
        CONTINUE;
      END IF;

      v_current := v_req.status;
      FOREACH v_step IN ARRAY v_path LOOP
        PERFORM public.fn_transition_request_status(
          v_req.id,
          v_step,
          'saneamiento_lanzamiento',
          CASE WHEN v_step = 'rejected' THEN 'other' ELSE NULL END,
          CASE WHEN v_step = 'assigned_to_trip' THEN v_trip_id ELSE NULL END
        );
        INSERT INTO public.operational_events (
          category, reference_id, reference_type, event_type, event_description,
          previous_status, new_status, triggered_by, metadata
        ) VALUES (
          'closure', v_req.id, 'branch_request', 'saneamiento_transition',
          'Saneamiento lanzamiento: ' || v_current || ' -> ' || v_step,
          v_current, v_step, p_actor,
          jsonb_build_object('motivo', 'saneamiento_lanzamiento')
        );
        v_current := v_step;
      END LOOP;

      IF v_current = 'closed' THEN
        UPDATE public.fulfillment_orders
        SET status = 'completed'::fulfillment_status, updated_at = now()
        WHERE branch_request_id = v_req.id
          AND status NOT IN ('completed'::fulfillment_status, 'cancelled'::fulfillment_status,
                             'received'::fulfillment_status, 'logistic_closed'::fulfillment_status);
        GET DIAGNOSTICS v_fo_rows = ROW_COUNT;
        v_fo_synced := v_fo_synced + v_fo_rows;
        v_closed := v_closed + 1;
      ELSE
        v_rejected := v_rejected + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_huecos := v_huecos || jsonb_build_object(
        'request_id', v_req.id,
        'request_number', v_req.request_number,
        'status', v_req.status,
        'motivo', SQLERRM
      );
    END;
  END LOOP;

  SELECT count(*) INTO v_fo_huerfanas
  FROM public.fulfillment_orders fo
  JOIN public.branch_requests br ON br.id = fo.branch_request_id
  WHERE fo.created_at < p_cutoff
    AND fo.status NOT IN ('completed'::fulfillment_status, 'cancelled'::fulfillment_status,
                          'received'::fulfillment_status, 'logistic_closed'::fulfillment_status)
    AND br.status::text IN ('closed', 'rejected', 'received', 'logistic_closed');

  IF NOT p_dry_run THEN
    UPDATE public.fulfillment_orders fo
    SET status = CASE WHEN br.status::text = 'rejected'
                      THEN 'cancelled'::fulfillment_status
                      ELSE 'completed'::fulfillment_status END,
        updated_at = now()
    FROM public.branch_requests br
    WHERE br.id = fo.branch_request_id
      AND fo.created_at < p_cutoff
      AND fo.status NOT IN ('completed'::fulfillment_status, 'cancelled'::fulfillment_status,
                            'received'::fulfillment_status, 'logistic_closed'::fulfillment_status)
      AND br.status::text IN ('closed', 'rejected', 'received', 'logistic_closed');
    GET DIAGNOSTICS v_fo_rows = ROW_COUNT;
    v_fo_synced := v_fo_synced + v_fo_rows;

    UPDATE public.logistics_incidents
    SET status = 'closed'::incident_status,
        resolution = 'saneamiento_lanzamiento',
        resolved_by = p_actor,
        resolved_at = now(),
        updated_at = now()
    WHERE created_at < p_cutoff
      AND status IN ('open'::incident_status, 'under_review'::incident_status, 'escalated'::incident_status);
    GET DIAGNOSTICS v_incidencias = ROW_COUNT;

    SELECT count(*) INTO v_remanentes
    FROM public.branch_requests
    WHERE created_at < p_cutoff
      AND is_pre_sale = false
      AND status::text IN (
        'pending','accepted','in_preparation','ready_for_pickup','ready_for_delivery',
        'in_consolidation','assigned_to_trip','in_transit','delivered',
        'delivered_to_third_party','received','logistic_closed','in_supply','supplied'
      );
  ELSE
    SELECT count(*) INTO v_incidencias
    FROM public.logistics_incidents
    WHERE created_at < p_cutoff
      AND status IN ('open'::incident_status, 'under_review'::incident_status, 'escalated'::incident_status);
  END IF;

  v_report := jsonb_build_object(
    'dry_run', p_dry_run,
    'cutoff', p_cutoff,
    'actor', p_actor,
    'conteos', v_counts,
    'cerrados', v_closed,
    'rechazados', v_rejected,
    'cerrados_indirectos', v_closed_indirecto,
    'fulfillments_sincronizadas', v_fo_synced,
    'fulfillments_huerfanas', v_fo_huerfanas,
    'incidencias_cerradas', v_incidencias,
    'remanentes_activos', v_remanentes,
    'padres_multiorigen', v_padres,
    'huecos', v_huecos,
    'ejecutado_at', now()
  );

  INSERT INTO public.diagnostic_logs (step_name, table_name, error_message, payload)
  VALUES (
    'saneamiento_lanzamiento',
    'branch_requests',
    CASE WHEN p_dry_run THEN 'DRY-RUN (sin escritura)' ELSE 'RUN REAL' END,
    v_report
  );

  RETURN v_report;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_saneamiento_lanzamiento(timestamptz, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_saneamiento_lanzamiento(timestamptz, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.fn_saneamiento_lanzamiento(timestamptz, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saneamiento_lanzamiento(timestamptz, uuid, boolean) TO service_role;