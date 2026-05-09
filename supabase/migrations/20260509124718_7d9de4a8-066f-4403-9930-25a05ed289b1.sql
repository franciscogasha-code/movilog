CREATE OR REPLACE FUNCTION public.fn_commit_supply_resolution(p_request_id uuid, p_resolutions jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_existing record;
  v_item record;
  v_payload_item jsonb;
  v_payload_items jsonb;
  v_local_qty numeric;
  v_externals jsonb;
  v_ext jsonb;
  v_sum_externals numeric;
  v_total integer;
  v_resolved integer;
  v_branch_id uuid;
  v_qty numeric;
  v_child_id uuid;
  v_children jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_branch record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key es requerido';
  END IF;

  SELECT metadata INTO v_existing
    FROM public.operational_events
   WHERE reference_type = 'branch_request'
     AND reference_id = p_request_id
     AND event_type = 'supply_resolution_committed'
     AND metadata->>'idempotency_key' = p_idempotency_key::text
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing.metadata;
  END IF;

  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  IF r.status <> 'in_supply'::request_status THEN
    RAISE EXCEPTION 'El pedido no está En abastecimiento (status=%)', r.status;
  END IF;

  -- Autorización: creador, admin, owner, o usuario con acceso a la sucursal ejecutora
  IF NOT (
    r.created_by = v_uid
    OR has_role(v_uid,'admin'::app_role)
    OR is_owner(v_uid)
    OR public.can_access_branch(v_uid, r.requesting_branch_id)
  ) THEN
    RAISE EXCEPTION 'No autorizado para resolver abastecimiento de este pedido';
  END IF;

  v_payload_items := p_resolutions->'items';
  IF v_payload_items IS NULL OR jsonb_typeof(v_payload_items) <> 'array' THEN
    RAISE EXCEPTION 'p_resolutions.items es requerido (array)';
  END IF;

  SELECT COUNT(*) INTO v_total
    FROM public.branch_request_items WHERE request_id = p_request_id;
  SELECT jsonb_array_length(v_payload_items) INTO v_resolved;
  IF v_resolved <> v_total THEN
    RAISE EXCEPTION 'incomplete_resolution: el payload debe incluir los % items del pedido (recibidos %)', v_total, v_resolved;
  END IF;

  FOR v_payload_item IN SELECT * FROM jsonb_array_elements(v_payload_items) LOOP
    SELECT * INTO v_item
      FROM public.branch_request_items
     WHERE id = (v_payload_item->>'request_item_id')::uuid
       AND request_id = p_request_id;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION 'request_item_id % no pertenece al pedido', v_payload_item->>'request_item_id';
    END IF;

    v_local_qty := COALESCE((v_payload_item->>'local_qty')::numeric, 0);
    v_externals := COALESCE(v_payload_item->'externals', '[]'::jsonb);
    IF v_local_qty < 0 THEN
      RAISE EXCEPTION 'local_qty no puede ser negativo (item %)', v_item.id;
    END IF;

    v_sum_externals := 0;
    FOR v_ext IN SELECT * FROM jsonb_array_elements(v_externals) LOOP
      v_branch_id := (v_ext->>'source_branch_id')::uuid;
      v_qty := (v_ext->>'qty')::numeric;
      IF v_branch_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'External inválido en item %', v_item.id;
      END IF;
      IF v_branch_id = r.requesting_branch_id THEN
        RAISE EXCEPTION 'self_source_not_allowed: la sucursal ejecutora no puede ser origen externo (item %)', v_item.id;
      END IF;
      v_sum_externals := v_sum_externals + v_qty;
    END LOOP;

    IF (v_local_qty + v_sum_externals) <> v_item.quantity_requested THEN
      RAISE EXCEPTION 'partial_supply_not_allowed_in_phase_5a: item % requiere % unidades (local=% + externos=%)',
        v_item.id, v_item.quantity_requested, v_local_qty, v_sum_externals;
    END IF;

    UPDATE public.branch_request_items
       SET local_supply_qty = v_local_qty
     WHERE id = v_item.id;
  END LOOP;

  FOR v_branch IN
    SELECT
      (ext->>'source_branch_id')::uuid AS source_branch_id,
      jsonb_agg(jsonb_build_object(
        'product_id', it.product_id,
        'qty', (ext->>'qty')::numeric,
        'parent_item_id', it.id,
        'client_name', it.client_name,
        'client_address', it.client_address,
        'notes', it.notes
      )) AS lines
    FROM jsonb_array_elements(v_payload_items) AS pi
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pi->'externals','[]'::jsonb)) AS ext
    JOIN public.branch_request_items it
      ON it.id = (pi->>'request_item_id')::uuid
    GROUP BY (ext->>'source_branch_id')::uuid
  LOOP
    PERFORM set_config('movilog.supply_internal','on', true);
    INSERT INTO public.branch_requests (
      requesting_branch_id, source_branch_id, request_type, status,
      delivery_target, shipping_method, parent_request_id,
      client_name, client_phone, client_email, client_address,
      sales_channel, notes, commercial_terms, is_pre_sale, created_by
    ) VALUES (
      r.requesting_branch_id, v_branch.source_branch_id,
      'reposition'::request_type, 'pending'::request_status,
      'branch'::delivery_target, 'own_fleet'::shipping_method,
      p_request_id,
      r.client_name, r.client_phone, r.client_email, r.client_address,
      r.sales_channel,
      'Abastecimiento pedido #' || r.request_number::text,
      r.commercial_terms, false, v_uid
    ) RETURNING id INTO v_child_id;
    PERFORM set_config('movilog.supply_internal','off', true);

    INSERT INTO public.branch_request_items (
      request_id, product_id, quantity_requested, item_purpose,
      client_name, client_address, notes
    )
    SELECT
      v_child_id,
      (line->>'product_id')::uuid,
      (line->>'qty')::numeric,
      'reposition'::item_purpose,
      line->>'client_name',
      line->>'client_address',
      line->>'notes'
    FROM jsonb_array_elements(v_branch.lines) AS line;

    INSERT INTO public.operational_events (
      reference_type, reference_id, category, event_type,
      new_status, triggered_by, metadata
    ) VALUES (
      'branch_request', v_child_id, 'preparation'::event_category,
      'supply_child_created', 'pending', v_uid,
      jsonb_build_object('parent_request_id', p_request_id,
                         'source_branch_id', v_branch.source_branch_id)
    );

    v_children := v_children || jsonb_build_object(
      'child_id', v_child_id,
      'source_branch_id', v_branch.source_branch_id,
      'lines', v_branch.lines
    );
  END LOOP;

  v_summary := jsonb_build_object(
    'request_id', p_request_id,
    'idempotency_key', p_idempotency_key,
    'children', v_children,
    'children_count', jsonb_array_length(v_children)
  );

  INSERT INTO public.operational_events (
    reference_type, reference_id, category, event_type,
    triggered_by, metadata
  ) VALUES (
    'branch_request', p_request_id, 'preparation'::event_category,
    'supply_resolution_committed', v_uid, v_summary
  );

  PERFORM public.fn_try_promote_supplied(p_request_id);

  RETURN v_summary;
END;
$function$;