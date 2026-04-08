
-- Server-side validation of business rules matrix
CREATE OR REPLACE FUNCTION public.fn_validate_business_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Rule 1: Reposition can only target branch
  IF NEW.request_type = 'reposition' AND NEW.delivery_target = 'client' THEN
    RAISE EXCEPTION 'Reposición solo puede tener destino sucursal, no cliente';
  END IF;

  -- Rule 2: If parent_request_id is set, validate it exists
  IF NEW.parent_request_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.branch_requests WHERE id = NEW.parent_request_id) THEN
      RAISE EXCEPTION 'La solicitud padre referenciada no existe';
    END IF;
  END IF;

  -- Rule 3: For client delivery (mono-origin enforcement)
  -- If this is a child request with delivery_target = client, 
  -- check that no sibling has a different source_branch_id
  IF NEW.parent_request_id IS NOT NULL AND NEW.delivery_target = 'client' THEN
    IF EXISTS (
      SELECT 1 FROM public.branch_requests
      WHERE parent_request_id = NEW.parent_request_id
        AND id != NEW.id
        AND source_branch_id != NEW.source_branch_id
    ) THEN
      RAISE EXCEPTION 'Pedido a cliente requiere origen único: ya existen transferencias con origen diferente';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger
CREATE TRIGGER trg_validate_business_rules
  BEFORE INSERT OR UPDATE ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_business_rules();

-- Add duration_seconds column to sync_logs for observability
ALTER TABLE public.sync_logs ADD COLUMN IF NOT EXISTS duration_seconds numeric DEFAULT NULL;
