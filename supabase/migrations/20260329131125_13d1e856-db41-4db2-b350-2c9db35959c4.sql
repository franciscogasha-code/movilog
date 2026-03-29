
CREATE TABLE public.user_module_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_key varchar NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id, module_key)
);

ALTER TABLE public.user_module_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View module access" ON public.user_module_access FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Manage module access" ON public.user_module_access FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
