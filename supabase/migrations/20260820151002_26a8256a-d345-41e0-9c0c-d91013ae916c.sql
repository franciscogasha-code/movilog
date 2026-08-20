DO $mig$
DECLARE
  v_def text;
  v_new text;
  v_old_block text := '      rejection_reason = COALESCE(p_rejection_reason_type, rejection_reason),';
  v_new_block text := '      rejection_reason = CASE
        WHEN p_new_status = ''rejected'' THEN COALESCE(p_reason, rejection_reason)
        ELSE rejection_reason
      END,
      rejection_reason_type = CASE
        WHEN p_new_status = ''rejected'' AND p_rejection_reason_type IS NOT NULL
          THEN p_rejection_reason_type::public.rejection_reason_type
        ELSE rejection_reason_type
      END,
      rejected_by = CASE
        WHEN p_new_status = ''rejected'' THEN COALESCE(v_user_id, rejected_by)
        ELSE rejected_by
      END,
      rejected_at = CASE
        WHEN p_new_status = ''rejected'' THEN now()
        ELSE rejected_at
      END,';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_transition_request_status'
    AND p.pronargs = 5;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'No se encontró fn_transition_request_status(5 args)';
  END IF;

  v_new := replace(v_def, v_old_block, v_new_block);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'No se encontró el bloque UPDATE esperado; migración abortada';
  END IF;

  EXECUTE v_new;
END
$mig$;