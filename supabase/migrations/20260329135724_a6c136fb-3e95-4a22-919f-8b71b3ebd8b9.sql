-- Support assigning one, many or all branches per profile
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS all_branches_access boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.profile_branch_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (profile_id, branch_id)
);

ALTER TABLE public.profile_branch_access ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_branch_access'
      AND policyname = 'View branch access'
  ) THEN
    CREATE POLICY "View branch access"
    ON public.profile_branch_access
    FOR SELECT
    TO anon, authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profile_branch_access'
      AND policyname = 'Manage branch access'
  ) THEN
    CREATE POLICY "Manage branch access"
    ON public.profile_branch_access
    FOR ALL
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.profile_branch_access (profile_id, branch_id)
SELECT p.id, p.default_branch_id
FROM public.profiles p
WHERE p.default_branch_id IS NOT NULL
ON CONFLICT (profile_id, branch_id) DO NOTHING;