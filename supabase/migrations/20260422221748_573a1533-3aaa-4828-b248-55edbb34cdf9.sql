CREATE OR REPLACE FUNCTION public.fn_driver_action(p_action text, p_fulfillment_id uuid, p_trip_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_fo record;
  v_old_status text;
  v_new_status text;
  v_event_type text;
  v_event_description text;
  v_event_category event_category;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_fo FROM public.fulfillment_orders WHERE id = p_fulfillment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fulfillment no encontrado';
  END IF;

  v_old_status := v_fo.status::text;

  IF p_action = 'pickup' THEN
    v_new_status := 'in_transit';
    v_event_type := 'driver_pickup';
    v_event_description := 'Carga retirada por operador';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        trip_id = COALESCE(p_trip_id, trip_id),
        current_custody_type = 'driver',
        current_custody_holder_id = v_user_id,
        current_location_type = 'vehicle',
        current_location_branch_id = NULL,
        dispatched_at = COALESCE(dispatched_at, now()),
        dispatched_by = COALESCE(dispatched_by, v_user_id),
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET status = 'in_transit'::request_status,
        current_custody_holder_id = v_user_id,
        current_location_branch_id = NULL,
        updated_at = now()
    WHERE id = v_fo.branch_request_id AND status::text NOT IN ('delivered','delivered_to_third_party','closed','rejected','cancelled');

  ELSIF p_action = 'pickup_from_hub' THEN
    v_new_status := 'in_transit';
    v_event_type := 'driver_pickup_from_hub';
    v_event_description := 'Carga tomada desde acopio';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        trip_id = COALESCE(p_trip_id, trip_id),
        current_custody_type = 'driver',
        current_custody_holder_id = v_user_id,
        current_location_type = 'vehicle',
        current_location_branch_id = NULL,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET status = 'in_transit'::request_status,
        current_custody_holder_id = v_user_id,
        current_location_branch_id = NULL,
        updated_at = now()
    WHERE id = v_fo.branch_request_id AND status::text NOT IN ('delivered','delivered_to_third_party','closed','rejected','cancelled');

  ELSIF p_action = 'drop_at_hub' THEN
    -- SURGICAL FIX: fulfillment_status no tiene 'in_consolidation'.
    -- Se usa 'at_hub' (valor válido del enum, ya usado en auto-consolidación).
    -- branch_requests SÍ tiene 'in_consolidation' en su enum y se mantiene.
    v_new_status := 'at_hub';
    v_event_type := 'driver_drop_at_hub';
    v_event_description := 'Carga dejada en acopio';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = 'branch',
        current_custody_holder_id = NULL,
        current_location_type = 'branch',
        current_location_branch_id = (p_metadata->>'hub_branch_id')::uuid,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET status = 'in_consolidation'::request_status,
        current_custody_holder_id = NULL,
        current_location_branch_id = (p_metadata->>'hub_branch_id')::uuid,
        updated_at = now()
    WHERE id = v_fo.branch_request_id;

  ELSIF p_action = 'deliver_branch' THEN
    v_new_status := 'delivered';
    v_event_type := 'driver_delivery_to_branch';
    v_event_description := 'Entregado en sucursal destino';
    v_event_category := 'reception'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = 'branch',
        current_custody_holder_id = NULL,
        current_location_type = 'branch',
        current_location_branch_id = destination_branch_id,
        received_at = now(),
        received_by = v_user_id,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET status = 'delivered'::request_status,
        current_custody_holder_id = NULL,
        current_location_branch_id = v_fo.destination_branch_id,
        updated_at = now()
    WHERE id = v_fo.branch_request_id;

  ELSIF p_action = 'deliver_customer' THEN
    v_new_status := 'delivered';
    v_event_type := 'driver_delivery_to_customer';
    v_event_description := 'Entregado al cliente';
    v_event_category := 'reception'::event_category;

    UPDATE public.fulfillment_orders
    SET status = v_new_status::fulfillment_status,
        current_custody_type = 'customer',
        current_custody_holder_id = NULL,
        current_location_type = 'customer',
        current_location_branch_id = NULL,
        received_at = now(),
        received_by = v_user_id,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET status = 'delivered_to_third_party'::request_status,
        current_custody_holder_id = NULL,
        current_location_branch_id = NULL,
        updated_at = now()
    WHERE id = v_fo.branch_request_id;

  ELSIF p_action = 'delivery_failed' THEN
    v_new_status := v_old_status;
    v_event_type := 'driver_delivery_failed';
    v_event_description := COALESCE(NULLIF(p_metadata->>'reason', ''), 'Entrega fallida');
    v_event_category := 'incident'::event_category;

    UPDATE public.fulfillment_orders
    SET delivery_failed_at = now(),
        delivery_failed_reason = COALESCE(NULLIF(p_metadata->>'reason', ''), 'Entrega fallida'),
        updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSIF p_action = 'transfer_to_driver' THEN
    v_new_status := v_old_status;
    v_event_type := 'driver_custody_transfer';
    v_event_description := 'Custodia transferida a otro operador';
    v_event_category := 'transport'::event_category;

    UPDATE public.fulfillment_orders
    SET current_custody_holder_id = (p_metadata->>'new_driver_user_id')::uuid,
        updated_at = now()
    WHERE id = p_fulfillment_id;

    UPDATE public.branch_requests
    SET current_custody_holder_id = (p_metadata->>'new_driver_user_id')::uuid,
        updated_at = now()
    WHERE id = v_fo.branch_request_id;

  ELSE
    RAISE EXCEPTION 'Acción no soportada: %', p_action;
  END IF;

  INSERT INTO public.operational_events (
    reference_id, reference_type, event_type, event_description,
    category, previous_status, new_status, triggered_by, metadata
  ) VALUES (
    p_fulfillment_id, 'fulfillment_order', v_event_type, v_event_description,
    v_event_category, v_old_status, v_new_status, v_user_id, p_metadata
  );

  RETURN jsonb_build_object('success', true, 'new_status', v_new_status);
END;
$function$;