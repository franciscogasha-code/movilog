
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

  IF NEW.source_branch_id = NEW.requesting_branch_id THEN
    RAISE EXCEPTION 'La sucursal origen no puede ser igual a la sucursal solicitante';
  END IF;
  RETURN NEW;
END;
$$;
