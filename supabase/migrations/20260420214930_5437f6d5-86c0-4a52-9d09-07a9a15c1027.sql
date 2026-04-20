-- ─────────────────────────────────────────────────────────────
-- A. Restaurar función 4-args con la corrección de flow_type
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_transition_request_status(p_request_id uuid, p_new_status text, p_reason text DEFAULT NULL::text, p_rejection_reason_type text DEFAULT NULL::text)
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  BEGIN
    v_new_status := p_new_status::request_status;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Estado inválido: %', p_new_status;
  END;

  SELECT * INTO v_request FROM public.branch_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado: %', p_request_id; END IF;

  v_old_status := v_request.status::text;
  IF v_old_status = p_new_status THEN RAISE EXCEPTION 'El pedido ya está en estado %', p_new_status; END IF;

  IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
    -- client_delivery SOLO cuando el origen entrega a un tercero externo (courier/delivery)
    IF v_request.request_type IN ('client', 'online')
       AND v_request.delivery_target = 'client'
       AND v_request.shipping_method::text IN ('courier', 'delivery') THEN
      v_flow_type := 'client_delivery';
    ELSIF v_request.consolidation_override = false THEN
      v_flow_type := 'urban';
    ELSIF v_request.consolidation_override = true THEN
      v_flow_type := 'interurban';
    ELSE
      SELECT logistic_group INTO v_source_group FROM public.branches WHERE id = v_request.source_branch_id;
      SELECT logistic_group INTO v_dest_group FROM public.branches WHERE id = v_request.requesting_branch_id;

      IF v_source_group IS NULL OR v_dest_group IS NULL THEN
        v_flow_type := 'interurban';
        INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities, supporting_data)
        VALUES (
          'missing_logistic_group', 'logistics', 'warning', 'branch_operational',
          'Sucursal sin grupo logístico configurado',
          'Se usó fallback interurbano porque una sucursal no tiene logistic_group. Origen: ' || COALESCE(v_source_group, 'NULL') || ', Destino: ' || COALESCE(v_dest_group, 'NULL'),
          jsonb_build_array(jsonb_build_object('type', 'branch_request', 'id', p_request_id)),
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

  IF v_flow_type IS NULL THEN
    v_transition_valid := (
      (v_old_status = 'pending' AND p_new_status IN ('in_preparation', 'rejected')) OR
      (v_old_status = 'in_preparation' AND p_new_status = 'in_transit') OR
      (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
      (v_old_status = 'delivered' AND p_new_status = 'received') OR
      (v_old_status = 'received' AND p_new_status = 'logistic_closed') OR
      (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
    );
  ELSIF v_old_status = 'pending' AND p_new_status IN ('in_preparation', 'rejected') THEN
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

  v_is_admin := has_role(v_user_id, 'admin'::app_role) OR has_role(v_user_id, 'supervisor'::app_role) OR is_owner(v_user_id);
  v_is_origin := can_access_branch(v_user_id, v_request.source_branch_id);
  v_is_destination := can_access_branch(v_user_id, v_request.requesting_branch_id);

  IF v_is_admin THEN
    v_actor_allowed := TRUE;
  ELSIF p_new_status IN ('in_preparation', 'rejected', 'ready_for_pickup', 'ready_for_delivery') THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status = 'in_transit' THEN
    v_actor_allowed := v_is_origin OR has_role(v_user_id, 'driver'::app_role);
  ELSIF p_new_status = 'delivered' THEN
    v_actor_allowed := v_is_origin OR has_role(v_user_id, 'driver'::app_role) OR has_role(v_user_id, 'warehouse_operator'::app_role);
  ELSIF p_new_status = 'delivered_to_third_party' THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status IN ('in_consolidation') THEN
    v_actor_allowed := has_role(v_user_id, 'driver'::app_role);
  ELSIF p_new_status = 'assigned_to_trip' THEN
    v_actor_allowed := has_role(v_user_id, 'warehouse_operator'::app_role);
  ELSIF p_new_status IN ('received', 'logistic_closed') THEN
    v_actor_allowed := v_is_destination;
  ELSIF p_new_status = 'closed' THEN
    v_actor_allowed := FALSE;
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'No tiene permisos para ejecutar esta transición (% → %)', v_old_status, p_new_status;
  END IF;

  IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
    SELECT count(*) INTO v_item_count FROM public.branch_request_items WHERE request_id = p_request_id;
    IF v_item_count = 0 THEN RAISE EXCEPTION 'No se puede aceptar un pedido sin ítems.'; END IF;
  END IF;

  IF (v_old_status = 'in_preparation' AND p_new_status IN ('ready_for_pickup', 'ready_for_delivery')) THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar sin documento BIMS vinculado'; END IF;

    IF v_flow_type = 'client_delivery' THEN
      v_expected_doc_type := 'invoice';
    ELSE
      v_expected_doc_type := 'transfer';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  IF v_flow_type IS NULL AND v_old_status = 'in_preparation' AND p_new_status = 'in_transit' THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar a tránsito sin documento BIMS vinculado'; END IF;
    IF v_request.request_type = 'client' AND v_request.delivery_target = 'client' THEN v_expected_doc_type := 'invoice'; ELSE v_expected_doc_type := 'transfer'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  UPDATE public.branch_requests SET
    status = v_new_status, updated_at = now(),
    flow_type = CASE WHEN v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN v_flow_type ELSE flow_type END,
    accepted_by = CASE WHEN p_new_status = 'in_preparation' THEN v_user_id ELSE accepted_by END,
    accepted_at = CASE WHEN p_new_status = 'in_preparation' THEN now() ELSE accepted_at END,
    rejected_by = CASE WHEN p_new_status = 'rejected' THEN v_user_id ELSE rejected_by END,
    rejected_at = CASE WHEN p_new_status = 'rejected' THEN now() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_reason, rejection_reason) ELSE rejection_reason END,
    rejection_reason_type = CASE WHEN p_new_status = 'rejected' AND p_rejection_reason_type IS NOT NULL THEN p_rejection_reason_type::rejection_reason_type ELSE rejection_reason_type END,
    logistic_closed_by = CASE WHEN p_new_status = 'logistic_closed' THEN v_user_id ELSE logistic_closed_by END,
    logistic_closed_at = CASE WHEN p_new_status = 'logistic_closed' THEN now() ELSE logistic_closed_at END,
    closed_by = CASE WHEN p_new_status = 'closed' THEN v_user_id ELSE closed_by END,
    closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE closed_at END
  WHERE id = p_request_id;

  v_event_type := 'request_' || p_new_status;
  v_event_category := CASE
    WHEN p_new_status IN ('in_preparation', 'rejected', 'ready_for_pickup', 'ready_for_delivery') THEN 'request'::event_category
    WHEN p_new_status IN ('in_transit', 'delivered', 'delivered_to_third_party', 'in_consolidation', 'assigned_to_trip') THEN 'transport'::event_category
    WHEN p_new_status IN ('received') THEN 'reception'::event_category
    WHEN p_new_status IN ('logistic_closed', 'closed') THEN 'closure'::event_category
    ELSE 'request'::event_category
  END;
  v_event_description := 'Transición de pedido #' || v_request.request_number || ': ' || v_old_status || ' → ' || p_new_status;

  INSERT INTO public.operational_events (reference_type, reference_id, event_type, category, triggered_by, event_description, previous_status, new_status, metadata)
  VALUES ('branch_request', p_request_id, v_event_type, v_event_category, v_user_id, v_event_description, v_old_status, p_new_status, jsonb_build_object('reason', p_reason, 'rejection_reason_type', p_rejection_reason_type, 'flow_type', v_flow_type));

  IF p_new_status = 'in_preparation' THEN
    SELECT EXISTS (SELECT 1 FROM public.branch_requests WHERE parent_request_id = p_request_id) INTO v_is_parent;
    IF NOT v_is_parent THEN
      IF NOT EXISTS (SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id) THEN
        INSERT INTO public.fulfillment_orders (branch_request_id, source_branch_id, destination_branch_id, shipping_method, status, destination_client_name, destination_client_address)
        VALUES (p_request_id, v_request.source_branch_id, v_request.requesting_branch_id, v_request.shipping_method, 'pending'::fulfillment_status, v_request.client_name, v_request.client_address);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'new_status', p_new_status, 'request_number', v_request.request_number, 'flow_type', v_flow_type);
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- B. Función 5-args (con p_trip_id) — misma corrección de flow_type
-- ─────────────────────────────────────────────────────────────
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  BEGIN
    v_new_status := p_new_status::request_status;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Estado inválido: %', p_new_status;
  END;

  SELECT * INTO v_request FROM public.branch_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado: %', p_request_id; END IF;

  v_old_status := v_request.status::text;
  IF v_old_status = p_new_status THEN RAISE EXCEPTION 'El pedido ya está en estado %', p_new_status; END IF;

  IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
    -- client_delivery SOLO cuando el origen entrega a un tercero externo (courier/delivery)
    IF v_request.request_type IN ('client', 'online')
       AND v_request.delivery_target = 'client'
       AND v_request.shipping_method::text IN ('courier', 'delivery') THEN
      v_flow_type := 'client_delivery';
    ELSIF v_request.consolidation_override = false THEN
      v_flow_type := 'urban';
    ELSIF v_request.consolidation_override = true THEN
      v_flow_type := 'interurban';
    ELSE
      SELECT logistic_group INTO v_source_group FROM public.branches WHERE id = v_request.source_branch_id;
      SELECT logistic_group INTO v_dest_group FROM public.branches WHERE id = v_request.requesting_branch_id;

      IF v_source_group IS NULL OR v_dest_group IS NULL THEN
        v_flow_type := 'interurban';
        INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities, supporting_data)
        VALUES (
          'missing_logistic_group', 'logistics', 'warning', 'branch_operational',
          'Sucursal sin grupo logístico configurado',
          'Se usó fallback interurbano porque una sucursal no tiene logistic_group. Origen: ' || COALESCE(v_source_group, 'NULL') || ', Destino: ' || COALESCE(v_dest_group, 'NULL'),
          jsonb_build_array(jsonb_build_object('type', 'branch_request', 'id', p_request_id)),
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

  IF v_flow_type IS NULL THEN
    v_transition_valid := (
      (v_old_status = 'pending' AND p_new_status IN ('in_preparation', 'rejected')) OR
      (v_old_status = 'in_preparation' AND p_new_status = 'in_transit') OR
      (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
      (v_old_status = 'delivered' AND p_new_status = 'received') OR
      (v_old_status = 'received' AND p_new_status = 'logistic_closed') OR
      (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
    );
  ELSIF v_old_status = 'pending' AND p_new_status IN ('in_preparation', 'rejected') THEN
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
    WHERE branch_request_id = p_request_id
      AND trip_id IS NULL;
  END IF;

  IF v_old_status = 'assigned_to_trip' AND p_new_status = 'in_consolidation' THEN
    UPDATE public.fulfillment_orders
    SET trip_id = NULL, updated_at = now()
    WHERE branch_request_id = p_request_id;
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
    v_actor_allowed := v_is_transport_operative;
  ELSIF p_new_status = 'in_consolidation' AND v_old_status = 'assigned_to_trip' THEN
    v_actor_allowed := v_is_assignment_operative;
  ELSIF p_new_status = 'delivered' THEN
    v_actor_allowed := v_is_transport_operative;
  ELSIF p_new_status = 'in_transit' AND v_old_status = 'in_preparation' THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status = 'assigned_to_trip' THEN
    v_actor_allowed := v_is_assignment_operative;
  ELSIF p_new_status IN ('received', 'logistic_closed') THEN
    v_actor_allowed := v_is_destination;
  ELSIF p_new_status = 'closed' THEN
    v_actor_allowed := FALSE;
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'No tiene permisos para ejecutar esta transición (% → %)', v_old_status, p_new_status;
  END IF;

  IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
    SELECT count(*) INTO v_item_count FROM public.branch_request_items WHERE request_id = p_request_id;
    IF v_item_count = 0 THEN RAISE EXCEPTION 'No se puede aceptar un pedido sin ítems.'; END IF;
  END IF;

  IF (v_old_status = 'in_preparation' AND p_new_status IN ('ready_for_pickup', 'ready_for_delivery')) THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar sin documento BIMS vinculado'; END IF;

    IF v_flow_type = 'client_delivery' THEN
      v_expected_doc_type := 'invoice';
    ELSE
      v_expected_doc_type := 'transfer';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  IF v_flow_type IS NULL AND v_old_status = 'in_preparation' AND p_new_status = 'in_transit' THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar a tránsito sin documento BIMS vinculado'; END IF;
    IF v_request.request_type = 'client' AND v_request.delivery_target = 'client' THEN v_expected_doc_type := 'invoice'; ELSE v_expected_doc_type := 'transfer'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.branch_requests WHERE parent_request_id = p_request_id) INTO v_is_parent;

  UPDATE public.branch_requests SET
    status = v_new_status, updated_at = now(),
    flow_type = CASE WHEN v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN v_flow_type ELSE flow_type END,
    accepted_by = CASE WHEN p_new_status = 'in_preparation' THEN v_user_id ELSE accepted_by END,
    accepted_at = CASE WHEN p_new_status = 'in_preparation' THEN now() ELSE accepted_at END,
    rejected_by = CASE WHEN p_new_status = 'rejected' THEN v_user_id ELSE rejected_by END,
    rejected_at = CASE WHEN p_new_status = 'rejected' THEN now() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_reason, rejection_reason) ELSE rejection_reason END,
    rejection_reason_type = CASE WHEN p_new_status = 'rejected' AND p_rejection_reason_type IS NOT NULL THEN p_rejection_reason_type::rejection_reason_type ELSE rejection_reason_type END,
    logistic_closed_by = CASE WHEN p_new_status = 'logistic_closed' THEN v_user_id ELSE logistic_closed_by END,
    logistic_closed_at = CASE WHEN p_new_status = 'logistic_closed' THEN now() ELSE logistic_closed_at END,
    closed_by = CASE WHEN p_new_status = 'closed' THEN v_user_id ELSE closed_by END,
    closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE closed_at END
  WHERE id = p_request_id;

  v_event_type := 'request_' || p_new_status;
  v_event_category := CASE
    WHEN p_new_status IN ('in_preparation', 'rejected', 'ready_for_pickup', 'ready_for_delivery') THEN 'request'::event_category
    WHEN p_new_status IN ('in_transit', 'delivered', 'delivered_to_third_party', 'in_consolidation', 'assigned_to_trip') THEN 'transport'::event_category
    WHEN p_new_status IN ('received') THEN 'reception'::event_category
    WHEN p_new_status IN ('logistic_closed', 'closed') THEN 'closure'::event_category
    ELSE 'request'::event_category
  END;
  v_event_description := 'Transición de pedido #' || v_request.request_number || ': ' || v_old_status || ' → ' || p_new_status;

  INSERT INTO public.operational_events (reference_type, reference_id, event_type, category, triggered_by, event_description, previous_status, new_status, metadata)
  VALUES ('branch_request', p_request_id, v_event_type, v_event_category, v_user_id, v_event_description, v_old_status, p_new_status, jsonb_build_object('reason', p_reason, 'rejection_reason_type', p_rejection_reason_type, 'flow_type', v_flow_type, 'trip_id', p_trip_id));

  IF p_new_status = 'in_preparation' THEN
    IF NOT v_is_parent THEN
      IF NOT EXISTS (SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id) THEN
        INSERT INTO public.fulfillment_orders (branch_request_id, source_branch_id, destination_branch_id, shipping_method, status, destination_client_name, destination_client_address)
        VALUES (p_request_id, v_request.source_branch_id, v_request.requesting_branch_id, v_request.shipping_method, 'pending'::fulfillment_status, v_request.client_name, v_request.client_address);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'new_status', p_new_status, 'flow_type', v_flow_type, 'request_number', v_request.request_number);
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- C. Backfill Pedido #172
-- ─────────────────────────────────────────────────────────────
WITH groups AS (
  SELECT
    (SELECT logistic_group FROM public.branches WHERE id='46710448-03a2-466d-939a-613e546c08a7') AS src,
    (SELECT logistic_group FROM public.branches WHERE id='82e5ff0c-60d1-4a93-8365-0d316b061c16') AS dst
)
UPDATE public.branch_requests
SET flow_type = CASE
    WHEN (SELECT src FROM groups) IS NOT NULL
     AND (SELECT dst FROM groups) IS NOT NULL
     AND (SELECT src FROM groups) = (SELECT dst FROM groups) THEN 'urban'
    ELSE 'interurban'
  END,
  status = 'ready_for_pickup',
  updated_at = now()
WHERE id = '1cf55b4e-7e62-4d05-abf7-6ae31d264cd3'
  AND status = 'ready_for_delivery';