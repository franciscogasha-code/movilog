
-- 1. Update "Manage trips" policy
DROP POLICY IF EXISTS "Manage trips" ON public.trips;
CREATE POLICY "Manage trips" ON public.trips FOR ALL TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'supervisor'::app_role) 
  OR has_role(auth.uid(), 'driver'::app_role)
  OR has_role(auth.uid(), 'warehouse_operator'::app_role)
  OR is_owner(auth.uid())
);

-- 2. Update fn_transition_request_status to accept warehouse_operator for delivery
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

  IF NOT (
    (v_old_status = 'pending' AND p_new_status IN ('in_preparation', 'rejected')) OR
    (v_old_status = 'in_preparation' AND p_new_status = 'in_transit') OR
    (v_old_status = 'in_transit' AND p_new_status = 'delivered') OR
    (v_old_status = 'delivered' AND p_new_status = 'received') OR
    (v_old_status = 'received' AND p_new_status = 'logistic_closed') OR
    (v_old_status = 'logistic_closed' AND p_new_status = 'closed')
  ) THEN
    RAISE EXCEPTION 'Transición no permitida: % → %', v_old_status, p_new_status;
  END IF;

  v_is_admin := has_role(v_user_id, 'admin'::app_role) OR has_role(v_user_id, 'supervisor'::app_role) OR is_owner(v_user_id);
  v_is_origin := can_access_branch(v_user_id, v_request.source_branch_id);
  v_is_destination := can_access_branch(v_user_id, v_request.requesting_branch_id);

  IF v_is_admin THEN
    v_actor_allowed := TRUE;
  ELSIF p_new_status IN ('in_preparation', 'rejected', 'in_transit') THEN
    v_actor_allowed := v_is_origin;
  ELSIF p_new_status = 'delivered' THEN
    v_actor_allowed := v_is_origin OR has_role(v_user_id, 'driver'::app_role) OR has_role(v_user_id, 'warehouse_operator'::app_role);
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

  IF v_old_status = 'in_preparation' AND p_new_status = 'in_transit' THEN
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id) INTO v_has_documents;
    IF NOT v_has_documents THEN RAISE EXCEPTION 'No se puede avanzar a tránsito sin documento BIMS vinculado'; END IF;
    IF v_request.request_type = 'client' AND v_request.delivery_target = 'client' THEN v_expected_doc_type := 'invoice'; ELSE v_expected_doc_type := 'transfer'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.request_bims_documents WHERE request_id = p_request_id AND document_type != v_expected_doc_type) INTO v_has_wrong_doc_type;
    IF v_has_wrong_doc_type THEN RAISE EXCEPTION 'Tipo de documento incorrecto. Se esperaba: %', CASE v_expected_doc_type WHEN 'invoice' THEN 'Factura' ELSE 'Transferencia' END; END IF;
  END IF;

  UPDATE public.branch_requests SET
    status = v_new_status, updated_at = now(),
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
    WHEN p_new_status IN ('in_preparation', 'rejected') THEN 'request'::event_category
    WHEN p_new_status IN ('in_transit', 'delivered') THEN 'transport'::event_category
    WHEN p_new_status IN ('received') THEN 'reception'::event_category
    WHEN p_new_status IN ('logistic_closed', 'closed') THEN 'closure'::event_category
    ELSE 'request'::event_category
  END;
  v_event_description := 'Transición de pedido #' || v_request.request_number || ': ' || v_old_status || ' → ' || p_new_status;

  INSERT INTO public.operational_events (reference_type, reference_id, event_type, category, triggered_by, event_description, previous_status, new_status, metadata)
  VALUES ('branch_request', p_request_id, v_event_type, v_event_category, v_user_id, v_event_description, v_old_status, p_new_status, jsonb_build_object('reason', p_reason, 'rejection_reason_type', p_rejection_reason_type));

  IF p_new_status = 'in_preparation' THEN
    SELECT EXISTS (SELECT 1 FROM public.branch_requests WHERE parent_request_id = p_request_id) INTO v_is_parent;
    IF NOT v_is_parent THEN
      IF NOT EXISTS (SELECT 1 FROM public.fulfillment_orders WHERE branch_request_id = p_request_id) THEN
        INSERT INTO public.fulfillment_orders (branch_request_id, source_branch_id, destination_branch_id, shipping_method, status, destination_client_name, destination_client_address)
        VALUES (p_request_id, v_request.source_branch_id, v_request.requesting_branch_id, v_request.shipping_method, 'pending'::fulfillment_status, v_request.client_name, v_request.client_address);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'old_status', v_old_status, 'new_status', p_new_status, 'request_number', v_request.request_number);
END;
$function$;

-- 3. Migrate driver roles to warehouse_operator
-- Disable only the user-defined trigger
ALTER TABLE public.user_roles DISABLE TRIGGER trg_protect_owner_roles;

-- Migrate users with driver role to warehouse_operator (skip those who already have it)
UPDATE public.user_roles 
SET role = 'warehouse_operator'::app_role 
WHERE role = 'driver'::app_role
AND user_id NOT IN (
  SELECT user_id FROM public.user_roles WHERE role = 'warehouse_operator'::app_role
);

-- Remove duplicate driver entries
DELETE FROM public.user_roles 
WHERE role = 'driver'::app_role;

-- Re-enable trigger
ALTER TABLE public.user_roles ENABLE TRIGGER trg_protect_owner_roles;
