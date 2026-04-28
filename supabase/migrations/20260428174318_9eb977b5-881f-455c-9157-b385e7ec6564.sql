-- ============================================================================
-- FASE A: EDICIÓN INTELIGENTE DE VIAJES PLANIFICADOS
-- RPC: fn_edit_trip
-- - Solo permite editar viajes en status 'planned'
-- - Permisos: owner, admin, supervisor, jefe_logistica, warehouse_operator
-- - Registra evento operativo con diff de cambios
-- - No toca cargas ni trip_id de fulfillment_orders
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_edit_trip(
  p_trip_id uuid,
  p_driver_id uuid DEFAULT NULL,
  p_vehicle_id uuid DEFAULT NULL,
  p_clear_vehicle boolean DEFAULT false,
  p_planned_departure timestamptz DEFAULT NULL,
  p_destination_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_authorized boolean;
  v_trip record;
  v_changes jsonb := '[]'::jsonb;
  v_new_vehicle_id uuid;
  v_old_driver_name text;
  v_new_driver_name text;
  v_old_vehicle_plate text;
  v_new_vehicle_plate text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_authorized :=
       has_role(v_user_id, 'admin'::app_role)
    OR has_role(v_user_id, 'supervisor'::app_role)
    OR has_role(v_user_id, 'jefe_logistica'::app_role)
    OR has_role(v_user_id, 'warehouse_operator'::app_role)
    OR is_owner(v_user_id);

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'No autorizado para editar viajes';
  END IF;

  SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viaje no encontrado';
  END IF;

  IF v_trip.status::text <> 'planned' THEN
    RAISE EXCEPTION 'Solo se pueden editar viajes en estado planificado (estado actual: %)', v_trip.status;
  END IF;

  -- Resolver nuevo vehicle_id
  IF p_clear_vehicle THEN
    v_new_vehicle_id := NULL;
  ELSIF p_vehicle_id IS NOT NULL THEN
    v_new_vehicle_id := p_vehicle_id;
  ELSE
    v_new_vehicle_id := v_trip.vehicle_id;
  END IF;

  -- Diff: chofer
  IF p_driver_id IS NOT NULL AND p_driver_id IS DISTINCT FROM v_trip.driver_id THEN
    SELECT pr.full_name INTO v_old_driver_name
    FROM public.drivers d
    LEFT JOIN public.profiles pr ON pr.user_id = d.user_id
    WHERE d.id = v_trip.driver_id;

    SELECT pr.full_name INTO v_new_driver_name
    FROM public.drivers d
    LEFT JOIN public.profiles pr ON pr.user_id = d.user_id
    WHERE d.id = p_driver_id;

    v_changes := v_changes || jsonb_build_object(
      'field', 'driver',
      'from', COALESCE(v_old_driver_name, 'Sin chofer'),
      'to', COALESCE(v_new_driver_name, 'Sin chofer')
    );
  END IF;

  -- Diff: vehículo
  IF v_new_vehicle_id IS DISTINCT FROM v_trip.vehicle_id THEN
    SELECT plate INTO v_old_vehicle_plate FROM public.vehicles WHERE id = v_trip.vehicle_id;
    SELECT plate INTO v_new_vehicle_plate FROM public.vehicles WHERE id = v_new_vehicle_id;
    v_changes := v_changes || jsonb_build_object(
      'field', 'vehicle',
      'from', COALESCE(v_old_vehicle_plate, 'Sin vehículo'),
      'to', COALESCE(v_new_vehicle_plate, 'Sin vehículo')
    );
  END IF;

  -- Diff: planned_departure
  IF p_planned_departure IS NOT NULL AND p_planned_departure IS DISTINCT FROM v_trip.planned_departure THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'planned_departure',
      'from', COALESCE(v_trip.planned_departure::text, '—'),
      'to', p_planned_departure::text
    );
  END IF;

  -- Diff: destination_description
  IF p_destination_description IS NOT NULL AND p_destination_description IS DISTINCT FROM v_trip.destination_description THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'destination_description',
      'from', COALESCE(v_trip.destination_description, '—'),
      'to', p_destination_description
    );
  END IF;

  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN jsonb_build_object('success', true, 'changed', false);
  END IF;

  -- Aplicar cambios
  UPDATE public.trips
  SET
    driver_id = COALESCE(p_driver_id, driver_id),
    vehicle_id = v_new_vehicle_id,
    planned_departure = COALESCE(p_planned_departure, planned_departure),
    destination_description = COALESCE(p_destination_description, destination_description),
    updated_at = now()
  WHERE id = p_trip_id;

  -- Registrar evento operativo con trazabilidad
  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, category,
    triggered_by, event_description,
    new_status, previous_status, metadata
  ) VALUES (
    'trip', p_trip_id, 'trip_edited', 'logistics'::event_category,
    v_user_id,
    'Viaje #' || v_trip.trip_number || ' editado (' || jsonb_array_length(v_changes) || ' cambio(s))',
    'planned', 'planned',
    jsonb_build_object('changes', v_changes)
  );

  RETURN jsonb_build_object(
    'success', true,
    'changed', true,
    'changes', v_changes
  );
END;
$$;