-- ═══════════════════════════════════════════════════════════════════
-- TRIGGER: sincronización automática del estado del padre
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_sync_parent_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_id uuid;
  v_total integer;
  v_terminal integer;
  v_pending integer;
  v_new_parent_status request_status;
  v_current_parent_status request_status;
BEGIN
  -- Solo nos interesan cambios reales de status en hijos
  IF NEW.parent_request_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_parent_id := NEW.parent_request_id;

  SELECT
    COUNT(*) FILTER (WHERE TRUE),
    COUNT(*) FILTER (WHERE status IN ('closed','rejected')),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO v_total, v_terminal, v_pending
  FROM public.branch_requests
  WHERE parent_request_id = v_parent_id;

  IF v_total = 0 THEN
    RETURN NEW;
  END IF;

  IF v_terminal = v_total THEN
    v_new_parent_status := 'closed'::request_status;
  ELSIF v_pending = v_total THEN
    v_new_parent_status := 'pending'::request_status;
  ELSE
    v_new_parent_status := 'accepted'::request_status;
  END IF;

  SELECT status INTO v_current_parent_status
  FROM public.branch_requests WHERE id = v_parent_id;

  IF v_current_parent_status IS DISTINCT FROM v_new_parent_status THEN
    -- Bypass del guard de la RPC para esta escritura controlada
    PERFORM set_config('movilog.sync_parent_status', 'on', true);
    UPDATE public.branch_requests
    SET status = v_new_parent_status,
        updated_at = now(),
        closed_at = CASE WHEN v_new_parent_status = 'closed' THEN COALESCE(closed_at, now()) ELSE closed_at END
    WHERE id = v_parent_id;
    PERFORM set_config('movilog.sync_parent_status', 'off', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_parent_status ON public.branch_requests;
CREATE TRIGGER tr_sync_parent_status
  AFTER INSERT OR UPDATE OF status ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_parent_status();

-- ═══════════════════════════════════════════════════════════════════
-- SANEAMIENTO LEGACY (no destructivo)
-- ═══════════════════════════════════════════════════════════════════

-- A) Padres con todos los hijos en estado terminal → cerrar automáticamente
DO $$
DECLARE
  r RECORD;
BEGIN
  PERFORM set_config('movilog.sync_parent_status', 'on', true);
  FOR r IN
    SELECT p.id
    FROM public.branch_requests p
    WHERE p.notes LIKE '[Pedido padre multi-origen]%'
      AND p.status NOT IN ('closed','rejected')
      AND EXISTS (SELECT 1 FROM public.branch_requests c WHERE c.parent_request_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.branch_requests c
        WHERE c.parent_request_id = p.id AND c.status NOT IN ('closed','rejected')
      )
  LOOP
    UPDATE public.branch_requests
    SET status = 'closed'::request_status,
        closed_at = COALESCE(closed_at, now()),
        notes = COALESCE(notes,'') || ' [LEGACY] Cerrado automáticamente por saneamiento.',
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
  PERFORM set_config('movilog.sync_parent_status', 'off', true);
END $$;

-- B) Padres con un único hijo → marcar como legacy (no se borra nada, no se altera el hijo)
UPDATE public.branch_requests p
SET notes = COALESCE(p.notes,'') || ' [LEGACY 1-hijo]',
    updated_at = now()
WHERE p.notes LIKE '[Pedido padre multi-origen]%'
  AND p.notes NOT LIKE '%[LEGACY 1-hijo]%'
  AND (SELECT COUNT(*) FROM public.branch_requests c WHERE c.parent_request_id = p.id) = 1;