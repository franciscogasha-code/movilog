CREATE OR REPLACE FUNCTION public.fn_validate_driver_pickup(p_fulfillment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fo record;
  v_req_doc record;
BEGIN
  SELECT bims_transfer_number, bims_invoice_number, status, branch_request_id
  INTO v_fo
  FROM public.fulfillment_orders
  WHERE id = p_fulfillment_id;

  IF v_fo IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Fulfillment not found');
  END IF;

  -- 1) Si el fulfillment ya tiene documento, OK
  IF v_fo.bims_transfer_number IS NOT NULL OR v_fo.bims_invoice_number IS NOT NULL THEN
    RETURN jsonb_build_object('allowed', true, 'has_transfer', v_fo.bims_transfer_number IS NOT NULL, 'has_invoice', v_fo.bims_invoice_number IS NOT NULL);
  END IF;

  -- 2) Buscar documento vinculado al pedido (request) y propagarlo al fulfillment
  IF v_fo.branch_request_id IS NOT NULL THEN
    SELECT document_type, document_number
    INTO v_req_doc
    FROM public.request_bims_documents
    WHERE request_id = v_fo.branch_request_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_req_doc.document_number IS NOT NULL THEN
      UPDATE public.fulfillment_orders
      SET
        bims_transfer_number = CASE WHEN v_req_doc.document_type = 'transfer' THEN v_req_doc.document_number ELSE bims_transfer_number END,
        bims_invoice_number  = CASE WHEN v_req_doc.document_type = 'invoice'  THEN v_req_doc.document_number ELSE bims_invoice_number END,
        updated_at = now()
      WHERE id = p_fulfillment_id;

      RETURN jsonb_build_object(
        'allowed', true,
        'source', 'request_document',
        'has_transfer', v_req_doc.document_type = 'transfer',
        'has_invoice',  v_req_doc.document_type = 'invoice'
      );
    END IF;
  END IF;

  -- 3) No hay documento por ningún lado
  INSERT INTO public.ai_anomalies (anomaly_type, area, severity, alert_level, title, description, affected_entities)
  VALUES (
    'missing_bims_document', 'logistics', 'warning', 'branch_operational',
    'Orden preparada sin transferencia/factura BIMS',
    'El chofer intentó retirar sin documento BIMS vinculado',
    jsonb_build_array(jsonb_build_object('type', 'fulfillment_order', 'id', p_fulfillment_id))
  );
  RETURN jsonb_build_object('allowed', false, 'reason', 'No existe transferencia ni factura BIMS vinculada');
END;
$function$;