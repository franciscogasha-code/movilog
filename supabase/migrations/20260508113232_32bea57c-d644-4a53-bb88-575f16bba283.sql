CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(p_request_id uuid, p_source_branch_id uuid DEFAULT NULL::uuid, p_delivery_target text DEFAULT NULL::text, p_shipping_method text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_source uuid;
  v_target delivery_target;
  v_method shipping_method;
BEGIN
  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id AND is_pre_sale = true
   FOR UPDATE;

  IF r.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.branch_requests WHERE id = p_request_id AND is_pre_sale = false) THEN
      RETURN p_request_id;
    END IF;
    RAISE EXCEPTION 'Pre-venta no encontrada';
  END IF;

  IF r.created_by <> v_uid
     AND NOT (has_role(v_uid,'admin'::app_role) OR is_owner(v_uid)) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede enviar a operación';
  END IF;

  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;

  IF p_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar sucursal origen para convertir la pre-venta';
  END IF;
  IF p_delivery_target IS NULL OR p_shipping_method IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar destino y método de entrega para convertir la pre-venta';
  END IF;

  v_source := p_source_branch_id;
  v_target := p_delivery_target::delivery_target;
  v_method := p_shipping_method::shipping_method;

  IF v_target = 'client'
     AND v_method IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/encomienda requiere dirección del cliente';
  END IF;

  UPDATE public.branch_requests
     SET is_pre_sale       = false,
         request_type      = 'online'::request_type,
         status            = 'pending'::request_status,
         source_branch_id  = v_source,
         delivery_target   = v_target,
         shipping_method   = v_method,
         pre_sale_status   = 'sent_to_operation',
         pre_sale_sent_at  = now(),
         converted_to_request_id = p_request_id,
         converted_at      = now(),
         converted_by_user_id = v_uid,
         commercial_terms  = NULL,
         updated_at        = now()
   WHERE id = p_request_id;

  RETURN p_request_id;
END;
$function$;