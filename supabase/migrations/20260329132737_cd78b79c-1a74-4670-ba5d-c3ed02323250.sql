-- Allow anon to view branches (app runs without auth)
CREATE POLICY "Anon view branches" ON public.branches FOR SELECT TO anon USING (true);

-- Allow anon to view and manage profiles
CREATE POLICY "Anon view profiles" ON public.profiles FOR SELECT TO anon USING (true);
CREATE POLICY "Anon manage profiles" ON public.profiles FOR ALL TO anon USING (true) WITH CHECK (true);