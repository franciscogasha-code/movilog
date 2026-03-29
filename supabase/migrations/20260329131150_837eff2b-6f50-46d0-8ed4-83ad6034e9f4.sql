
DROP POLICY IF EXISTS "Insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
DROP POLICY IF EXISTS "View profiles" ON public.profiles;

CREATE POLICY "View profiles" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Manage profiles" ON public.profiles FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
