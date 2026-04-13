-- 1. Add operational_responsible_id column
ALTER TABLE public.branch_requests
  ADD COLUMN operational_responsible_id uuid DEFAULT NULL;

-- 2. Update trigger to allow online + client + same branch
CREATE OR REPLACE FUNCTION public.fn_validate_different_branches()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Allow parent multi-origin requests (placeholder source = requesting)
  IF NEW.notes IS NOT NULL AND NEW.notes LIKE '%[Pedido padre multi-origen]%' THEN
    RETURN NEW;
  END IF;

  -- Allow online + client ONLY when origin = requester (direct sale)
  IF NEW.request_type = 'online'
     AND NEW.delivery_target = 'client'
     AND NEW.source_branch_id = NEW.requesting_branch_id THEN
    RETURN NEW;
  END IF;

  IF NEW.source_branch_id = NEW.requesting_branch_id THEN
    RAISE EXCEPTION 'La sucursal origen no puede ser igual a la sucursal solicitante';
  END IF;
  RETURN NEW;
END;
$$;