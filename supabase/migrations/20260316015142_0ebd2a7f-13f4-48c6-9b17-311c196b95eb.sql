
-- MODULE 1: Deposit-Collection linking (many-to-many)
CREATE TABLE public.deposit_collection_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL REFERENCES public.bank_deposits(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.driver_collections(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deposit_id, collection_id)
);

ALTER TABLE public.deposit_collection_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manage deposit links" ON public.deposit_collection_links FOR ALL TO authenticated USING (true);
CREATE POLICY "View deposit links" ON public.deposit_collection_links FOR SELECT TO authenticated USING (true);

-- MODULE 1: Add advance tracking to driver_settlements
ALTER TABLE public.driver_settlements
  ADD COLUMN IF NOT EXISTS advance_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_reconciled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_deposit_instruction text,
  ADD COLUMN IF NOT EXISTS admin_deposit_proof_url text;

-- MODULE 2: Commercial exception fields on fulfillment_orders
ALTER TABLE public.fulfillment_orders
  ADD COLUMN IF NOT EXISTS commercial_exception_at timestamptz,
  ADD COLUMN IF NOT EXISTS commercial_exception_status varchar DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS commercial_resolution_type varchar,
  ADD COLUMN IF NOT EXISTS commercial_resolution_notes text,
  ADD COLUMN IF NOT EXISTS commercial_resolved_by uuid,
  ADD COLUMN IF NOT EXISTS commercial_resolved_at timestamptz;

-- MODULE 3: Admin disposition fields on logistics_incidents
ALTER TABLE public.logistics_incidents
  ADD COLUMN IF NOT EXISTS admin_disposition varchar,
  ADD COLUMN IF NOT EXISTS admin_disposition_notes text,
  ADD COLUMN IF NOT EXISTS admin_decision_by uuid,
  ADD COLUMN IF NOT EXISTS admin_decision_at timestamptz;

-- MODULE 4: Extended auto-resolve trigger
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
    SELECT EXISTS (
      SELECT 1 FROM public.logistics_incidents
      WHERE fulfillment_order_id = NEW.id
        AND status NOT IN ('resolved', 'closed')
    ) INTO v_has_open_incidents;

    -- When received at branch AND no open incidents, resolve pending alerts
    IF NEW.received_at_branch IS NOT NULL AND OLD.received_at_branch IS NULL AND NOT v_has_open_incidents THEN
      UPDATE public.ai_anomalies 
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;

    -- When BIMS is linked: auto-resolve alerts AND register auto-confirmation event
    IF ((NEW.bims_transfer_number IS NOT NULL AND OLD.bims_transfer_number IS NULL) 
       OR (NEW.bims_invoice_number IS NOT NULL AND OLD.bims_invoice_number IS NULL)) THEN
      
      IF NEW.status = 'pending_physical_confirmation' OR NEW.received_at_branch IS NULL THEN
        INSERT INTO public.operational_events (
          reference_type, reference_id, event_type, category,
          triggered_by, event_description,
          new_status, previous_status,
          new_location_branch_id
        ) VALUES (
          'fulfillment_order', NEW.id::text, 'branch_reception_auto_confirmed_by_bims', 'reception',
          'system', 'Recepción física auto-confirmada por detección de documento BIMS',
          'received', COALESCE(OLD.status::text, 'pending_physical_confirmation'),
          NEW.destination_branch_id
        );
      END IF;

      IF NOT v_has_open_incidents THEN
        UPDATE public.ai_anomalies
        SET is_acknowledged = true,
            acknowledged_at = now(),
            supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
        WHERE is_acknowledged = false
          AND anomaly_type IN ('prepared_without_bims', 'missing_bims_document')
          AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
      END IF;
    END IF;

    -- Driver pickup completed → resolve lost cutoff alerts
    IF NEW.status = 'dispatched' AND OLD.status IN ('waiting_for_cut', 'waiting_for_courier') THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto", "resolved_by_event": "driver_pickup"}'::jsonb
      WHERE is_acknowledged = false
        AND anomaly_type IN ('lost_cutoff', 'prepared_without_bims')
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;

    -- BIMS 48h overdue: PROGRESSIVE escalation
    IF NEW.bims_confirmation_deadline IS NOT NULL 
       AND NEW.bims_transfer_verified = false THEN
      
      IF NEW.bims_confirmation_deadline - interval '6 hours' < now()
         AND (OLD.bims_confirmation_deadline IS NULL 
              OR OLD.bims_confirmation_deadline - interval '6 hours' >= now()) THEN
        INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities, branch_id)
        VALUES (
          'bims_deadline_warning', 'logistics', 'warning', 'branch_operational',
          'Plazo BIMS 48h próximo a vencer',
          'Quedan menos de 6 horas para confirmar recepción en BIMS',
          jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text)),
          NEW.destination_branch_id
        );
      END IF;

      IF NEW.bims_confirmation_deadline < now() 
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
  END IF;

  -- MODULE 4: Auto-clean when incident is closed/resolved
  IF TG_TABLE_NAME = 'logistics_incidents' THEN
    IF NEW.status IN ('resolved', 'closed') AND OLD.status NOT IN ('resolved', 'closed') THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto", "resolved_by_event": "incident_closed"}'::jsonb
      WHERE is_acknowledged = false
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'logistics_incident', 'id', NEW.id::text));

      -- Also check if fulfillment has pending alerts that can now be resolved
      IF NEW.fulfillment_order_id IS NOT NULL THEN
        DECLARE
          v_still_open boolean;
        BEGIN
          SELECT EXISTS (
            SELECT 1 FROM public.logistics_incidents
            WHERE fulfillment_order_id = NEW.fulfillment_order_id
              AND id != NEW.id
              AND status NOT IN ('resolved', 'closed')
          ) INTO v_still_open;

          IF NOT v_still_open THEN
            UPDATE public.ai_anomalies
            SET is_acknowledged = true,
                acknowledged_at = now(),
                supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto", "resolved_by_event": "all_incidents_closed"}'::jsonb
            WHERE is_acknowledged = false
              AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.fulfillment_order_id::text));
          END IF;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger on logistics_incidents for auto-cleaning
DROP TRIGGER IF EXISTS trg_auto_resolve_on_incident ON public.logistics_incidents;
CREATE TRIGGER trg_auto_resolve_on_incident
  AFTER UPDATE ON public.logistics_incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_resolve_alerts();

-- Ensure trigger exists on fulfillment_orders
DROP TRIGGER IF EXISTS trg_auto_resolve_alerts ON public.fulfillment_orders;
CREATE TRIGGER trg_auto_resolve_alerts
  AFTER UPDATE ON public.fulfillment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_resolve_alerts();
