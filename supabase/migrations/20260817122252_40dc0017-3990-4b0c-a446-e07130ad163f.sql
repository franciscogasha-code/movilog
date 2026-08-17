ALTER TABLE public.branch_request_client_contacts
  DROP CONSTRAINT branch_request_client_contacts_request_id_fkey;

ALTER TABLE public.branch_request_client_contacts
  ADD CONSTRAINT branch_request_client_contacts_request_id_fkey
  FOREIGN KEY (request_id) REFERENCES public.branch_requests(id)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;