CREATE OR REPLACE FUNCTION public.fn_auto_resolve_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_open_incidents boolean;
  v_actor uuid;
BEGIN
  IF TG_TABLE_NAME = 'fulfillment_orders' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.logistics_incidents
      WHERE fulfillment_order_id = NEW.id
        AND status NOT IN ('resolved', 'closed')
    ) INTO v_has_open_incidents;

    IF NEW.received_at_branch IS NOT NULL AND OLD.received_at_branch IS NULL AND NOT v_has_open_incidents THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto"}'::jsonb
      WHERE is_acknowledged = false
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;

    IF ((NEW.bims_transfer_number IS NOT NULL AND OLD.bims_transfer_number IS NULL)
       OR (NEW.bims_invoice_number IS NOT NULL AND OLD.bims_invoice_number IS NULL)) THEN

      IF NEW.status = 'pending_physical_confirmation' OR NEW.received_at_branch IS NULL THEN
        v_actor := COALESCE(
          auth.uid(),
          (SELECT created_by FROM public.branch_requests WHERE id = NEW.branch_request_id),
          (SELECT dispatched_by FROM public.fulfillment_orders WHERE id = NEW.id)
        );

        IF v_actor IS NOT NULL THEN
          INSERT INTO public.operational_events (
            reference_type, reference_id, event_type, category,
            triggered_by, event_description,
            new_status, previous_status,
            new_location_branch_id
          ) VALUES (
            'fulfillment_order', NEW.id, 'branch_reception_auto_confirmed_by_bims', 'reception',
            v_actor, 'Recepción física auto-confirmada por detección de documento BIMS',
            'received', COALESCE(OLD.status::text, 'pending_physical_confirmation'),
            NEW.destination_branch_id
          );
        END IF;
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

    IF NEW.status = 'dispatched' AND OLD.status IN ('waiting_for_cut', 'waiting_for_courier') THEN
      UPDATE public.ai_anomalies
      SET is_acknowledged = true,
          acknowledged_at = now(),
          supporting_data = COALESCE(supporting_data, '{}'::jsonb) || '{"resolution_type": "resolved_auto", "resolved_by_event": "driver_pickup"}'::jsonb
      WHERE is_acknowledged = false
        AND anomaly_type IN ('lost_cutoff', 'prepared_without_bims')
        AND affected_entities @> jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text));
    END IF;

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
          'La sucursal no confirmó recepción en BIMS dentro del plazo',
          jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', NEW.id::text)),
          NEW.destination_branch_id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;