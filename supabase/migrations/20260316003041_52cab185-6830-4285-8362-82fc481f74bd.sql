
-- 1. Add 'pending_physical_confirmation' to fulfillment_status enum
ALTER TYPE public.fulfillment_status ADD VALUE IF NOT EXISTS 'pending_physical_confirmation' AFTER 'delivered';

-- 2. Update auto-resolve trigger to check for open incidents before resolving
CREATE OR REPLACE FUNCTION public.fn_auto_resolve_alerts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_has_open_incidents boolean;
BEGIN
  IF TG_TABLE_NAME = 'fulfillment_orders' THEN
    -- Check if there are open incidents linked to this fulfillment
    SELECT EXISTS (
      SELECT 1 FROM public.logistics_incidents
      WHERE fulfillment_order_id = NEW.id
        AND status NOT IN ('resolved', 'closed')
    ) INTO v_has_open_incidents;

    -- When received at branch AND no open incidents, resolve pending alerts
    IF NEW.received_at_branch IS NOT NULL AND (OLD.received_at_branch IS NULL) AND NOT v_has_open_incidents THEN
      UPDATE public.ai_anomalies 
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;
    -- When BIMS transfer is linked AND no open incidents, resolve prepared_without_bims alerts
    IF ((NEW.bims_transfer_number IS NOT NULL AND OLD.bims_transfer_number IS NULL) 
       OR (NEW.bims_invoice_number IS NOT NULL AND OLD.bims_invoice_number IS NULL))
       AND NOT v_has_open_incidents THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND anomaly_type IN ('prepared_without_bims', 'missing_bims_document')
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;

    -- BIMS 48h overdue: escalate alert if deadline passed and not confirmed
    IF NEW.bims_confirmation_deadline IS NOT NULL 
       AND NEW.bims_confirmation_deadline < now() 
       AND NEW.bims_transfer_verified = false
       AND (OLD.bims_confirmation_deadline IS NULL OR OLD.bims_confirmation_deadline >= now()) THEN
      INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities, branch_id)
      VALUES (
        'bims_deadline_overdue', 'logistics', 'critical', 'logistics_admin_decision',
        'Plazo BIMS 48h vencido sin confirmación',
        'La sucursal no confirmó recepción en BIMS dentro del plazo de 48 horas',
        jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text)),
        NEW.destination_branch_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
