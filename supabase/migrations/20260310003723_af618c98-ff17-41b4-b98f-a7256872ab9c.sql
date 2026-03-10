
-- 1. Add physical states to fulfillment_status
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'picking' AFTER 'pending';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'waiting_for_cut' AFTER 'picking';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'waiting_for_courier' AFTER 'waiting_for_cut';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'dispatched' AFTER 'waiting_for_courier';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'in_transit' AFTER 'dispatched';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'delivered' AFTER 'in_transit';
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'received' AFTER 'delivered';

-- 2. Add incident_origin to logistics_incidents
ALTER TABLE public.logistics_incidents
  ADD COLUMN IF NOT EXISTS incident_origin varchar DEFAULT NULL;

-- 3. Trigger: auto-generate inventory alert on rejection
CREATE OR REPLACE FUNCTION public.fn_rejection_inventory_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rejection_reason_type IN ('stock_difference', 'product_not_found') THEN
    INSERT INTO public.ai_anomalies (
      anomaly_type, area, severity, title, description,
      branch_id, affected_entities, supporting_data
    ) VALUES (
      'inventory_alert',
      'supply',
      'warning',
      'Alerta de inventario: ' || NEW.rejection_reason_type,
      'Rechazo en producto ' || (SELECT name FROM public.products WHERE id = NEW.product_id),
      (SELECT source_branch_id FROM public.branch_requests WHERE id = NEW.request_id),
      jsonb_build_array(jsonb_build_object('type', 'branch_request_item', 'id', NEW.id)),
      jsonb_build_object(
        'product_id', NEW.product_id,
        'request_id', NEW.request_id,
        'rejection_reason', NEW.rejection_reason_type,
        'quantity_requested', NEW.quantity_requested,
        'quantity_accepted', NEW.quantity_accepted
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rejection_inventory_alert ON public.branch_request_items;
CREATE TRIGGER trg_rejection_inventory_alert
  AFTER INSERT OR UPDATE OF rejection_reason_type ON public.branch_request_items
  FOR EACH ROW
  WHEN (NEW.rejection_reason_type IS NOT NULL)
  EXECUTE FUNCTION public.fn_rejection_inventory_alert();

-- 4. Trigger: closure logic by request_type
CREATE OR REPLACE FUNCTION public.fn_check_request_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.logistic_closed_at IS NOT NULL AND NEW.admin_closed_at IS NOT NULL AND NEW.closed_at IS NULL THEN
    NEW.closed_at = now();
    NEW.status = 'closed';
  END IF;
  IF NEW.request_type = 'reposition' AND NEW.logistic_closed_at IS NOT NULL AND NEW.closed_at IS NULL THEN
    NEW.closed_at = now();
    NEW.status = 'closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_request_closure ON public.branch_requests;
CREATE TRIGGER trg_check_request_closure
  BEFORE UPDATE ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_request_closure();
