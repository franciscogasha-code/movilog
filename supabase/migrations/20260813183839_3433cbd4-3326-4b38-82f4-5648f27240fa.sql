-- Helper: privileged roles
CREATE OR REPLACE FUNCTION public.is_privileged(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_owner(_user_id)
      OR public.has_role(_user_id, 'admin'::app_role)
      OR public.has_role(_user_id, 'supervisor'::app_role)
      OR public.has_role(_user_id, 'jefe_logistica'::app_role);
$$;

CREATE OR REPLACE FUNCTION public.is_own_driver(_user_id uuid, _driver_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _driver_id AND d.user_id = _user_id);
$$;

-- 1. sales_customers
DROP POLICY IF EXISTS "Ver clientes comerciales" ON public.sales_customers;
CREATE POLICY "Ver clientes comerciales" ON public.sales_customers FOR SELECT TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR public.has_role(auth.uid(), 'salesperson'::app_role)
);

-- 2. user_module_access
DROP POLICY IF EXISTS "Manage module access" ON public.user_module_access;
DROP POLICY IF EXISTS "View module access" ON public.user_module_access;
CREATE POLICY "Admins manage module access" ON public.user_module_access FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_owner(auth.uid()))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_owner(auth.uid()));
CREATE POLICY "View own module access" ON public.user_module_access FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role) OR public.is_owner(auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = user_module_access.profile_id AND p.user_id = auth.uid())
);
REVOKE ALL ON public.user_module_access FROM anon;

-- 3. branches: remove anon access
DROP POLICY IF EXISTS "Anon view branches" ON public.branches;
REVOKE ALL ON public.branches FROM anon;

-- 4. user_roles duplicate policy
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

-- 5. financial / operational tables
DROP POLICY IF EXISTS "View bank deposits" ON public.bank_deposits;
DROP POLICY IF EXISTS "Manage bank deposits" ON public.bank_deposits;
CREATE POLICY "bank_deposits_select" ON public.bank_deposits FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));
CREATE POLICY "bank_deposits_write" ON public.bank_deposits FOR ALL TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id))
WITH CHECK (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "View driver collections" ON public.driver_collections;
DROP POLICY IF EXISTS "Manage driver collections" ON public.driver_collections;
CREATE POLICY "driver_collections_select" ON public.driver_collections FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));
CREATE POLICY "driver_collections_write" ON public.driver_collections FOR ALL TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id))
WITH CHECK (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "View settlements" ON public.driver_settlements;
DROP POLICY IF EXISTS "Manage settlements" ON public.driver_settlements;
CREATE POLICY "driver_settlements_select" ON public.driver_settlements FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));
CREATE POLICY "driver_settlements_write" ON public.driver_settlements FOR ALL TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id))
WITH CHECK (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "View per diem" ON public.per_diem_records;
CREATE POLICY "per_diem_select" ON public.per_diem_records FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "fr_select" ON public.fuel_records;
CREATE POLICY "fr_select" ON public.fuel_records FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "fines_select_authenticated" ON public.vehicle_fines;
CREATE POLICY "fines_select_authenticated" ON public.vehicle_fines FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR public.is_own_driver(auth.uid(), driver_id));

DROP POLICY IF EXISTS "View loans" ON public.vehicle_loans;
DROP POLICY IF EXISTS "Manage loans" ON public.vehicle_loans;
CREATE POLICY "vehicle_loans_select" ON public.vehicle_loans FOR SELECT TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR public.can_access_branch(auth.uid(), lending_branch_id)
  OR public.can_access_branch(auth.uid(), borrowing_branch_id)
);
CREATE POLICY "vehicle_loans_write" ON public.vehicle_loans FOR ALL TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR public.can_access_branch(auth.uid(), lending_branch_id)
  OR public.can_access_branch(auth.uid(), borrowing_branch_id)
)
WITH CHECK (
  public.is_privileged(auth.uid())
  OR public.can_access_branch(auth.uid(), lending_branch_id)
  OR public.can_access_branch(auth.uid(), borrowing_branch_id)
);

DROP POLICY IF EXISTS "View deposit links" ON public.deposit_collection_links;
DROP POLICY IF EXISTS "Manage deposit links" ON public.deposit_collection_links;
CREATE POLICY "deposit_links_select" ON public.deposit_collection_links FOR SELECT TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR EXISTS (SELECT 1 FROM public.bank_deposits bd WHERE bd.id = deposit_collection_links.deposit_id
             AND public.is_own_driver(auth.uid(), bd.driver_id))
);
CREATE POLICY "deposit_links_write" ON public.deposit_collection_links FOR ALL TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR EXISTS (SELECT 1 FROM public.bank_deposits bd WHERE bd.id = deposit_collection_links.deposit_id
             AND public.is_own_driver(auth.uid(), bd.driver_id))
)
WITH CHECK (
  public.is_privileged(auth.uid())
  OR EXISTS (SELECT 1 FROM public.bank_deposits bd WHERE bd.id = deposit_collection_links.deposit_id
             AND public.is_own_driver(auth.uid(), bd.driver_id))
);

DROP POLICY IF EXISTS "View KPI values" ON public.kpi_values;
CREATE POLICY "kpi_values_select" ON public.kpi_values FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id)));

DROP POLICY IF EXISTS "View KPI targets" ON public.kpi_targets;
CREATE POLICY "kpi_targets_select" ON public.kpi_targets FOR SELECT TO authenticated
USING (public.is_privileged(auth.uid()) OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id)));

DROP POLICY IF EXISTS "View trips" ON public.trips;
CREATE POLICY "trips_select" ON public.trips FOR SELECT TO authenticated
USING (
  public.is_privileged(auth.uid())
  OR public.is_own_driver(auth.uid(), driver_id)
  OR public.can_access_branch(auth.uid(), origin_branch_id)
);

-- 6. Storage ownership checks
DROP POLICY IF EXISTS "Auth read receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Auth read incident photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users view incident photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload incident photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload incident photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth read mileage photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users view mileage photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload mileage photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload mileage photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth read deposit proofs" ON storage.objects;
DROP POLICY IF EXISTS "Auth users view deposit proofs" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload deposit proofs" ON storage.objects;
DROP POLICY IF EXISTS "Auth users upload deposit proofs" ON storage.objects;

CREATE POLICY "Owner or privileged read operational files" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('receipts','incident-photos','mileage-photos','deposit-proofs')
  AND (owner = auth.uid() OR public.is_privileged(auth.uid()))
);
CREATE POLICY "Auth upload own operational files" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('receipts','incident-photos','mileage-photos','deposit-proofs')
  AND owner = auth.uid()
);

-- 7. get_users_emails: enforce admin
CREATE OR REPLACE FUNCTION public.get_users_emails()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  RETURN QUERY SELECT u.id, u.email::text FROM auth.users u;
END;
$$;

-- 8. Lock down SECURITY DEFINER function execution
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.has_role(uuid, app_role),
  public.has_role_in_branch(uuid, app_role, uuid),
  public.is_owner(uuid),
  public.is_privileged(uuid),
  public.is_own_driver(uuid, uuid),
  public.can_access_branch(uuid, uuid),
  public.fn_can_view_consultation(uuid, uuid),
  public.fn_is_parent_request(uuid),
  public.fn_accept_and_start_trip(uuid, uuid[], integer, boolean),
  public.fn_cancel_trip(uuid, text),
  public.fn_catalog_facets(),
  public.fn_clear_for_pickup(uuid[]),
  public.fn_commit_supply_resolution(uuid, jsonb, uuid),
  public.fn_confirm_local_supply(uuid),
  public.fn_driver_action(text, uuid, uuid, jsonb),
  public.fn_edit_trip(uuid, uuid, uuid, boolean, timestamptz, text),
  public.fn_ensure_driver_for_user(uuid),
  public.fn_get_trip_detail(uuid),
  public.fn_get_trip_driver_names(uuid[]),
  public.fn_respond_consultation_target(uuid, numeric, text, text),
  public.fn_send_presale_to_operation(uuid, uuid),
  public.fn_start_operation_from_supplied(jsonb),
  public.fn_transition_request_status(uuid, text, text, text),
  public.fn_transition_request_status(uuid, text, text, text, uuid),
  public.get_users_emails()
TO authenticated;