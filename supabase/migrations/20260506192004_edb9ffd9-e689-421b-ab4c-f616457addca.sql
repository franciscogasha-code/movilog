
-- 1) BYPASS de triggers logísticos cuando is_pre_sale=true
CREATE OR REPLACE FUNCTION public.fn_validate_different_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_pre_sale, false) THEN RETURN NEW; END IF;

  IF NEW.notes IS NOT NULL AND NEW.notes LIKE '%[Pedido padre multi-origen]%' THEN
    RETURN NEW;
  END IF;

  IF NEW.request_type = 'online'
     AND NEW.delivery_target = 'client'
     AND NEW.source_branch_id = NEW.requesting_branch_id THEN
    RETURN NEW;
  END IF;

  IF NEW.source_branch_id = NEW.requesting_branch_id THEN
    RAISE EXCEPTION 'La sucursal origen no puede ser igual a la sucursal solicitante';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_business_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_pre_sale, false) THEN RETURN NEW; END IF;

  IF NEW.request_type = 'reposition' AND NEW.delivery_target = 'client' THEN
    RAISE EXCEPTION 'Reposición solo puede tener destino sucursal, no cliente';
  END IF;

  IF NEW.parent_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branch_requests WHERE id = NEW.parent_request_id) THEN
      RAISE EXCEPTION 'La solicitud padre referenciada no existe';
    END IF;
  END IF;

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

  IF NEW.request_type = 'reposition' AND NEW.delivery_target = 'branch' THEN
    IF NEW.shipping_method IN ('delivery', 'pickup') THEN
      RAISE EXCEPTION 'Método de envío "%" no aplica para reposición entre sucursales', NEW.shipping_method;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_delivery_charges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_pre_sale, false) THEN RETURN NEW; END IF;

  IF NEW.shipping_origin_paid > 0 AND NEW.shipping_destination_paid > 0 THEN
    RAISE EXCEPTION 'No se permite cobrar envío en origen y destino simultáneamente';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_autoset_flow_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF COALESCE(NEW.is_pre_sale, false) THEN RETURN NEW; END IF;

  IF NEW.flow_type IS NULL THEN
    NEW.flow_type := public.fn_derive_flow_type(
      NEW.delivery_target::text,
      NEW.source_branch_id,
      NEW.requesting_branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Permitir NULL condicional en campos logísticos
ALTER TABLE public.branch_requests
  ALTER COLUMN source_branch_id DROP NOT NULL,
  ALTER COLUMN delivery_target  DROP NOT NULL,
  ALTER COLUMN shipping_method  DROP NOT NULL;

ALTER TABLE public.branch_requests
  ADD CONSTRAINT chk_logistic_fields_required_when_not_presale
  CHECK (
    is_pre_sale = true
    OR (
      source_branch_id IS NOT NULL
      AND delivery_target IS NOT NULL
      AND shipping_method IS NOT NULL
    )
  );

-- 3) Consolidar RPC: fn_send_presale_to_operation in-place; drop fn_convert_presale_to_order
DROP FUNCTION IF EXISTS public.fn_send_presale_to_operation(uuid);
DROP FUNCTION IF EXISTS public.fn_convert_presale_to_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(
  p_request_id uuid,
  p_source_branch_id uuid DEFAULT NULL,
  p_delivery_target text DEFAULT NULL,
  p_shipping_method text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    -- Idempotencia: si ya fue promovida, devolvemos el id sin error
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

  v_source := COALESCE(p_source_branch_id, r.source_branch_id, r.requesting_branch_id);
  v_target := COALESCE(p_delivery_target::delivery_target, r.delivery_target, 'client'::delivery_target);
  v_method := COALESCE(p_shipping_method::shipping_method, r.shipping_method, 'pickup'::shipping_method);

  IF v_target = 'client' AND v_method IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/courier requiere dirección del cliente';
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
         updated_at        = now()
   WHERE id = p_request_id;

  RETURN p_request_id;
END;
$$;
