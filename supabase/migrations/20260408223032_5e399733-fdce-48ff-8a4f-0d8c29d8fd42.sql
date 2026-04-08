CREATE OR REPLACE FUNCTION public.fn_validate_business_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Rule 1: Reposition can only target branch
  IF NEW.request_type = 'reposition' AND NEW.delivery_target = 'client' THEN
    RAISE EXCEPTION 'Reposición solo puede tener destino sucursal, no cliente';
  END IF;

  -- Rule 2: If parent_request_id is set, validate it exists
  IF NEW.parent_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branch_requests WHERE id = NEW.parent_request_id) THEN
      RAISE EXCEPTION 'La solicitud padre referenciada no existe';
    END IF;
  END IF;

  -- Rule 3: For client delivery (mono-origin enforcement)
  IF NEW.parent_request_id IS NOT NULL AND NEW.delivery_target = 'client' THEN
    IF EXISTS (
      SELECT 1 FROM public.branch_requests
      WHERE parent_request_id = NEW.parent_request_id
        AND id != NEW.id
        AND source_branch_id != NEW.source_branch_id
    ) THEN
      RAISE EXCEPTION 'Pedido a cliente requiere origen único: ya existen transferencias con origen diferente';
    END IF;
  END IF;

  -- Rule 4: Shipping method coherence
  IF NEW.request_type = 'reposition' AND NEW.delivery_target = 'branch' THEN
    IF NEW.shipping_method IN ('delivery', 'pickup') THEN
      RAISE EXCEPTION 'Método de envío "%" no aplica para reposición entre sucursales', NEW.shipping_method;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;