ALTER TABLE public.branch_requests
  DROP CONSTRAINT IF EXISTS chk_logistic_fields_required_when_not_presale;

ALTER TABLE public.branch_requests
  ADD CONSTRAINT chk_logistic_fields_required_when_not_presale
  CHECK (
    is_pre_sale = true
    OR status IN ('in_supply'::request_status, 'supplied'::request_status)
    OR (
      source_branch_id IS NOT NULL
      AND delivery_target IS NOT NULL
      AND shipping_method IS NOT NULL
    )
  );