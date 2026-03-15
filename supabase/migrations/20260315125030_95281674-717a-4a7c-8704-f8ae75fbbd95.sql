
-- Phase 3: Add bims_confirmation_deadline to fulfillment_orders
ALTER TABLE public.fulfillment_orders 
  ADD COLUMN IF NOT EXISTS bims_confirmation_deadline timestamp with time zone,
  ADD COLUMN IF NOT EXISTS received_at_branch timestamp with time zone,
  ADD COLUMN IF NOT EXISTS received_by_branch uuid;

-- Driver collections table for granular payment tracking
CREATE TABLE public.driver_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid REFERENCES public.trips(id) NOT NULL,
  driver_id uuid REFERENCES public.drivers(id) NOT NULL,
  fulfillment_order_id uuid REFERENCES public.fulfillment_orders(id),
  client_name varchar,
  amount numeric NOT NULL,
  payment_method varchar NOT NULL DEFAULT 'cash',
  check_number varchar,
  transfer_reference varchar,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage driver collections" ON public.driver_collections
  FOR ALL TO authenticated USING (true);

CREATE POLICY "View driver collections" ON public.driver_collections
  FOR SELECT TO authenticated USING (true);

-- Bank deposits table
CREATE TABLE public.bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) NOT NULL,
  trip_id uuid REFERENCES public.trips(id),
  amount numeric NOT NULL,
  bank_name varchar,
  deposit_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_url text,
  notes text,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage bank deposits" ON public.bank_deposits
  FOR ALL TO authenticated USING (true);

CREATE POLICY "View bank deposits" ON public.bank_deposits
  FOR SELECT TO authenticated USING (true);

-- Auto-resolution function: marks related alerts as resolved_auto
CREATE OR REPLACE FUNCTION public.fn_auto_resolve_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- When a fulfillment is received at branch, resolve pending alerts
  IF TG_TABLE_NAME = 'fulfillment_orders' THEN
    IF NEW.received_at_branch IS NOT NULL AND (OLD.received_at_branch IS NULL) THEN
      UPDATE public.ai_anomalies 
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;
    -- When BIMS transfer is linked, resolve prepared_without_bims alerts
    IF (NEW.bims_transfer_number IS NOT NULL AND OLD.bims_transfer_number IS NULL) 
       OR (NEW.bims_invoice_number IS NOT NULL AND OLD.bims_invoice_number IS NULL) THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND anomaly_type IN ('prepared_without_bims', 'missing_bims_document')
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_resolve_alerts
  AFTER UPDATE ON public.fulfillment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_resolve_alerts();

-- Trigger for BIMS 48h deadline alert
CREATE OR REPLACE FUNCTION public.fn_bims_deadline_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.received_at_branch IS NOT NULL AND OLD.received_at_branch IS NULL THEN
    NEW.bims_confirmation_deadline := NEW.received_at_branch + interval '48 hours';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_bims_deadline
  BEFORE UPDATE ON public.fulfillment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bims_deadline_check();
