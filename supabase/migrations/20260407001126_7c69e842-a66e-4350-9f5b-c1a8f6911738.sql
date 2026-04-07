
-- FASE 2: Trigger to auto-close commercial exceptions when delivery is confirmed
-- When a fulfillment_order transitions to 'delivered' or 'received' status,
-- and has an open commercial exception, auto-close it.

CREATE OR REPLACE FUNCTION public.fn_auto_close_commercial_exception()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When fulfillment reaches delivered/received/completed and has an open commercial exception
  IF NEW.status IN ('delivered', 'received', 'completed')
     AND OLD.status NOT IN ('delivered', 'received', 'completed')
     AND NEW.commercial_exception_status IS NOT NULL
     AND NEW.commercial_exception_status IN ('pending_commercial', 'escalated') THEN

    -- Auto-close the commercial exception
    NEW.commercial_exception_status := 'auto_closed';
    NEW.commercial_resolved_at := now();
    NEW.commercial_resolution_type := 'auto_closed_delivery_confirmed';
    NEW.commercial_resolution_notes := 'Excepción cerrada automáticamente por confirmación de entrega/recepción. Estado: ' || NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach the trigger (BEFORE UPDATE so it modifies the row in-place)
DROP TRIGGER IF EXISTS trg_auto_close_commercial_exception ON public.fulfillment_orders;
CREATE TRIGGER trg_auto_close_commercial_exception
  BEFORE UPDATE ON public.fulfillment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_close_commercial_exception();

-- Also auto-resolve related ai_anomaly alerts when commercial exception closes
-- (This is handled by extending fn_auto_resolve_alerts which already runs on fulfillment_orders)

-- FASE 5: Create storage buckets for operational evidence
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('incident-photos', 'incident-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('receipts', 'receipts', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('mileage-photos', 'mileage-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('deposit-proofs', 'deposit-proofs', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies: authenticated users can upload and view
CREATE POLICY "Auth users upload incident photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'incident-photos');

CREATE POLICY "Auth users view incident photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'incident-photos');

CREATE POLICY "Auth users upload receipts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "Auth users view receipts"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');

CREATE POLICY "Auth users upload mileage photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mileage-photos');

CREATE POLICY "Auth users view mileage photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mileage-photos');

CREATE POLICY "Auth users upload deposit proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'deposit-proofs');

CREATE POLICY "Auth users view deposit proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'deposit-proofs');
