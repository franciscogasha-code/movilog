
-- ============================================================
-- 1. RECREATE request_status ENUM
-- ============================================================
-- All existing data is 'pending' so safe to recreate

-- First, drop dependent objects that reference the enum
ALTER TABLE branch_requests ALTER COLUMN status DROP DEFAULT;

-- Create new enum
CREATE TYPE public.request_status_new AS ENUM (
  'pending', 'accepted', 'rejected', 'picking', 'dispatched',
  'in_transit', 'delivered', 'received', 'logistic_closed', 'closed'
);

-- Convert column
ALTER TABLE branch_requests 
  ALTER COLUMN status TYPE request_status_new 
  USING (
    CASE status::text
      WHEN 'ready_to_ship' THEN 'dispatched'::request_status_new
      WHEN 'received_ok' THEN 'received'::request_status_new
      WHEN 'received_partial' THEN 'received'::request_status_new
      WHEN 'partially_accepted' THEN 'accepted'::request_status_new
      ELSE status::text::request_status_new
    END
  );

-- Drop old enum and rename new
DROP TYPE public.request_status;
ALTER TYPE public.request_status_new RENAME TO request_status;

-- Restore default
ALTER TABLE branch_requests ALTER COLUMN status SET DEFAULT 'pending'::request_status;

-- ============================================================
-- 2. CLEAN shipping_method ENUM
-- ============================================================
ALTER TABLE branch_requests ALTER COLUMN shipping_method DROP DEFAULT;
ALTER TABLE fulfillment_orders ALTER COLUMN shipping_method DROP DEFAULT;

CREATE TYPE public.shipping_method_new AS ENUM (
  'own_fleet', 'courier', 'pickup', 'delivery'
);

-- Migrate existing data
UPDATE branch_requests SET shipping_method = 'own_fleet' WHERE shipping_method::text IN ('direct_client', 'cut_shipment');
UPDATE fulfillment_orders SET shipping_method = 'own_fleet' WHERE shipping_method::text IN ('direct_client', 'cut_shipment');

ALTER TABLE branch_requests 
  ALTER COLUMN shipping_method TYPE shipping_method_new 
  USING shipping_method::text::shipping_method_new;

ALTER TABLE fulfillment_orders 
  ALTER COLUMN shipping_method TYPE shipping_method_new 
  USING shipping_method::text::shipping_method_new;

DROP TYPE public.shipping_method;
ALTER TYPE public.shipping_method_new RENAME TO shipping_method;

ALTER TABLE branch_requests ALTER COLUMN shipping_method SET DEFAULT 'own_fleet'::shipping_method;

-- ============================================================
-- 3. UPDATE RLS POLICY FOR branch_requests UPDATE
-- ============================================================
DROP POLICY IF EXISTS "Update requests" ON branch_requests;
CREATE POLICY "Update requests" ON branch_requests
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR is_owner(auth.uid())
  OR created_by = auth.uid()
  OR can_access_branch(auth.uid(), source_branch_id)
  OR can_access_branch(auth.uid(), requesting_branch_id)
);

-- ============================================================
-- 4. FUNCTION fn_transition_request_status (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_transition_request_status(
  p_request_id UUID,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL,
  p_rejection_reason_type TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Cast new status
  BEGIN
    v_new_status := p_new_status::request_status;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Estado inválido: %', p_new_status;
  END;

  -- Lock row for concurrency control
  SELECT * INTO v_request
  FROM public.branch_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado: %', p_request_id;
  END IF;

  v_old_status := v_request.status::text;

  -- Prevent no-op
  IF v_old_status = p_new_status THEN
    RAISE EXCEPTION 'El pedido ya está en estado %', p_new_status;
  END IF;

  -- Validate transition map
  IF NOT (
    (v_old_status = 'pending'         AND p_new_status IN ('accepted', 'rejected')) OR
    (v_old_status = 'accepted'        AND p_new_status = 'picking') OR
    (v_old_status = 'picking'         AND p_new_status = 'dispatched') OR
    (v_old_status = 'dispatched'      AND p_new_status = 'in_transit') OR
    (v_old_status = 'in_transit'      AND p_new_status = 'delivered') OR
    (v_old_status = 'delivered'       AND p_new_status = 'received') OR
    (v_old_status = 'received'        AND p_new_status = 'logistic_closed') OR
    (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
  ) THEN
    RAISE EXCEPTION 'Transición no permitida: % → %', v_old_status, p_new_status;
  END IF;

  -- Determine actor type
  v_is_admin := has_role(v_user_id, 'admin'::app_role) 
                OR has_role(v_user_id, 'supervisor'::app_role) 
                OR is_owner(v_user_id);
  v_is_origin := can_access_branch(v_user_id, v_request.source_branch_id);
  v_is_destination := can_access_branch(v_user_id, v_request.requesting_branch_id);

  -- Validate actor permissions (explicit per transition)
  IF v_is_admin THEN
    v_actor_allowed := TRUE;
  ELSIF p_new_status IN ('accepted', 'rejected', 'picking', 'dispatched', 'in_transit', 'delivered') THEN
    -- Origin branch actions
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status IN ('received', 'logistic_closed') THEN
    -- Destination branch actions
    v_actor_allowed := v_is_destination;
  ELSIF p_new_status = 'closed' THEN
    -- Admin-only (already handled above)
    v_actor_allowed := FALSE;
  END IF;

  IF NOT v_actor_allowed THEN
    RAISE EXCEPTION 'No tiene permisos para ejecutar esta transición (% → %)', v_old_status, p_new_status;
  END IF;

  -- Apply audit fields based on transition
  UPDATE public.branch_requests SET
    status = v_new_status,
    updated_at = now(),
    -- Acceptance
    accepted_by = CASE WHEN p_new_status = 'accepted' THEN v_user_id ELSE accepted_by END,
    accepted_at = CASE WHEN p_new_status = 'accepted' THEN now() ELSE accepted_at END,
    -- Rejection
    rejected_by = CASE WHEN p_new_status = 'rejected' THEN v_user_id ELSE rejected_by END,
    rejected_at = CASE WHEN p_new_status = 'rejected' THEN now() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status = 'rejected' THEN COALESCE(p_reason, rejection_reason) ELSE rejection_reason END,
    rejection_reason_type = CASE WHEN p_new_status = 'rejected' AND p_rejection_reason_type IS NOT NULL 
      THEN p_rejection_reason_type::rejection_reason_type ELSE rejection_reason_type END,
    -- Logistic close
    logistic_closed_by = CASE WHEN p_new_status = 'logistic_closed' THEN v_user_id ELSE logistic_closed_by END,
    logistic_closed_at = CASE WHEN p_new_status = 'logistic_closed' THEN now() ELSE logistic_closed_at END,
    -- Admin close
    closed_by = CASE WHEN p_new_status = 'closed' THEN v_user_id ELSE closed_by END,
    closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE closed_at END
  WHERE id = p_request_id;

  -- Determine event metadata
  v_event_type := 'request_' || p_new_status;
  v_event_category := CASE
    WHEN p_new_status IN ('accepted', 'rejected') THEN 'request'::event_category
    WHEN p_new_status IN ('picking', 'dispatched') THEN 'preparation'::event_category
    WHEN p_new_status IN ('in_transit', 'delivered') THEN 'transport'::event_category
    WHEN p_new_status IN ('received') THEN 'reception'::event_category
    WHEN p_new_status IN ('logistic_closed', 'closed') THEN 'closure'::event_category
    ELSE 'request'::event_category
  END;
  v_event_description := 'Transición de pedido #' || v_request.request_number || ': ' || v_old_status || ' → ' || p_new_status;

  -- Insert operational event
  INSERT INTO public.operational_events (
    reference_type, reference_id, event_type, category,
    triggered_by, event_description,
    previous_status, new_status,
    metadata
  ) VALUES (
    'branch_request', p_request_id, v_event_type, v_event_category,
    v_user_id, v_event_description,
    v_old_status, p_new_status,
    jsonb_build_object('reason', p_reason, 'rejection_reason_type', p_rejection_reason_type)
  );

  -- Create fulfillment_order on acceptance (only for non-parent requests)
  IF p_new_status = 'accepted' THEN
    -- Check if this is a parent request (has children)
    SELECT EXISTS (
      SELECT 1 FROM public.branch_requests WHERE parent_request_id = p_request_id
    ) INTO v_is_parent;

    IF NOT v_is_parent THEN
      -- Check for duplicate fulfillment
      IF NOT EXISTS (
        SELECT 1 FROM public.fulfillment_orders 
        WHERE branch_request_id = p_request_id
      ) THEN
        INSERT INTO public.fulfillment_orders (
          branch_request_id, source_branch_id, destination_branch_id,
          shipping_method, status,
          destination_client_name, destination_client_address
        ) VALUES (
          p_request_id, v_request.source_branch_id, v_request.requesting_branch_id,
          v_request.shipping_method, 'pending'::fulfillment_status,
          v_request.client_name, v_request.client_address
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'request_number', v_request.request_number
  );
END;
$$;
