-- Drop the existing restrictive INSERT policy
DROP POLICY IF EXISTS "Create consultations" ON public.availability_consultations;

-- Create a new INSERT policy that allows:
-- 1. Users creating their own consultations (auth.uid() = created_by)
-- 2. Admins, supervisors and owners creating consultations on behalf of others
CREATE POLICY "Create consultations"
ON public.availability_consultations
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR is_owner(auth.uid())
);