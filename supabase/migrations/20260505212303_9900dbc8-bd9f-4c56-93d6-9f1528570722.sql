
ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS converted_to_request_id uuid,
  ADD COLUMN IF NOT EXISTS created_from_presale_id uuid,
  ADD COLUMN IF NOT EXISTS converted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS converted_by_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_br_created_from_presale
  ON public.branch_requests(created_from_presale_id)
  WHERE created_from_presale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_br_converted_to_request
  ON public.branch_requests(converted_to_request_id)
  WHERE converted_to_request_id IS NOT NULL;

-- Nueva RPC: conversión idempotente de pre-venta a pedido operativo
CREATE OR REPLACE FUNCTION public.fn_convert_presale_to_order(
  p_request_id uuid,
  p_source_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_new_id uuid;
  v_source uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id AND is_pre_sale = true
   FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pre-venta no encontrada';
  END IF;

  -- Idempotencia: si ya fue convertida, devolver el id existente
  IF r.converted_to_request_id IS NOT NULL THEN
    RETURN r.converted_to_request_id;
  END IF;

  -- Permisos: creador o admin/owner
  IF r.created_by <> v_uid
     AND NOT (has_role(v_uid,'admin'::app_role) OR is_owner(v_uid)) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede convertir esta pre-venta';
  END IF;

  -- Validaciones comerciales mínimas
  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;
  IF r.shipping_method::text IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/courier requiere dirección del cliente';
  END IF;

  -- Sucursal origen del pedido nuevo: explícita o la de la pre-venta
  v_source := COALESCE(p_source_branch_id, r.source_branch_id, r.requesting_branch_id);

  -- Crear pedido nuevo
  INSERT INTO public.branch_requests (
    requesting_branch_id, source_branch_id, request_type, status,
    delivery_target, shipping_method,
    client_name, client_phone, client_email, client_address,
    sales_channel, notes, created_by,
    is_pre_sale, created_from_presale_id
  ) VALUES (
    r.requesting_branch_id, v_source, 'online'::request_type, 'pending'::request_status,
    r.delivery_target, r.shipping_method,
    r.client_name, r.client_phone, r.client_email, r.client_address,
    r.sales_channel, r.notes, v_uid,
    false, r.id
  )
  RETURNING id INTO v_new_id;

  -- Copiar items
  INSERT INTO public.branch_request_items (
    request_id, product_id, quantity_requested, item_purpose,
    client_name, client_address, notes
  )
  SELECT v_new_id, product_id, quantity_requested, item_purpose,
         client_name, client_address, notes
    FROM public.branch_request_items
   WHERE request_id = r.id;

  -- Marcar pre-venta como convertida (queda visible en bandeja Pre-Ventas)
  UPDATE public.branch_requests
     SET pre_sale_status        = 'converted',
         converted_to_request_id = v_new_id,
         converted_at            = now(),
         converted_by_user_id    = v_uid,
         updated_at              = now()
   WHERE id = r.id;

  RETURN v_new_id;
END;
$$;

-- Wrapper deprecated: mantiene compat con llamadas viejas.
-- Usa la sucursal de la pre-venta como origen del pedido nuevo.
CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.fn_convert_presale_to_order(p_request_id, NULL);
END;
$$;

COMMENT ON FUNCTION public.fn_send_presale_to_operation(uuid)
  IS 'DEPRECATED: usar fn_convert_presale_to_order(p_request_id, p_source_branch_id). Wrapper conservado para compatibilidad.';
