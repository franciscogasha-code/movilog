-- =========================================================
-- BLOQUE 1+2: Cierre automático de pedidos padre multi-origen
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_close_parent_if_complete(p_parent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_terminal int;
  v_closed int;
  v_rejected int;
  v_parent_status request_status;
BEGIN
  SELECT status INTO v_parent_status
  FROM branch_requests WHERE id = p_parent_id AND parent_request_id IS NULL;

  IF v_parent_status IS NULL THEN RETURN; END IF;
  IF v_parent_status IN ('closed','rejected') THEN RETURN; END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status IN ('closed','rejected')),
         COUNT(*) FILTER (WHERE status = 'closed'),
         COUNT(*) FILTER (WHERE status = 'rejected')
    INTO v_total, v_terminal, v_closed, v_rejected
  FROM branch_requests
  WHERE parent_request_id = p_parent_id;

  IF v_total = 0 OR v_total <> v_terminal THEN RETURN; END IF;

  IF v_closed > 0 THEN
    UPDATE branch_requests
       SET status = 'closed',
           closed_at = COALESCE(closed_at, now()),
           updated_at = now(),
           notes = COALESCE(notes,'') || E'\n[Sistema] Cerrado automáticamente al completar todos los hijos.'
     WHERE id = p_parent_id;
  ELSE
    UPDATE branch_requests
       SET status = 'rejected',
           rejected_at = COALESCE(rejected_at, now()),
           updated_at = now(),
           notes = COALESCE(notes,'') || E'\n[Sistema] Rechazado automáticamente: todos los hijos rechazados.'
     WHERE id = p_parent_id;
  END IF;
END;
$$;

-- Trigger que dispara al cambiar estado de un hijo
CREATE OR REPLACE FUNCTION public.fn_trg_close_parent_on_child_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_request_id IS NOT NULL
     AND NEW.status IN ('closed','rejected')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.fn_close_parent_if_complete(NEW.parent_request_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_parent_on_child_change ON public.branch_requests;
CREATE TRIGGER trg_close_parent_on_child_change
AFTER UPDATE OF status ON public.branch_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_trg_close_parent_on_child_change();

-- =========================================================
-- BLOQUE 5: Vista de monitoreo de integridad (solo lectura)
-- =========================================================
CREATE OR REPLACE VIEW public.v_pedidos_integridad AS
WITH parent_open_all_terminal AS (
  SELECT p.id AS issue_ref, p.request_number,
         'parent_open_all_children_terminal' AS issue_type,
         p.status::text AS current_status,
         p.created_at
  FROM branch_requests p
  WHERE p.parent_request_id IS NULL
    AND p.status NOT IN ('closed','rejected')
    AND EXISTS (SELECT 1 FROM branch_requests c WHERE c.parent_request_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM branch_requests c
      WHERE c.parent_request_id = p.id AND c.status NOT IN ('closed','rejected')
    )
),
consolidation_no_fo AS (
  SELECT br.id AS issue_ref, br.request_number,
         'in_consolidation_without_fo' AS issue_type,
         br.status::text AS current_status,
         br.created_at
  FROM branch_requests br
  WHERE br.status = 'in_consolidation'
    AND NOT EXISTS (SELECT 1 FROM fulfillment_orders fo WHERE fo.branch_request_id = br.id)
),
br_fo_desync AS (
  SELECT DISTINCT br.id AS issue_ref, br.request_number,
         'br_fo_status_desync' AS issue_type,
         br.status::text AS current_status,
         br.created_at
  FROM branch_requests br
  JOIN fulfillment_orders fo ON fo.branch_request_id = br.id
  WHERE (br.status IN ('closed','logistic_closed') AND fo.status NOT IN ('delivered','received','completed','cancelled'))
     OR (br.status = 'in_transit' AND fo.status = 'pending')
     OR (br.status = 'delivered' AND fo.status IN ('pending','picking'))
),
stuck_long AS (
  SELECT br.id AS issue_ref, br.request_number,
         'stuck_over_15_days' AS issue_type,
         br.status::text AS current_status,
         br.created_at
  FROM branch_requests br
  WHERE br.status NOT IN ('closed','rejected')
    AND br.created_at < now() - interval '15 days'
    AND br.parent_request_id IS NULL
)
SELECT * FROM parent_open_all_terminal
UNION ALL SELECT * FROM consolidation_no_fo
UNION ALL SELECT * FROM br_fo_desync
UNION ALL SELECT * FROM stuck_long;