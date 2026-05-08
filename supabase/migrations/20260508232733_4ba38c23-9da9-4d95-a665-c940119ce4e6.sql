CREATE OR REPLACE FUNCTION public.fn_confirm_local_supply(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_open_children integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;

  SELECT * INTO r FROM public.branch_requests WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF r.status <> 'in_supply'::request_status THEN
    RAISE EXCEPTION 'Solo pedidos En abastecimiento pueden confirmarse localmente (estado actual: %)', r.status;
  END IF;

  IF NOT (
    r.created_by = v_uid
    OR has_role(v_uid,'admin'::app_role)
    OR has_role(v_uid,'supervisor'::app_role)
    OR is_owner(v_uid)
    OR can_access_branch(v_uid, r.requesting_branch_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado para confirmar abastecimiento de este pedido';
  END IF;

  SELECT COUNT(*) INTO v_open_children
    FROM public.branch_requests
   WHERE parent_request_id = p_request_id
     AND status NOT IN ('received'::request_status,'logistic_closed'::request_status,'closed'::request_status,'rejected'::request_status);
  IF v_open_children > 0 THEN
    RAISE EXCEPTION 'Existen % pedidos internos abiertos; no se puede confirmar abastecimiento local.', v_open_children;
  END IF;

  PERFORM set_config('movilog.supply_internal','on', true);
  UPDATE public.branch_requests SET status = 'supplied'::request_status, updated_at = now() WHERE id = p_request_id;
  PERFORM set_config('movilog.supply_internal','off', true);

  RETURN jsonb_build_object('request_id', p_request_id, 'status', 'supplied');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_start_operation_from_supplied(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_request_id uuid;
  v_target delivery_target;
  v_method shipping_method;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;

  v_request_id := (p_payload->>'request_id')::uuid;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'request_id es requerido'; END IF;

  SELECT * INTO r FROM public.branch_requests WHERE id = v_request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF r.status <> 'supplied'::request_status THEN
    RAISE EXCEPTION 'Solo pedidos Abastecidos pueden pasar a operación (estado actual: %)', r.status;
  END IF;

  IF NOT (
    r.created_by = v_uid
    OR has_role(v_uid,'admin'::app_role)
    OR has_role(v_uid,'supervisor'::app_role)
    OR is_owner(v_uid)
    OR can_access_branch(v_uid, r.requesting_branch_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado para iniciar operación de este pedido';
  END IF;

  IF (p_payload->>'delivery_target') IS NULL OR (p_payload->>'shipping_method') IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar destino y método de entrega';
  END IF;

  v_target := (p_payload->>'delivery_target')::delivery_target;
  v_method := (p_payload->>'shipping_method')::shipping_method;

  IF v_target = 'client' AND v_method IN ('delivery','courier')
     AND COALESCE((p_payload->>'client_address'), r.client_address, '') = '' THEN
    RAISE EXCEPTION 'Delivery/encomienda a cliente requiere dirección';
  END IF;

  PERFORM set_config('movilog.supply_internal','on', true);
  UPDATE public.branch_requests
     SET status                       = 'pending'::request_status,
         source_branch_id             = r.requesting_branch_id,
         delivery_target              = v_target,
         shipping_method              = v_method,
         delivery_payer               = NULLIF(p_payload->>'delivery_payer','')::delivery_payer,
         shipping_cost                = NULLIF(p_payload->>'shipping_cost','')::numeric,
         shipping_origin_paid         = COALESCE(NULLIF(p_payload->>'shipping_origin_paid','')::numeric, 0),
         shipping_destination_paid    = COALESCE(NULLIF(p_payload->>'shipping_destination_paid','')::numeric, 0),
         courier_billing_mode         = NULLIF(p_payload->>'courier_billing_mode','')::courier_billing_mode,
         client_address               = COALESCE(NULLIF(p_payload->>'client_address',''), r.client_address),
         notes                        = COALESCE(NULLIF(p_payload->>'notes',''), r.notes),
         operational_responsible_id   = NULLIF(p_payload->>'operational_responsible_id','')::uuid,
         flow_type                    = public.fn_derive_flow_type(v_target::text, r.requesting_branch_id, r.requesting_branch_id),
         updated_at                   = now()
   WHERE id = v_request_id;
  PERFORM set_config('movilog.supply_internal','off', true);

  RETURN jsonb_build_object('request_id', v_request_id, 'status', 'pending');
END;
$function$;