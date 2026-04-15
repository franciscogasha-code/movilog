
CREATE TABLE public.diagnostic_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id text,
  session_user_id text,
  ids_match boolean,
  step_name text,
  table_name text,
  payload jsonb,
  error_message text,
  error_code text,
  error_details text,
  error_hint text,
  requesting_branch_id text,
  target_branches jsonb
);

ALTER TABLE public.diagnostic_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert diagnostic logs"
  ON public.diagnostic_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins view diagnostic logs"
  ON public.diagnostic_logs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_owner(auth.uid()));
