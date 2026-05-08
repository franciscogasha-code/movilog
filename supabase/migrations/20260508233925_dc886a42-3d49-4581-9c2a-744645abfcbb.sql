-- Fix bug #4: fn_sync_parent_status no debe sincronizar cuando el padre
-- está en in_supply/supplied. En esa fase, el estado del padre se gestiona
-- exclusivamente por fn_confirm_local_supply, fn_auto_promote_to_supplied
-- y fn_start_operation_from_supplied. La sincronización por agregación de
-- hijos colisiona con trg_block_supply_transitions y bloquea la creación
-- de pedidos internos hijos legítimos.

CREATE OR REPLACE FUNCTION public.fn_sync_parent_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parent_id uuid;
  v_total integer;
  v_terminal integer;
  v_pending integer;
  v_new_parent_status request_status;
  v_current_parent_status request_status;
BEGIN
  IF NEW.parent_request_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_parent_id := NEW.parent_request_id;

  SELECT status INTO v_current_parent_status
  FROM public.branch_requests WHERE id = v_parent_id;

  -- Fase de abastecimiento: el estado del padre lo manejan
  -- fn_confirm_local_supply / fn_auto_promote_to_supplied / fn_start_operation_from_supplied.
  -- No agregamos por hijos para evitar transiciones bloqueadas por
  -- trg_block_supply_transitions.
  IF v_current_parent_status IN ('in_supply'::request_status, 'supplied'::request_status) THEN
    RETURN NEW;
  END IF;

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

  IF v_current_parent_status IS DISTINCT FROM v_new_parent_status THEN
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
$function$;