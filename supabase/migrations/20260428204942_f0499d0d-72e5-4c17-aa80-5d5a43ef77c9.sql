-- RPC: fn_accept_and_start_trip
-- Acepta cargas asignadas al viaje y lo inicia transaccionalmente.
-- Reglas:
--  - Solo trip en estado 'planned'
--  - Solo el driver asignado al viaje O roles logísticos (warehouse_operator,
--    jefe_logistica, supervisor, admin, owner) pueden ejecutar.
--  - Acepta lista p_fulfillment_ids: el frontend ya filtró las inválidas.
--  - Cada fulfillment debe tener trip_id = p_trip_id y status NO terminal.
--  - Las que cumplen pasan a in_transit + custodia=user; las que no, se ignoran
--    pero se reportan en el resultado (skipped[]).
--  - Si no queda ninguna válida y p_force_empty = false → error.
--  - Pasa trips.status a 'in_progress', actual_departure=now(), start_mileage.
--  - Registra eventos: loads_accepted (uno por viaje, con metadata de cantidad)
--    y trip_started.

CREATE OR REPLACE FUNCTION public.fn_accept_and_start_trip(
  p_trip_id uuid,
  p_fulfillment_ids uuid[],
  p_start_mileage integer DEFAULT NULL,
  p_force_empty boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_trip record;
  v_driver_user_id uuid;
  v_authorized boolean;
  v_accepted_ids uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
  v_fo record;
  v_fid uuid;
  v_request_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  -- Lock trip
  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaje no encontrado';
  END IF;

  IF v_trip.status::text <> 'planned' THEN
    RAISE EXCEPTION 'Solo se pueden iniciar viajes en estado planificado (estado actual: %)', v_trip.status;
  END IF;

  -- Resolve driver user_id
  IF v_trip.driver_id IS NOT NULL THEN
    SELECT user_id INTO v_driver_user_id FROM public.drivers WHERE id = v_trip.driver_id;
  END IF;

  -- Authorization: driver asignado O operador logístico+
  v_authorized :=
       (v_driver_user_id IS NOT NULL AND v_driver_user_id = v_user_id)
    OR has_role(v_user_id, 'warehouse_operator'::app_role)
    OR has_role(v_user_id, 'jefe_logistica'::app_role)
    OR has_role(v_user_id, 'supervisor'::app_role)
    OR has_role(v_user_id, 'admin'::app_role)
    OR is_owner(v_user_id);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'No autorizado para iniciar este viaje';
  END IF;

  -- Process each fulfillment
  IF p_fulfillment_ids IS NOT NULL THEN
    FOREACH v_fid IN ARRAY p_fulfillment_ids LOOP
      SELECT * INTO v_fo FROM public.fulfillment_orders WHERE id = v_fid FOR UPDATE;
      IF NOT FOUND THEN
        v_skipped := v_skipped || jsonb_build_object('id', v_fid, 'reason', 'not_found');
        CONTINUE;
      END IF;
      IF v_fo.trip_id IS DISTINCT FROM p_trip_id THEN
        v_skipped := v_skipped || jsonb_build_object('id', v_fid, 'reason', 'wrong_trip');
        CONTINUE;
      END IF;
      IF v_fo.status::text IN ('delivered', 'received', 'logistic_closed', 'cancelled', 'completed', 'in_transit') THEN
        v_skipped := v_skipped || jsonb_build_object('id', v_fid, 'reason', 'invalid_status', 'status', v_fo.status::text);
        CONTINUE;
      END IF;

      -- Accept: pass to in_transit, custody=user, location=vehicle
      UPDATE public.fulfillment_orders
      SET status = 'in_transit'::fulfillment_status,
          current_custody_type = 'driver',
          current_custody_holder_id = v_user_id,
          current_location_type = 'vehicle',
          current_location_branch_id = NULL,
          dispatched_at = COALESCE(dispatched_at, now()),
          dispatched_by = COALESCE(dispatched_by, v_user_id),
          updated_at = now()
      WHERE id = v_fid;

      -- Sync branch_request
      IF v_fo.branch_request_id IS NOT NULL THEN
        UPDATE public.branch_requests
        SET status = 'in_transit'::request_status,
            current_custody_holder_id = v_user_id,
            current_location_branch_id = NULL,
            updated_at = now()
        WHERE id = v_fo.branch_request_id
          AND status::text NOT IN ('delivered','delivered_to_third_party','received','logistic_closed','closed','rejected');
      END IF;

      -- Per-load event
      INSERT INTO public.operational_events (
        reference_type, reference_id, event_type, category,
        triggered_by, event_description,
        previous_status, new_status,
        metadata
      ) VALUES (
        'fulfillment_order', v_fid, 'load_accepted_by_driver', 'transport'::event_category,
        v_user_id,
        'Carga aceptada por chofer al iniciar viaje #' || v_trip.trip_number,
        v_fo.status::text, 'in_transit',
        jsonb_build_object('trip_id', p_trip_id)
      );

      v_accepted_ids := v_accepted_ids || v_fid;
    END LOOP;
  END IF;

  -- Empty trip guard
  IF array_length(v_accepted_ids, 1) IS NULL AND NOT p_force_empty THEN
    RAISE EXCEPTION 'No hay cargas válidas para iniciar el viaje';
  END IF;

  -- Start trip
  UPDATE public.trips
  SET status = 'in_progress',
      actual_departure = now(),
      start_mileage = COALESCE(p_start_mileage, start_mileage),
      updated_at = now()
  WHERE id = p_trip_id;

  -- Trip-level events
  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, category,
    triggered_by, event_description,
    previous_status, new_status, metadata
  ) VALUES (
    'trip', p_trip_id, 'loads_accepted', 'trip'::event_category,
    v_user_id,
    'Aceptadas ' || COALESCE(array_length(v_accepted_ids, 1), 0)::text || ' carga(s) para viaje #' || v_trip.trip_number,
    'planned', 'planned',
    jsonb_build_object(
      'accepted_count', COALESCE(array_length(v_accepted_ids, 1), 0),
      'accepted_ids', to_jsonb(v_accepted_ids),
      'skipped', v_skipped
    )
  );

  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, category,
    triggered_by, event_description,
    previous_status, new_status, metadata
  ) VALUES (
    'trip', p_trip_id, 'trip_started', 'trip'::event_category,
    v_user_id,
    'Inicio de viaje #' || v_trip.trip_number,
    'planned', 'in_progress',
    jsonb_build_object('start_mileage', p_start_mileage)
  );

  RETURN jsonb_build_object(
    'success', true,
    'trip_id', p_trip_id,
    'accepted_count', COALESCE(array_length(v_accepted_ids, 1), 0),
    'accepted_ids', to_jsonb(v_accepted_ids),
    'skipped', v_skipped
  );
END;
$$;