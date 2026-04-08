
-- Add parent_request_id for multi-origin parent-child traceability
ALTER TABLE public.branch_requests
ADD COLUMN IF NOT EXISTS parent_request_id uuid REFERENCES public.branch_requests(id);

CREATE INDEX IF NOT EXISTS idx_branch_requests_parent ON public.branch_requests(parent_request_id);

-- Sync logs table for BIMS synchronization traceability
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'running',
  total_received integer DEFAULT 0,
  total_processed integer DEFAULT 0,
  total_inserted integer DEFAULT 0,
  total_updated integer DEFAULT 0,
  total_failed integer DEFAULT 0,
  total_skipped integer DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  triggered_by varchar DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View sync logs" ON public.sync_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage sync logs" ON public.sync_logs
  FOR ALL TO service_role USING (true);

-- Allow edge functions (service_role) to insert sync logs
CREATE POLICY "Insert sync logs anon" ON public.sync_logs
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Insert sync logs auth" ON public.sync_logs
  FOR INSERT TO authenticated WITH CHECK (true);
