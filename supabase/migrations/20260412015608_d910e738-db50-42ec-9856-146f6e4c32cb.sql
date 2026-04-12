
-- ============================================================
-- 1. Helper: can user view a consultation?
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_can_view_consultation(_user_id uuid, _consultation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Admin / owner / supervisor
    has_role(_user_id, 'admin'::app_role)
    OR has_role(_user_id, 'supervisor'::app_role)
    OR is_owner(_user_id)
    -- Creator
    OR EXISTS (
      SELECT 1 FROM public.availability_consultations
      WHERE id = _consultation_id AND created_by = _user_id
    )
    -- User belongs to requesting branch
    OR EXISTS (
      SELECT 1 FROM public.availability_consultations ac
      WHERE ac.id = _consultation_id
        AND can_access_branch(_user_id, ac.requesting_branch_id)
    )
    -- User belongs to a consulted branch
    OR EXISTS (
      SELECT 1 FROM public.consultation_targets ct
      WHERE ct.consultation_id = _consultation_id
        AND can_access_branch(_user_id, ct.branch_id)
    )
$$;

-- ============================================================
-- 2. RLS: availability_consultations
-- ============================================================
DROP POLICY IF EXISTS "Update consultations" ON public.availability_consultations;
DROP POLICY IF EXISTS "View consultations" ON public.availability_consultations;

CREATE POLICY "View consultations"
ON public.availability_consultations FOR SELECT TO authenticated
USING (fn_can_view_consultation(auth.uid(), id));

CREATE POLICY "Update consultations"
ON public.availability_consultations FOR UPDATE TO authenticated
USING (
  created_by = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR is_owner(auth.uid())
);

-- ============================================================
-- 3. RLS: consultation_targets
-- ============================================================
DROP POLICY IF EXISTS "Manage targets" ON public.consultation_targets;
DROP POLICY IF EXISTS "View targets" ON public.consultation_targets;

CREATE POLICY "View targets"
ON public.consultation_targets FOR SELECT TO authenticated
USING (fn_can_view_consultation(auth.uid(), consultation_id));

CREATE POLICY "Insert targets"
ON public.consultation_targets FOR INSERT TO authenticated
WITH CHECK (
  -- Only creator of the consultation can add targets
  EXISTS (
    SELECT 1 FROM public.availability_consultations
    WHERE id = consultation_id AND created_by = auth.uid()
  )
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

CREATE POLICY "Update own target"
ON public.consultation_targets FOR UPDATE TO authenticated
USING (
  -- Only users from the consulted branch can update their response
  can_access_branch(auth.uid(), branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

-- ============================================================
-- 4. RLS: consultation_messages
-- ============================================================
DROP POLICY IF EXISTS "View messages" ON public.consultation_messages;

CREATE POLICY "View messages"
ON public.consultation_messages FOR SELECT TO authenticated
USING (fn_can_view_consultation(auth.uid(), consultation_id));

-- ============================================================
-- 5. RLS: consultation_products
-- ============================================================
DROP POLICY IF EXISTS "Manage consultation products" ON public.consultation_products;
DROP POLICY IF EXISTS "View consultation products" ON public.consultation_products;

CREATE POLICY "View consultation products"
ON public.consultation_products FOR SELECT TO authenticated
USING (fn_can_view_consultation(auth.uid(), consultation_id));

CREATE POLICY "Insert consultation products"
ON public.consultation_products FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.availability_consultations
    WHERE id = consultation_id AND created_by = auth.uid()
  )
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

-- ============================================================
-- 6. RPC: fn_respond_consultation_target
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_respond_consultation_target(
  p_target_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_colors text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target RECORD;
  v_user_id uuid;
  v_consultation_id uuid;
  v_any_responded boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Lock row
  SELECT * INTO v_target
  FROM public.consultation_targets
  WHERE id = p_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target no encontrado';
  END IF;

  -- Validate actor: must belong to the consulted branch
  IF NOT can_access_branch(v_user_id, v_target.branch_id) 
     AND NOT has_role(v_user_id, 'admin'::app_role) 
     AND NOT is_owner(v_user_id) THEN
    RAISE EXCEPTION 'No tiene permisos para responder por esta sucursal';
  END IF;

  -- Allow re-response (update)
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
    'consultation_id', v_consultation_id
  );
END;
$$;

-- ============================================================
-- 7. Function: auto-close expired consultations
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_close_expired_consultations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.availability_consultations
  SET status = 'expired', updated_at = now()
  WHERE status IN ('open', 'responded')
    AND auto_close_at IS NOT NULL
    AND auto_close_at < now();
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- 8. RLS: consultation_requests (tighten)
-- ============================================================
DROP POLICY IF EXISTS "Manage consultation requests" ON public.consultation_requests;
DROP POLICY IF EXISTS "View consultation requests" ON public.consultation_requests;

CREATE POLICY "View consultation requests"
ON public.consultation_requests FOR SELECT TO authenticated
USING (fn_can_view_consultation(auth.uid(), consultation_id));

CREATE POLICY "Insert consultation requests"
ON public.consultation_requests FOR INSERT TO authenticated
WITH CHECK (
  fn_can_view_consultation(auth.uid(), consultation_id)
);
