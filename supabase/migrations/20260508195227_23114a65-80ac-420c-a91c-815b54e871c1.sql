-- ============================================================
-- 1) Drop legacy signatures
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_send_presale_to_operation(uuid);
DROP FUNCTION IF EXISTS public.fn_send_presale_to_operation(uuid, uuid, text, text);

-- ============================================================
-- 2) Coherence trigger: also block edits on converted pre-sales
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_validate_pre_sale_coherence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_pre_sale THEN
    IF NEW.request_type::text <> 'pre_sale_online' THEN
      RAISE EXCEPTION 'Pre-venta requiere request_type=pre_sale_online (got %)', NEW.request_type;
    END IF;
    IF NEW.status::text <> 'draft' THEN
      RAISE EXCEPTION 'Pre-venta requiere status=draft (got %)', NEW.status;
    END IF;
    IF NEW.pre_sale_status IS NULL THEN
      NEW.pre_sale_status := 'draft';
    END IF;
  END IF;

  -- Block content edits on already-converted pre-sales
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.is_pre_sale,false) = true
     AND COALESCE(OLD.pre_sale_status,'') = 'converted' THEN
    IF NEW.client_name      IS DISTINCT FROM OLD.client_name
       OR NEW.client_phone  IS DISTINCT FROM OLD.client_phone
       OR NEW.client_email  IS DISTINCT FROM OLD.client_email
       OR NEW.client_address IS DISTINCT FROM OLD.client_address
       OR NEW.commercial_terms IS DISTINCT FROM OLD.commercial_terms
       OR NEW.notes         IS DISTINCT FROM OLD.notes
       OR NEW.sales_channel IS DISTINCT FROM OLD.sales_channel
       OR NEW.requesting_branch_id IS DISTINCT FROM OLD.requesting_branch_id
       OR NEW.is_pre_sale   IS DISTINCT FROM OLD.is_pre_sale
       OR NEW.pre_sale_status IS DISTINCT FROM OLD.pre_sale_status
       OR NEW.converted_to_request_id IS DISTINCT FROM OLD.converted_to_request_id
    THEN
      RAISE EXCEPTION 'Pre-venta convertida: registro inmutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 3) Block items mutations on converted pre-sales
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_block_items_on_converted_presale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_ps boolean;
  v_pss   text;
  v_rid   uuid := COALESCE(NEW.request_id, OLD.request_id);
BEGIN
  IF v_rid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT is_pre_sale, pre_sale_status INTO v_is_ps, v_pss
    FROM public.branch_requests WHERE id = v_rid;
  IF COALESCE(v_is_ps,false) = true AND COALESCE(v_pss,'') = 'converted' THEN
    RAISE EXCEPTION 'Pre-venta convertida: items inmutables';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_block_items_on_converted_presale ON public.branch_request_items;
CREATE TRIGGER trg_block_items_on_converted_presale
  BEFORE INSERT OR UPDATE OR DELETE ON public.branch_request_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_items_on_converted_presale();

-- ============================================================
-- 4) RLS: edit own pre-sale draft only when NOT converted
-- ============================================================
DROP POLICY IF EXISTS "Edit own pre-sale draft" ON public.branch_requests;
CREATE POLICY "Edit own pre-sale draft"
  ON public.branch_requests
  FOR UPDATE TO authenticated
  USING (
    is_pre_sale = true
    AND created_by = auth.uid()
    AND COALESCE(pre_sale_status,'draft') <> 'converted'
  )
  WITH CHECK (
    is_pre_sale = true
    AND created_by = auth.uid()
    AND COALESCE(pre_sale_status,'draft') <> 'converted'
  );

-- ============================================================
-- 5) NEW RPC: creates a NEW operational order, locks the pre-sale
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(
  p_request_id uuid,
  p_requesting_branch_id uuid,
  p_source_branch_id uuid,
  p_delivery_target text,
  p_shipping_method text,
  p_operational_responsible_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_uid uuid := auth.uid();
  v_new_id uuid;
  v_target delivery_target;
  v_method shipping_method;
BEGIN
  -- Lock the pre-sale row
  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pre-venta no encontrada';
  END IF;

  -- Idempotency: already converted with new model
  IF COALESCE(r.is_pre_sale,false) = true
     AND COALESCE(r.pre_sale_status,'') = 'converted'
     AND r.converted_to_request_id IS NOT NULL THEN
    RETURN r.converted_to_request_id;
  END IF;

  -- Backward compat: legacy in-place converted (is_pre_sale already false)
  IF COALESCE(r.is_pre_sale,false) = false THEN
    RETURN r.id;
  END IF;

  -- Authorization
  IF r.created_by <> v_uid
     AND NOT (has_role(v_uid,'admin'::app_role) OR is_owner(v_uid)) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede convertir esta pre-venta';
  END IF;

  -- Required parameters (no silent fallbacks)
  IF p_requesting_branch_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar la sucursal ejecutora del pedido';
  END IF;
  IF p_source_branch_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar la sucursal origen del stock';
  END IF;
  IF p_delivery_target IS NULL OR p_shipping_method IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar destino y método de entrega';
  END IF;

  -- Client validation
  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;

  v_target := p_delivery_target::delivery_target;
  v_method := p_shipping_method::shipping_method;

  IF v_target = 'client'
     AND v_method IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/encomienda a cliente requiere dirección';
  END IF;

  -- Mono-origin guarantee at this RPC: a single source_branch_id only.
  -- (The presale UI already enforces single-origin.)

  -- 1) Create the NEW operational order
  INSERT INTO public.branch_requests (
    requesting_branch_id,
    source_branch_id,
    request_type,
    status,
    delivery_target,
    shipping_method,
    client_name,
    client_phone,
    client_email,
    client_address,
    sales_channel,
    notes,
    commercial_terms,
    operational_responsible_id,
    is_pre_sale,
    created_from_presale_id,
    created_by
  ) VALUES (
    p_requesting_branch_id,
    p_source_branch_id,
    'online'::request_type,
    'pending'::request_status,
    v_target,
    v_method,
    r.client_name,
    r.client_phone,
    r.client_email,
    r.client_address,
    r.sales_channel,
    r.notes,
    r.commercial_terms,
    p_operational_responsible_id,
    false,
    p_request_id,
    v_uid
  ) RETURNING id INTO v_new_id;

  -- 2) Clone items
  INSERT INTO public.branch_request_items (
    request_id, product_id, quantity_requested, item_purpose,
    client_name, client_address, notes
  )
  SELECT
    v_new_id,
    product_id,
    quantity_requested,
    'client'::item_purpose,
    client_name,
    client_address,
    notes
  FROM public.branch_request_items
  WHERE request_id = p_request_id;

  -- 3) Lock the original pre-sale
  UPDATE public.branch_requests
     SET pre_sale_status         = 'converted',
         converted_to_request_id = v_new_id,
         converted_at            = now(),
         converted_by_user_id    = v_uid,
         pre_sale_sent_at        = COALESCE(pre_sale_sent_at, now()),
         updated_at              = now()
   WHERE id = p_request_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.fn_send_presale_to_operation(uuid, uuid, uuid, text, text, uuid)
  IS 'Convierte una pre-venta en un pedido operativo NUEVO (id y request_number nuevos), clona items, bloquea la pre-venta original con pre_sale_status=converted y deja vínculo bidireccional (created_from_presale_id ↔ converted_to_request_id). Atómica e idempotente.';