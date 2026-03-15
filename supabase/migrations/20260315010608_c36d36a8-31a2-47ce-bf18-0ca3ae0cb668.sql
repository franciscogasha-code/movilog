
-- 1. delivery_target enum + column on branch_requests
CREATE TYPE public.delivery_target AS ENUM ('branch', 'client');
ALTER TABLE public.branch_requests ADD COLUMN delivery_target public.delivery_target NOT NULL DEFAULT 'branch';

-- 2. alert_level enum + column on ai_anomalies
CREATE TYPE public.alert_level AS ENUM ('branch_operational', 'escalable', 'logistics_admin_decision');
ALTER TABLE public.ai_anomalies ADD COLUMN alert_level public.alert_level NOT NULL DEFAULT 'branch_operational';

-- 3. detection_context enum + column on logistics_incidents
CREATE TYPE public.detection_context AS ENUM ('transfer_reception', 'supplier_reception', 'internal');
ALTER TABLE public.logistics_incidents ADD COLUMN detection_context public.detection_context;

-- 4. damage_cause enum + column on logistics_incidents
CREATE TYPE public.damage_cause AS ENUM ('collaborator', 'customer', 'sealed_package', 'product_defect');
ALTER TABLE public.logistics_incidents ADD COLUMN damage_cause public.damage_cause;

-- 5. consultation_products table for multi-product consultations
CREATE TABLE public.consultation_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.availability_consultations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consultation_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View consultation products" ON public.consultation_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage consultation products" ON public.consultation_products FOR ALL TO authenticated USING (true);

-- 6. Make product_id nullable on availability_consultations (multi-product uses consultation_products)
ALTER TABLE public.availability_consultations ALTER COLUMN product_id DROP NOT NULL;

-- 7. Update fn_preparation_time_alert to include alert_level
CREATE OR REPLACE FUNCTION public.fn_preparation_time_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.status IN ('waiting_for_cut', 'waiting_for_courier') 
     AND NEW.bims_transfer_number IS NULL 
     AND NEW.bims_invoice_number IS NULL THEN
    INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities)
    VALUES (
      'prepared_without_bims', 'logistics', 'info', 'escalable',
      'Orden preparada sin documento BIMS',
      'Fulfillment listo pero sin transferencia/factura BIMS vinculada',
      jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id))
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 8. Update fn_validate_driver_pickup to include alert_level
CREATE OR REPLACE FUNCTION public.fn_validate_driver_pickup(p_fulfillment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_record record;
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
    INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities)
    VALUES (
      'missing_bims_document', 'logistics', 'warning', 'branch_operational',
      'Orden preparada sin transferencia/factura BIMS',
      'El chofer intentó retirar sin documento BIMS vinculado',
      jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', p_fulfillment_id))
    );
    RETURN jsonb_build_object('allowed', false, 'reason', 'No existe transferencia ni factura BIMS vinculada');
  END IF;
END;
$function$;
