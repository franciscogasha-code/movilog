
-- 1. consultation_requests junction table (consultation → multiple orders)
CREATE TABLE public.consultation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES public.availability_consultations(id) ON DELETE CASCADE,
  branch_request_id uuid NOT NULL REFERENCES public.branch_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(consultation_id, branch_request_id)
);
ALTER TABLE public.consultation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View consultation requests" ON public.consultation_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage consultation requests" ON public.consultation_requests FOR ALL TO authenticated USING (true);

-- 2. Remove legacy single-reference column from availability_consultations
ALTER TABLE public.availability_consultations DROP COLUMN IF EXISTS converted_to_request_id;
