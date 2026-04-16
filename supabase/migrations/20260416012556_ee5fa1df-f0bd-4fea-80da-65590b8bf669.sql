
-- Update fn_transition_request_status to:
-- 1. Accept optional p_trip_id for assigned_to_trip
-- 2. Tighten actor validation for driver-only actions
-- 3. Link fulfillment to trip on assigned_to_trip
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

  -- ─── FLOW TYPE CALCULATION (on acceptance) ───
  IF v_old_status = 'pending' AND p_new_status = 'in_preparation' THEN
    IF v_request.request_type IN ('client', 'online') AND v_request.delivery_target = 'client' THEN
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

  -- ─── TRANSITION VALIDATION ───
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

  -- ─── ASSIGNED_TO_TRIP: require trip linkage ───
  IF p_new_status = 'assigned_to_trip' THEN
    IF p_trip_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar o crear un viaje para asignar el pedido';
    END IF;
    SELECT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip_id) INTO v_trip_exists;
    IF NOT v_trip_exists THEN
      RAISE EXCEPTION 'El viaje especificado no existe';
    END IF;
    -- Link fulfillment(s) to the trip
    UPDATE public.fulfillment_orders 
    SET trip_id = p_trip_id, updated_at = now()
    WHERE branch_request_id = p_request_id 
      AND trip_id IS NULL;
  END IF;

  -- ─── ACTOR PERMISSIONS ───
  v_is_admin := has_role(v_user_id, 'admin'::app_role) OR has_role(v_user_id, 'supervisor'::app_role) OR is_owner(v_user_id);
  v_is_origin := can_access_branch(v_user_id, v_request.source_branch_id);
  v_is_destination := can_access_branch(v_user_id, v_request.requesting_branch_id);

  IF v_is_admin THEN
    v_actor_allowed := TRUE;
  ELSIF p_new_status IN ('in_preparation', 'rejected', 'ready_for_pickup', 'ready_for_delivery') THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status = 'delivered_to_third_party' THEN
    v_actor_allowed := v_is_origin;
  -- Driver-only transitions: only driver role, NOT origin branch
  ELSIF p_new_status = 'in_transit' AND v_old_status IN ('ready_for_pickup', 'assigned_to_trip') THEN
    v_actor_allowed := has_role(v_user_id, 'driver'::app_role);
  ELSIF p_new_status = 'in_consolidation' THEN
    v_actor_allowed := has_role(v_user_id, 'driver'::app_role);
  ELSIF p_new_status = 'delivered' THEN
    v_actor_allowed := has_role(v_user_id, 'driver'::app_role);
  -- Legacy: in_transit from in_preparation (old flow)
  ELSIF p_new_status = 'in_transit' AND v_old_status = 'in_preparation' THEN
    v_actor_allowed := v_is_origin;
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

  -- ─── BUSINESS VALIDATIONS ───
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

  -- Legacy BIMS validation
  IF v_flow_type IS NULL AND v_old_status = 'in_preparation' AND p_new_status = 'in_transit' THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar a tránsito sin documento BIMS vinculado'; END IF;
    IF v_request.request_type = 'client' AND v_request.delivery_target = 'client' THEN v_expected_doc_type := 'invoice'; ELSE v_expected_doc_type := 'transfer'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  -- ─── UPDATE REQUEST ───
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

  -- ─── OPERATIONAL EVENT ───
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

  -- ─── AUTO-CREATE FULFILLMENT (on acceptance) ───
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

-- Update fn_driver_action: remove branch_request status changes from hub actions
-- and tighten driver role validation
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- STRICT: Only driver role can execute driver actions
  IF NOT has_role(v_user_id, 'driver'::app_role) THEN
    RAISE EXCEPTION 'Solo usuarios con rol chofer pueden ejecutar acciones de chofer';
  END IF;

  SELECT id, assigned_branch_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE user_id = v_user_id AND is_active = true;

  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'No estás registrado como chofer activo';
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
  v_old_location_type := v_fulfillment.current_location_type;
  v_old_custody_holder := v_fulfillment.current_custody_holder_id;
  v_old_location_branch := v_fulfillment.current_location_branch_id;
  v_old_trip_id := v_fulfillment.trip_id;

  SELECT id INTO v_active_trip_id
  FROM public.trips
  WHERE driver_id = v_driver.id AND status = 'in_progress'
  LIMIT 1;

  -- ─── ACTION: PICKUP ───
  IF p_action = 'pickup' THEN
    IF v_old_status NOT IN ('pending', 'picking', 'waiting_for_cut', 'waiting_for_courier', 'dispatched') THEN
      RAISE EXCEPTION 'No se puede retirar en estado: %', v_old_status;
    END IF;

    v_validation := fn_validate_driver_pickup(p_fulfillment_id);
    IF NOT (v_validation->>'allowed')::boolean THEN
      RAISE EXCEPTION '%', v_validation->>'reason';
    END IF;

    v_new_status := 'in_transit';
    v_new_custody_type := 'driver';
    v_new_location_type := 'vehicle';
    v_new_custody_holder := v_user_id;
    v_new_location_branch := NULL;
    v_new_trip_id := COALESCE(v_active_trip_id, v_old_trip_id);
    v_event_type := 'driver_pickup';
    v_event_description := 'Chofer retiró carga';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      dispatched_at = COALESCE(dispatched_at, now()),
      dispatched_by = COALESCE(dispatched_by, v_user_id),
      updated_at = now()
    WHERE id = p_fulfillment_id;

    -- Update branch_request status based on flow_type
    v_request_id := v_fulfillment.branch_request_id;
    IF v_request_id IS NOT NULL THEN
      SELECT flow_type INTO v_request_flow_type FROM public.branch_requests WHERE id = v_request_id;

      IF v_request_flow_type = 'urban' THEN
        UPDATE public.branch_requests SET status = 'in_transit'::request_status, updated_at = now() WHERE id = v_request_id AND status = 'ready_for_pickup'::request_status;
      ELSIF v_request_flow_type = 'interurban' THEN
        UPDATE public.branch_requests SET status = 'in_consolidation'::request_status, updated_at = now() WHERE id = v_request_id AND status = 'ready_for_pickup'::request_status;
      END IF;
    END IF;

  -- ─── ACTION: DROP_AT_HUB ───
  ELSIF p_action = 'drop_at_hub' THEN
    IF v_old_status NOT IN ('in_transit', 'dispatched', 'delivery_failed') THEN
      RAISE EXCEPTION 'No se puede dejar en acopio en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_location_branch := (p_metadata->>'hub_branch_id')::uuid;
    IF v_new_location_branch IS NULL THEN
      RAISE EXCEPTION 'Debe indicar la sucursal/depósito de acopio';
    END IF;

    v_new_status := 'at_hub';
    v_new_custody_type := 'branch';
    v_new_location_type := 'hub';
    v_new_custody_holder := NULL;
    v_new_trip_id := NULL;
    v_event_type := 'driver_drop_at_hub';
    v_event_description := 'Chofer dejó carga en punto de acopio';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      updated_at = now()
    WHERE id = p_fulfillment_id;

    -- NOTE: branch_request stays in 'in_consolidation' — at_hub is fulfillment-level only

  -- ─── ACTION: PICKUP_FROM_HUB ───
  ELSIF p_action = 'pickup_from_hub' THEN
    IF v_old_status != 'at_hub' THEN
      RAISE EXCEPTION 'Solo se puede tomar carga en estado at_hub, actual: %', v_old_status;
    END IF;

    v_new_status := 'in_transit';
    v_new_custody_type := 'driver';
    v_new_location_type := 'vehicle';
    v_new_custody_holder := v_user_id;
    v_new_location_branch := NULL;
    v_new_trip_id := v_active_trip_id;
    v_event_type := 'driver_pickup_from_hub';
    v_event_description := 'Chofer tomó carga desde acopio';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      updated_at = now()
    WHERE id = p_fulfillment_id;

    -- NOTE: branch_request stays in 'in_consolidation' — hub movements are fulfillment-level

  -- ─── ACTION: DELIVER_BRANCH ───
  ELSIF p_action = 'deliver_branch' THEN
    IF v_old_status NOT IN ('in_transit', 'dispatched', 'delivery_failed') THEN
      RAISE EXCEPTION 'No se puede entregar en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := 'delivered';
    v_new_custody_type := 'branch';
    v_new_location_type := 'branch';
    v_new_custody_holder := NULL;
    v_new_location_branch := COALESCE((p_metadata->>'destination_branch_id')::uuid, v_fulfillment.destination_branch_id);
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_to_branch';
    v_event_description := 'Chofer entregó en sucursal destino';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      updated_at = now(),
      delivery_failed_at = NULL,
      delivery_failed_reason = NULL
    WHERE id = p_fulfillment_id;

  -- ─── ACTION: DELIVER_CUSTOMER ───
  ELSIF p_action = 'deliver_customer' THEN
    IF v_old_status NOT IN ('in_transit', 'dispatched', 'delivery_failed') THEN
      RAISE EXCEPTION 'No se puede entregar en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := 'delivered';
    v_new_custody_type := 'customer';
    v_new_location_type := 'customer';
    v_new_custody_holder := NULL;
    v_new_location_branch := NULL;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_to_customer';
    v_event_description := 'Chofer entregó a cliente: ' || COALESCE(p_metadata->>'receiver_name', 'N/A');
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      updated_at = now(),
      delivery_failed_at = NULL,
      delivery_failed_reason = NULL
    WHERE id = p_fulfillment_id;

  -- ─── ACTION: DELIVERY_FAILED ───
  ELSIF p_action = 'delivery_failed' THEN
    IF v_old_status NOT IN ('in_transit', 'dispatched') THEN
      RAISE EXCEPTION 'No se puede registrar entrega fallida en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_status := 'delivery_failed';
    v_new_custody_type := 'driver';
    v_new_location_type := 'vehicle';
    v_new_custody_holder := v_user_id;
    v_new_location_branch := NULL;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_delivery_failed';
    v_event_description := 'Entrega fallida: ' || COALESCE(p_metadata->>'reason', 'Sin motivo');
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      status = v_new_status::fulfillment_status,
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = v_new_trip_id,
      delivery_failed_at = now(),
      delivery_failed_reason = COALESCE(p_metadata->>'reason', 'Sin motivo'),
      updated_at = now()
    WHERE id = p_fulfillment_id;

  -- ─── ACTION: TRANSFER_CUSTODY ───
  ELSIF p_action = 'transfer_custody' THEN
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    v_new_custody_holder := (p_metadata->>'target_driver_user_id')::uuid;
    IF v_new_custody_holder IS NULL THEN
      RAISE EXCEPTION 'Debe indicar el chofer destino';
    END IF;

    SELECT id, assigned_branch_id INTO v_target_driver
    FROM public.drivers WHERE user_id = v_new_custody_holder AND is_active = true;
    IF v_target_driver IS NULL THEN
      RAISE EXCEPTION 'El chofer destino no está activo';
    END IF;

    v_new_status := v_old_status;
    v_new_custody_type := 'driver';
    v_new_location_type := 'vehicle';
    v_new_location_branch := NULL;
    v_new_trip_id := v_old_trip_id;
    v_event_type := 'driver_transfer_custody';
    v_event_description := 'Transferencia de custodia entre choferes';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      current_custody_holder_id = v_new_custody_holder,
      current_custody_type = v_new_custody_type,
      updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSE
    RAISE EXCEPTION 'Acción no reconocida: %', p_action;
  END IF;

  -- ─── REGISTER EVENT ───
  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, category,
    triggered_by, event_description,
    previous_status, new_status,
    previous_custody_holder_id, new_custody_holder_id,
    previous_location_branch_id, new_location_branch_id,
    metadata
  ) VALUES (
    'fulfillment_order', p_fulfillment_id, v_event_type, v_event_category,
    v_user_id, v_event_description,
    v_old_status, COALESCE(v_new_status, v_old_status),
    v_old_custody_holder, COALESCE(v_new_custody_holder, v_old_custody_holder),
    v_old_location_branch, v_new_location_branch,
    p_metadata
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'fulfillment_id', p_fulfillment_id,
    'old_status', v_old_status,
    'new_status', COALESCE(v_new_status, v_old_status)
  );
END;
$function$;
