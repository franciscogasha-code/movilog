
-- 1) Helper para derivar flow_type
CREATE OR REPLACE FUNCTION public.fn_derive_flow_type(
  p_delivery_target text,
  p_source_branch_id uuid,
  p_requesting_branch_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_group text;
  v_dest_group text;
BEGIN
  IF p_delivery_target = 'client' THEN
    RETURN 'client_delivery';
  END IF;
  IF p_source_branch_id = p_requesting_branch_id THEN
    RETURN 'urban';
  END IF;
  SELECT logistic_group INTO v_source_group FROM public.branches WHERE id = p_source_branch_id;
  SELECT logistic_group INTO v_dest_group FROM public.branches WHERE id = p_requesting_branch_id;
  IF v_source_group IS NOT NULL AND v_dest_group IS NOT NULL AND v_source_group = v_dest_group THEN
    RETURN 'urban';
  END IF;
  RETURN 'interurban';
END;
$$;

-- 2) Trigger BEFORE INSERT/UPDATE para auto-setear flow_type cuando viene NULL
CREATE OR REPLACE FUNCTION public.fn_autoset_flow_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.flow_type IS NULL THEN
    NEW.flow_type := public.fn_derive_flow_type(
      NEW.delivery_target::text,
      NEW.source_branch_id,
      NEW.requesting_branch_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoset_flow_type ON public.branch_requests;
CREATE TRIGGER trg_autoset_flow_type
BEFORE INSERT OR UPDATE OF delivery_target, source_branch_id, requesting_branch_id, flow_type
ON public.branch_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_autoset_flow_type();

-- 3) Backfill de registros legacy con flow_type NULL
-- Bypaseamos validaciones legacy (ej. fn_validate_different_branches) porque
-- estos registros ya existen y fueron válidos al momento de creación.
ALTER TABLE public.branch_requests DISABLE TRIGGER USER;

UPDATE public.branch_requests br
SET flow_type = public.fn_derive_flow_type(
  br.delivery_target::text,
  br.source_branch_id,
  br.requesting_branch_id
)
WHERE br.flow_type IS NULL;

ALTER TABLE public.branch_requests ENABLE TRIGGER USER;
