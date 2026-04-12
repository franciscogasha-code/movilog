
-- 1. Add new enum values to fulfillment_status
ALTER TYPE fulfillment_status ADD VALUE IF NOT EXISTS 'at_hub';
ALTER TYPE fulfillment_status ADD VALUE IF NOT EXISTS 'delivery_failed';

-- 2. Add new columns to fulfillment_orders
ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS current_custody_type varchar NOT NULL DEFAULT 'none'
    CHECK (current_custody_type IN ('none','driver','branch','customer')),
  ADD COLUMN IF NOT EXISTS current_location_type varchar NOT NULL DEFAULT 'branch'
    CHECK (current_location_type IN ('branch','hub','vehicle','customer')),
  ADD COLUMN IF NOT EXISTS delivery_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_failed_reason text;

-- 3. Backfill existing dispatched records that have a custody holder
UPDATE public.fulfillment_orders
SET current_custody_type = 'driver',
    current_location_type = 'vehicle'
WHERE current_custody_holder_id IS NOT NULL
  AND status IN ('dispatched', 'in_transit')
  AND current_custody_type = 'none';

-- 4. Create fn_driver_action
CREATE OR REPLACE FUNCTION public.fn_driver_action(
  p_fulfillment_id uuid,
  p_action text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
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
BEGIN
  -- Auth check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Get driver record
  SELECT id, assigned_branch_id, assigned_vehicle_id
  INTO v_driver
  FROM public.drivers
  WHERE user_id = v_user_id AND is_active = true;

  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'No estás registrado como chofer activo';
  END IF;

  -- Lock fulfillment row
  SELECT * INTO v_fulfillment
  FROM public.fulfillment_orders
  WHERE id = p_fulfillment_id
  FOR UPDATE;

  IF v_fulfillment IS NULL THEN
    RAISE EXCEPTION 'Fulfillment no encontrado';
  END IF;

  -- Save old values
  v_old_status := v_fulfillment.status::text;
  v_old_custody_type := v_fulfillment.current_custody_type;
  v_old_location_type := v_fulfillment.current_location_type;
  v_old_custody_holder := v_fulfillment.current_custody_holder_id;
  v_old_location_branch := v_fulfillment.current_location_branch_id;
  v_old_trip_id := v_fulfillment.trip_id;

  -- Get driver's active trip (if any)
  SELECT id INTO v_active_trip_id
  FROM public.trips
  WHERE driver_id = v_driver.id AND status = 'in_progress'
  LIMIT 1;

  -- ─── ACTION: PICKUP ───
  IF p_action = 'pickup' THEN
    IF v_old_status NOT IN ('pending', 'picking', 'waiting_for_cut', 'waiting_for_courier', 'dispatched') THEN
      RAISE EXCEPTION 'No se puede retirar en estado: %', v_old_status;
    END IF;

    -- Validate BIMS
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

    -- Update fulfillment
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
    v_new_trip_id := NULL; -- detach from trip
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
      delivery_failed_reason = COALESCE(p_metadata->>'reason', delivery_failed_reason),
      updated_at = now()
    WHERE id = p_fulfillment_id;

  -- ─── ACTION: TRANSFER_TO_DRIVER ───
  ELSIF p_action = 'transfer_to_driver' THEN
    IF v_old_status NOT IN ('in_transit', 'dispatched', 'delivery_failed') THEN
      RAISE EXCEPTION 'No se puede transferir en estado: %', v_old_status;
    END IF;
    IF v_old_custody_holder != v_user_id THEN
      RAISE EXCEPTION 'No tenés custodia de esta carga';
    END IF;

    -- Validate target driver
    SELECT d.id, d.user_id INTO v_target_driver
    FROM public.drivers d
    WHERE d.user_id = (p_metadata->>'target_user_id')::uuid
      AND d.is_active = true;

    IF v_target_driver IS NULL THEN
      RAISE EXCEPTION 'Chofer destino no encontrado o inactivo';
    END IF;

    -- Get target driver's active trip
    SELECT id INTO v_new_trip_id
    FROM public.trips
    WHERE driver_id = v_target_driver.id AND status = 'in_progress'
    LIMIT 1;

    v_new_status := v_old_status; -- keep current status
    v_new_custody_type := 'driver';
    v_new_location_type := 'vehicle';
    v_new_custody_holder := (p_metadata->>'target_user_id')::uuid;
    v_new_location_branch := NULL;
    -- v_new_trip_id already set above (or NULL if no active trip)
    v_event_type := 'driver_transfer_custody';
    v_event_description := 'Transferencia de custodia entre choferes';
    v_event_category := 'transport';

    UPDATE public.fulfillment_orders SET
      current_custody_type = v_new_custody_type,
      current_location_type = v_new_location_type,
      current_custody_holder_id = v_new_custody_holder,
      current_location_branch_id = v_new_location_branch,
      trip_id = COALESCE(v_new_trip_id, trip_id),
      updated_at = now()
    WHERE id = p_fulfillment_id;

  ELSE
    RAISE EXCEPTION 'Acción no reconocida: %', p_action;
  END IF;

  -- Insert operational event
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
    v_old_custody_holder, v_new_custody_holder,
    v_old_location_branch, v_new_location_branch,
    p_metadata || jsonb_build_object(
      'old_custody_type', v_old_custody_type,
      'new_custody_type', v_new_custody_type,
      'old_location_type', v_old_location_type,
      'new_location_type', COALESCE(v_new_location_type, v_old_location_type),
      'trip_id', COALESCE(v_new_trip_id, v_old_trip_id),
      'out_of_cutoff', v_active_trip_id IS NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'fulfillment_id', p_fulfillment_id,
    'old_status', v_old_status,
    'new_status', COALESCE(v_new_status, v_old_status),
    'new_custody_type', v_new_custody_type,
    'new_location_type', COALESCE(v_new_location_type, v_old_location_type)
  );
END;
$function$;
