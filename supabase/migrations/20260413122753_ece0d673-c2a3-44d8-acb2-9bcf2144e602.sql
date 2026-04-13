-- 1. Create private bucket for request attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('request-attachments', 'request-attachments', false);

-- 2. Add attached_file_path column to branch_requests
ALTER TABLE public.branch_requests ADD COLUMN attached_file_path text DEFAULT NULL;

-- 3. Storage policy: authenticated users can upload to request-attachments
CREATE POLICY "Authenticated users can upload request attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'request-attachments');

-- 4. Storage policy: users with access to source branch or admin/owner can download
CREATE POLICY "Authorized users can download request attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'request-attachments'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_owner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.branch_requests br
      WHERE br.id = (string_to_array(name, '/'))[2]::uuid
        AND can_access_branch(auth.uid(), br.source_branch_id)
    )
  )
);