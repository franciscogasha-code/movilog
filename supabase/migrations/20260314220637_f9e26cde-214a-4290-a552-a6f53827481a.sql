
-- =============================================
-- TABLES & COLUMNS: Phase 1 continued
-- =============================================

-- 7. Add trip_type to trips table
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS trip_type public.trip_type NOT NULL DEFAULT 'urban_cutoff';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cutoff_started_at timestamptz;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cutoff_ended_at timestamptz;

-- 8. Add BIMS linking fields to fulfillment_orders
ALTER TABLE public.fulfillment_orders ADD COLUMN IF NOT EXISTS bims_transfer_number varchar;
ALTER TABLE public.fulfillment_orders ADD COLUMN IF NOT EXISTS bims_transfer_verified boolean DEFAULT false;
ALTER TABLE public.fulfillment_orders ADD COLUMN IF NOT EXISTS package_count integer DEFAULT 0;

-- 9. Add shipping cost detail to branch_requests
ALTER TABLE public.branch_requests ADD COLUMN IF NOT EXISTS shipping_origin_paid numeric DEFAULT 0;
ALTER TABLE public.branch_requests ADD COLUMN IF NOT EXISTS shipping_destination_paid numeric DEFAULT 0;

-- 10. Add damage_origin to logistics_incidents
ALTER TABLE public.logistics_incidents ADD COLUMN IF NOT EXISTS damage_origin public.damage_origin;
ALTER TABLE public.logistics_incidents ADD COLUMN IF NOT EXISTS responsible_user_id uuid;
ALTER TABLE public.logistics_incidents ADD COLUMN IF NOT EXISTS pending_shipment_to_admin boolean DEFAULT false;
ALTER TABLE public.logistics_incidents ADD COLUMN IF NOT EXISTS shipment_reminder_9th boolean DEFAULT false;
ALTER TABLE public.logistics_incidents ADD COLUMN IF NOT EXISTS shipment_reminder_24th boolean DEFAULT false;

-- 11. Product availability consultations
CREATE TABLE public.availability_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_branch_id uuid NOT NULL REFERENCES public.branches(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  created_by uuid NOT NULL,
  status public.consultation_status NOT NULL DEFAULT 'open',
  converted_to_request_id uuid REFERENCES public.branch_requests(id),
  auto_close_at timestamptz DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Consultation target branches (one query → many branches)
CREATE TABLE public.consultation_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.availability_consultations(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  response_quantity numeric,
  response_colors text,
  response_note text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Consultation chat messages
CREATE TABLE public.consultation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.availability_consultations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 14. Shipment packages / labels
CREATE TABLE public.shipment_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_order_id uuid NOT NULL REFERENCES public.fulfillment_orders(id),
  package_number integer NOT NULL DEFAULT 1,
  label_type public.package_label_type NOT NULL DEFAULT 'inter_branch',
  destination_description varchar,
  transfer_reference varchar,
  invoice_reference varchar,
  sending_branch_code varchar,
  sending_area varchar,
  contact_phone varchar,
  recipient_name varchar,
  label_printed boolean DEFAULT false,
  printed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 15. RLS for new tables
ALTER TABLE public.availability_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_packages ENABLE ROW LEVEL SECURITY;

-- Consultations: authenticated can view and create
CREATE POLICY "View consultations" ON public.availability_consultations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Create consultations" ON public.availability_consultations FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update consultations" ON public.availability_consultations FOR UPDATE TO authenticated USING (true);

-- Consultation targets
CREATE POLICY "View targets" ON public.consultation_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage targets" ON public.consultation_targets FOR ALL TO authenticated USING (true);

-- Consultation messages
CREATE POLICY "View messages" ON public.consultation_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Send messages" ON public.consultation_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);

-- Shipment packages
CREATE POLICY "View packages" ON public.shipment_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage packages" ON public.shipment_packages FOR ALL TO authenticated USING (true);

-- 16. updated_at triggers for new tables
CREATE TRIGGER update_availability_consultations_updated_at
  BEFORE UPDATE ON public.availability_consultations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 17. Driver pickup validation function
CREATE OR REPLACE FUNCTION public.fn_validate_driver_pickup(p_fulfillment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_record record;
  v_result jsonb;
BEGIN
  SELECT bims_transfer_number, bims_invoice_number, status
  INTO v_record
  FROM public.fulfillment_orders
  WHERE id = p_fulfillment_id;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Fulfillment not found');
  END IF;

  IF v_record.bims_transfer_number IS NOT NULL OR v_record.bims_invoice_number IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', true, 'has_transfer', v_record.bims_transfer_number IS NOT NULL, 'has_invoice', v_record.bims_invoice_number IS NOT NULL);
  ELSE
    -- Generate alert for prepared order without BIMS doc
    INSERT INTO public.ai_anomalies (anomaly_type, area, severity, title, description, affected_entities)
    VALUES (
      'missing_bims_document',
      'logistics',
      'warning',
      'Orden preparada sin transferencia/factura BIMS',
      'El chofer intentó retirar sin documento BIMS vinculado',
      jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', p_fulfillment_id))
    );
    RETURN jsonb_build_object('allowed', false, 'reason', 'No existe transferencia ni factura BIMS vinculada');
  END IF;
END;
$$;

-- 18. Preparation time alert trigger
CREATE OR REPLACE FUNCTION public.fn_preparation_time_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- When fulfillment moves to picking, record start
  IF OLD.status = 'pending' AND NEW.status = 'picking' THEN
    -- Just track via operational_events, no extra column needed
    NULL;
  END IF;
  
  -- When prepared but no BIMS doc after status change
  IF NEW.status IN ('waiting_for_cut', 'waiting_for_courier') 
     AND NEW.bims_transfer_number IS NULL 
     AND NEW.bims_invoice_number IS NULL THEN
    INSERT INTO public.ai_anomalies (anomaly_type, area, severity, title, description, affected_entities)
    VALUES (
      'prepared_without_bims',
      'logistics',
      'info',
      'Orden preparada sin documento BIMS',
      'Fulfillment listo pero sin transferencia/factura BIMS vinculada',
      jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id))
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_preparation_alert
  AFTER UPDATE ON public.fulfillment_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_preparation_time_alert();
