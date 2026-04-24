DROP VIEW IF EXISTS public.v_pedidos_integridad;

CREATE VIEW public.v_pedidos_integridad
WITH (security_invoker = true) AS
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

REVOKE ALL ON public.v_pedidos_integridad FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pedidos_integridad TO authenticated;