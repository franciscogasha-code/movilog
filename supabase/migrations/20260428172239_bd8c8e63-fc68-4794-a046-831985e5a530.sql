CREATE OR REPLACE FUNCTION public.fn_cancel_trip(p_trip_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_trip record;
  v_load_count integer;
  v_authorized boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_authorized :=
       has_role(v_user_id, 'admin'::app_role)
    OR has_role(v_user_id, 'supervisor'::app_role)
    OR has_role(v_user_id, 'jefe_logistica'::app_role)
    OR is_owner(v_user_id);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'No autorizado para cancelar viajes';
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaje no encontrado';
  END IF;

  IF v_trip.status::text <> 'planned' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar viajes en estado planificado (estado actual: %)', v_trip.status;
  END IF;

  SELECT count(*) INTO v_load_count
  FROM public.fulfillment_orders
  WHERE trip_id = p_trip_id;

  IF v_load_count > 0 THEN
    RAISE EXCEPTION 'No se puede cancelar: el viaje tiene % carga(s) asignada(s). Quitar las cargas primero.', v_load_count;
  END IF;

  UPDATE public.trips
  SET status = 'cancelled'::trip_status,
      updated_at = now()
  WHERE id = p_trip_id;

  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, event_description,
    category, previous_status, new_status, triggered_by, metadata
  ) VALUES (
    'trip', p_trip_id, 'trip_cancelled',
    COALESCE(NULLIF(p_reason, ''), 'Viaje cancelado'),
    'logistics'::event_category,
    v_trip.status::text, 'cancelled',
    v_user_id,
    jsonb_build_object('trip_number', v_trip.trip_number, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'trip_id', p_trip_id,
    'trip_number', v_trip.trip_number
  );
END;
$$;