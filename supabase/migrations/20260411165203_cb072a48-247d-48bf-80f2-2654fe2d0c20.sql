
-- 1. Create is_owner function
CREATE OR REPLACE FUNCTION public.is_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'owner'
  )
$$;

-- 2. Protection trigger for user_roles
CREATE OR REPLACE FUNCTION public.fn_protect_owner_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'owner' OR is_owner(OLD.user_id) THEN
      IF NOT is_owner(auth.uid()) THEN
        RAISE EXCEPTION 'No se puede modificar el rol de un propietario del sistema';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'owner' OR is_owner(OLD.user_id) THEN
      IF NOT is_owner(auth.uid()) THEN
        RAISE EXCEPTION 'No se puede modificar el rol de un propietario del sistema';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_owner_roles
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_owner_roles();

-- 3. Protection trigger for profiles
CREATE OR REPLACE FUNCTION public.fn_protect_owner_profiles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF is_owner(OLD.user_id) AND NOT is_owner(auth.uid()) THEN
      IF OLD.user_id != auth.uid() THEN
        RAISE EXCEPTION 'No se puede modificar el perfil de un propietario del sistema';
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
$$;

CREATE TRIGGER trg_protect_owner_profiles
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_owner_profiles();

-- 4. Protection trigger for profile_branch_access
CREATE OR REPLACE FUNCTION public.fn_protect_owner_branch_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT user_id INTO v_owner_user_id FROM public.profiles WHERE id = OLD.profile_id;
    IF is_owner(v_owner_user_id) AND NOT is_owner(auth.uid()) THEN
      RAISE EXCEPTION 'No se puede modificar el acceso de sucursales de un propietario del sistema';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT user_id INTO v_owner_user_id FROM public.profiles WHERE id = OLD.profile_id;
    IF is_owner(v_owner_user_id) AND NOT is_owner(auth.uid()) THEN
      RAISE EXCEPTION 'No se puede modificar el acceso de sucursales de un propietario del sistema';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_owner_branch_access
BEFORE UPDATE OR DELETE ON public.profile_branch_access
FOR EACH ROW
EXECUTE FUNCTION public.fn_protect_owner_branch_access();

-- 5. Assign owner role (without ON CONFLICT since no unique constraint)
INSERT INTO public.user_roles (user_id, role)
SELECT au.id, 'owner'::app_role
FROM auth.users au
WHERE au.email IN ('francisco.gasha@gmail.com', 'juanaquino@sansei.com.py')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = au.id AND ur.role = 'owner'
  );

-- 6. Update RLS policies
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin insert profiles" ON public.profiles;
CREATE POLICY "Admin insert profiles" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Admin manage branch access" ON public.profile_branch_access;
CREATE POLICY "Admin manage branch access" ON public.profile_branch_access
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Users view own branch access" ON public.profile_branch_access;
CREATE POLICY "Users view own branch access" ON public.profile_branch_access
FOR SELECT TO authenticated
USING (profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin manage roles" ON public.user_roles;
CREATE POLICY "Admin manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin manage drivers" ON public.drivers;
CREATE POLICY "Admin manage drivers" ON public.drivers
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin manage branches" ON public.branches;
CREATE POLICY "Admin manage branches" ON public.branches
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin manage products" ON public.products;
CREATE POLICY "Admin manage products" ON public.products
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin KPI defs" ON public.kpi_definitions;
CREATE POLICY "Admin KPI defs" ON public.kpi_definitions
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Admin KPI targets" ON public.kpi_targets;
CREATE POLICY "Admin KPI targets" ON public.kpi_targets
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage anomalies" ON public.ai_anomalies;
CREATE POLICY "Manage anomalies" ON public.ai_anomalies
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage recommendations" ON public.ai_recommendations;
CREATE POLICY "Manage recommendations" ON public.ai_recommendations
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage fulfillments" ON public.fulfillment_orders;
CREATE POLICY "Manage fulfillments" ON public.fulfillment_orders
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR has_role(auth.uid(), 'driver'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage committed stock" ON public.committed_stock;
CREATE POLICY "Manage committed stock" ON public.committed_stock
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage inventories" ON public.directed_inventories;
CREATE POLICY "Manage inventories" ON public.directed_inventories
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'warehouse_operator'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Manage special stock" ON public.special_stock;
CREATE POLICY "Manage special stock" ON public.special_stock
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR is_owner(auth.uid()));

DROP POLICY IF EXISTS "Update requests" ON public.branch_requests;
CREATE POLICY "Update requests" ON public.branch_requests
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR is_owner(auth.uid()) OR created_by = auth.uid());

DROP POLICY IF EXISTS "Update incidents" ON public.logistics_incidents;
CREATE POLICY "Update incidents" ON public.logistics_incidents
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR is_owner(auth.uid()) OR reported_by = auth.uid());
