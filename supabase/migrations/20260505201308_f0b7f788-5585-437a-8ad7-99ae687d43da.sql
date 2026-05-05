-- ============ Columns ============
ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS is_pre_sale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pre_sale_status text NULL,
  ADD COLUMN IF NOT EXISTS sales_channel text NULL,
  ADD COLUMN IF NOT EXISTS client_phone text NULL,
  ADD COLUMN IF NOT EXISTS client_email text NULL,
  ADD COLUMN IF NOT EXISTS pre_sale_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pre_sale_sent_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pre_sale_pdf_generated_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_branch_requests_pre_sale
  ON public.branch_requests(is_pre_sale, pre_sale_status)
  WHERE is_pre_sale = true;

-- ============ Trigger: coherencia estructural ============
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_pre_sale_coherence ON public.branch_requests;
CREATE TRIGGER trg_validate_pre_sale_coherence
  BEFORE INSERT OR UPDATE ON public.branch_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_pre_sale_coherence();

-- ============ Trigger: bloquear fulfillment sobre pre-ventas ============
CREATE OR REPLACE FUNCTION public.fn_block_fulfillment_for_presale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_is_pre_sale boolean;
BEGIN
  IF NEW.branch_request_id IS NOT NULL THEN
    SELECT is_pre_sale INTO v_is_pre_sale
      FROM public.branch_requests WHERE id = NEW.branch_request_id;
    IF COALESCE(v_is_pre_sale, false) THEN
      INSERT INTO public.diagnostic_logs (step_name, table_name, payload, error_message)
      VALUES ('block_fulfillment_presale', 'fulfillment_orders',
              jsonb_build_object('branch_request_id', NEW.branch_request_id),
              'Intento de crear fulfillment sobre pre-venta');
      RAISE EXCEPTION 'No se puede crear orden logística sobre una pre-venta. Promover primero a operación.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_fulfillment_presale ON public.fulfillment_orders;
CREATE TRIGGER trg_block_fulfillment_presale
  BEFORE INSERT ON public.fulfillment_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_fulfillment_for_presale();

-- ============ RPC: promoción a operación ============
CREATE OR REPLACE FUNCTION public.fn_send_presale_to_operation(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.branch_requests
   WHERE id = p_request_id AND is_pre_sale = true
   FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Pre-venta no encontrada o ya promovida';
  END IF;
  IF r.created_by <> auth.uid()
     AND NOT (has_role(auth.uid(),'admin'::app_role) OR is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'Solo el creador o admin puede enviar a operación';
  END IF;
  IF COALESCE(r.client_name,'') = '' OR COALESCE(r.client_phone,'') = '' THEN
    RAISE EXCEPTION 'Falta nombre o teléfono del cliente';
  END IF;
  IF r.shipping_method::text IN ('delivery','courier')
     AND COALESCE(r.client_address,'') = '' THEN
    RAISE EXCEPTION 'Delivery/courier requiere dirección del cliente';
  END IF;

  UPDATE public.branch_requests
     SET is_pre_sale     = false,
         request_type    = 'online'::request_type,
         status          = 'pending'::request_status,
         pre_sale_status = 'sent_to_operation',
         pre_sale_sent_at = now(),
         updated_at       = now()
   WHERE id = p_request_id;
END;
$$;

-- ============ RLS: edición de pre-venta propia ============
DROP POLICY IF EXISTS "Edit own pre-sale draft" ON public.branch_requests;
CREATE POLICY "Edit own pre-sale draft"
  ON public.branch_requests
  FOR UPDATE TO authenticated
  USING (is_pre_sale = true AND created_by = auth.uid())
  WITH CHECK (is_pre_sale = true AND created_by = auth.uid());