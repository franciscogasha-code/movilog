-- RPC para garantizar la existencia de una ficha en drivers para un usuario dado.
-- Permite que el Jefe de Logística (o cualquier usuario autenticado autorizado a crear viajes)
-- asigne como chofer a un Operador Logístico aunque no tenga ficha previa,
-- sin requerir permisos directos de INSERT sobre la tabla drivers (que está restringida a admin/owner por RLS).
CREATE OR REPLACE FUNCTION public.fn_ensure_driver_for_user(_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id requerido';
  END IF;

  -- Solo roles operativos relevantes pueden disparar la creación automática
  IF NOT (
    public.has_role(v_caller, 'admin'::app_role)
    OR public.has_role(v_caller, 'supervisor'::app_role)
    OR public.has_role(v_caller, 'jefe_logistica'::app_role)
    OR public.is_owner(v_caller)
  ) THEN
    RAISE EXCEPTION 'No autorizado para asignar choferes';
  END IF;

  -- Reusar ficha existente si ya hay una
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = _user_id
  LIMIT 1;

  IF v_driver_id IS NOT NULL THEN
    -- Asegurar que esté activa
    UPDATE public.drivers SET is_active = true, updated_at = now()
    WHERE id = v_driver_id AND is_active IS DISTINCT FROM true;
    RETURN v_driver_id;
  END IF;

  -- Validar que el usuario destino sea elegible (operador logístico, chofer o jefe logística)
  IF NOT (
    public.has_role(_user_id, 'warehouse_operator'::app_role)
    OR public.has_role(_user_id, 'driver'::app_role)
    OR public.has_role(_user_id, 'jefe_logistica'::app_role)
  ) THEN
    RAISE EXCEPTION 'El usuario seleccionado no es elegible como chofer';
  END IF;

  INSERT INTO public.drivers (user_id, is_active)
  VALUES (_user_id, true)
  RETURNING id INTO v_driver_id;

  RETURN v_driver_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ensure_driver_for_user(uuid) TO authenticated;