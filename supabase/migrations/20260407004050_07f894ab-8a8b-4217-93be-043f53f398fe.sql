-- FASE 1: Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, all_branches_access, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    false,
    true
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger on auth.users insert
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- Add unique constraint on profiles.user_id if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_user_id_unique'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- FASE 3: Harden RLS on profiles
DROP POLICY IF EXISTS "Anon manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "Anon view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "View profiles" ON public.profiles;

CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid());

-- Allow service role (trigger) to insert profiles
CREATE POLICY "Service insert profiles" ON public.profiles
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Harden RLS on branch_requests (only users with branch access)
DROP POLICY IF EXISTS "Update requests" ON public.branch_requests;

CREATE POLICY "Update requests" ON public.branch_requests
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR created_by = auth.uid()
  );

-- Harden RLS on fulfillment_orders
DROP POLICY IF EXISTS "Manage fulfillments" ON public.fulfillment_orders;

CREATE POLICY "Manage fulfillments" ON public.fulfillment_orders
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'warehouse_operator'::app_role)
    OR has_role(auth.uid(), 'driver'::app_role)
  );

-- Harden RLS on logistics_incidents update
DROP POLICY IF EXISTS "Update incidents" ON public.logistics_incidents;

CREATE POLICY "Update incidents" ON public.logistics_incidents
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR reported_by = auth.uid()
  );

-- Harden profile_branch_access
DROP POLICY IF EXISTS "Manage branch access" ON public.profile_branch_access;
DROP POLICY IF EXISTS "View branch access" ON public.profile_branch_access;

CREATE POLICY "Admin manage branch access" ON public.profile_branch_access
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users view own branch access" ON public.profile_branch_access
  FOR SELECT TO authenticated
  USING (
    profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- FASE 5: Storage policies for existing buckets (upload/read for authenticated)
DO $$
BEGIN
  -- incident-photos
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth upload incident photos' AND tablename = 'objects') THEN
    CREATE POLICY "Auth upload incident photos" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'incident-photos');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth read incident photos' AND tablename = 'objects') THEN
    CREATE POLICY "Auth read incident photos" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'incident-photos');
  END IF;

  -- receipts
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth upload receipts' AND tablename = 'objects') THEN
    CREATE POLICY "Auth upload receipts" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'receipts');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth read receipts' AND tablename = 'objects') THEN
    CREATE POLICY "Auth read receipts" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'receipts');
  END IF;

  -- deposit-proofs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth upload deposit proofs' AND tablename = 'objects') THEN
    CREATE POLICY "Auth upload deposit proofs" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'deposit-proofs');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth read deposit proofs' AND tablename = 'objects') THEN
    CREATE POLICY "Auth read deposit proofs" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'deposit-proofs');
  END IF;

  -- mileage-photos
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth upload mileage photos' AND tablename = 'objects') THEN
    CREATE POLICY "Auth upload mileage photos" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'mileage-photos');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth read mileage photos' AND tablename = 'objects') THEN
    CREATE POLICY "Auth read mileage photos" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'mileage-photos');
  END IF;
END $$;
