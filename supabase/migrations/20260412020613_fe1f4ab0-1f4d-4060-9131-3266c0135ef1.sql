
-- 1. Allow admin/supervisor/owner to send messages in any consultation
DROP POLICY IF EXISTS "Send messages" ON public.consultation_messages;
CREATE POLICY "Send messages"
ON public.consultation_messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND (
    fn_can_view_consultation(auth.uid(), consultation_id)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR is_owner(auth.uid())
  )
);

-- 2. Also allow admins to VIEW any consultation messages
DROP POLICY IF EXISTS "View messages" ON public.consultation_messages;
CREATE POLICY "View messages"
ON public.consultation_messages
FOR SELECT
TO authenticated
USING (
  fn_can_view_consultation(auth.uid(), consultation_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR is_owner(auth.uid())
);

-- 3. Enhance fn_respond_consultation_target with consultation status validation
CREATE OR REPLACE FUNCTION public.fn_respond_consultation_target(
  p_target_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_colors text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target RECORD;
  v_user_id uuid;
  v_consultation_id uuid;
  v_consultation_status text;
  v_any_responded boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Lock target row for concurrency control
  SELECT * INTO v_target
  FROM public.consultation_targets
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target no encontrado';
  END IF;

  -- Validate consultation is still active
  SELECT status::text INTO v_consultation_status
  FROM public.availability_consultations
  WHERE id = v_target.consultation_id
  FOR UPDATE;

  IF v_consultation_status NOT IN ('open', 'responded') THEN
    RAISE EXCEPTION 'La consulta ya no acepta respuestas (estado: %)', v_consultation_status;
  END IF;

  -- Validate actor: must belong to the consulted branch
  IF NOT can_access_branch(v_user_id, v_target.branch_id)
     AND NOT has_role(v_user_id, 'admin'::app_role)
     AND NOT has_role(v_user_id, 'supervisor'::app_role)
     AND NOT is_owner(v_user_id) THEN
    RAISE EXCEPTION 'No tiene permisos para responder por esta sucursal';
  END IF;

  -- Update response (allows re-response / edit)
  UPDATE public.consultation_targets SET
    response_quantity = p_quantity,
    response_colors = p_colors,
    response_note = p_note,
    responded_by = v_user_id,
    responded_at = now()
  WHERE id = p_target_id;

  v_consultation_id := v_target.consultation_id;

  -- Auto-update consultation status to 'responded' if still 'open'
  SELECT EXISTS (
    SELECT 1 FROM public.consultation_targets
    WHERE consultation_id = v_consultation_id AND responded_at IS NOT NULL
  ) INTO v_any_responded;

  IF v_any_responded THEN
    UPDATE public.availability_consultations
    SET status = 'responded', updated_at = now()
    WHERE id = v_consultation_id AND status = 'open';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'target_id', p_target_id,
    'consultation_id', v_consultation_id,
    'was_update', v_target.responded_at IS NOT NULL
  );
END;
$function$;
