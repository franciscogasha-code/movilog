
-- 1. Update fn_protect_owner_roles to prevent last owner removal
CREATE OR REPLACE FUNCTION public.fn_protect_owner_roles()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' THEN
      -- Block non-owners
      IF NOT is_owner(auth.uid()) THEN
        RAISE EXCEPTION 'No se puede modificar el rol de un propietario del sistema';
      END IF;
      -- Block last owner removal
      SELECT count(*) INTO v_owner_count
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      WHERE ur.role = 'owner' AND p.is_active = true AND ur.user_id != OLD.user_id;
      IF v_owner_count < 1 THEN
        RAISE EXCEPTION 'No se puede eliminar el rol del último propietario activo del sistema';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Changing FROM owner to something else
    IF OLD.role = 'owner' AND NEW.role != 'owner' THEN
      IF NOT is_owner(auth.uid()) THEN
        RAISE EXCEPTION 'No se puede modificar el rol de un propietario del sistema';
      END IF;
      SELECT count(*) INTO v_owner_count
      FROM public.user_roles ur
      JOIN public.profiles p ON p.user_id = ur.user_id
      WHERE ur.role = 'owner' AND p.is_active = true AND ur.user_id != OLD.user_id;
      IF v_owner_count < 1 THEN
        RAISE EXCEPTION 'No se puede degradar al último propietario activo del sistema';
      END IF;
    END IF;
    -- Protect owner records from non-owners
    IF OLD.role = 'owner' OR is_owner(OLD.user_id) THEN
      IF NOT is_owner(auth.uid()) THEN
        RAISE EXCEPTION 'No se puede modificar el rol de un propietario del sistema';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Update fn_protect_owner_profiles to prevent deactivating last owner
CREATE OR REPLACE FUNCTION public.fn_protect_owner_profiles()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_count integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF is_owner(OLD.user_id) THEN
      -- Block non-owners from editing owner profiles
      IF NOT is_owner(auth.uid()) AND OLD.user_id != auth.uid() THEN
        RAISE EXCEPTION 'No se puede modificar el perfil de un propietario del sistema';
      END IF;
      -- Block deactivating last active owner
      IF OLD.is_active = true AND NEW.is_active = false THEN
        SELECT count(*) INTO v_owner_count
        FROM public.user_roles ur
        JOIN public.profiles p ON p.user_id = ur.user_id
        WHERE ur.role = 'owner' AND p.is_active = true AND p.user_id != OLD.user_id;
        IF v_owner_count < 1 THEN
          RAISE EXCEPTION 'No se puede desactivar al último propietario activo del sistema';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF is_owner(OLD.user_id) AND NOT is_owner(auth.uid()) THEN
      RAISE EXCEPTION 'No se puede eliminar el perfil de un propietario del sistema';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;
