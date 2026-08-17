-- 1. Tabla privada de contactos de cliente
CREATE TABLE IF NOT EXISTS public.branch_request_client_contacts (
  request_id uuid PRIMARY KEY REFERENCES public.branch_requests(id) ON DELETE CASCADE,
  client_phone text,
  client_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.branch_request_client_contacts FROM anon, authenticated;
GRANT ALL ON public.branch_request_client_contacts TO service_role;
ALTER TABLE public.branch_request_client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only_contacts" ON public.branch_request_client_contacts;
CREATE POLICY "service_role_only_contacts"
  ON public.branch_request_client_contacts
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2. Migrar datos existentes (desactivando validaciones de negocio en el backfill)
INSERT INTO public.branch_request_client_contacts (request_id, client_phone, client_email)
SELECT id, client_phone, client_email
FROM public.branch_requests
WHERE client_phone IS NOT NULL OR client_email IS NOT NULL
ON CONFLICT (request_id) DO UPDATE
  SET client_phone = COALESCE(EXCLUDED.client_phone, public.branch_request_client_contacts.client_phone),
      client_email = COALESCE(EXCLUDED.client_email, public.branch_request_client_contacts.client_email),
      updated_at = now();

ALTER TABLE public.branch_requests DISABLE TRIGGER trg_validate_pre_sale_coherence;
ALTER TABLE public.branch_requests DISABLE TRIGGER trg_validate_business_rules;
ALTER TABLE public.branch_requests DISABLE TRIGGER trg_validate_delivery_charges;
ALTER TABLE public.branch_requests DISABLE TRIGGER trg_validate_different_branches;
ALTER TABLE public.branch_requests DISABLE TRIGGER trg_block_supply_transitions;
ALTER TABLE public.branch_requests DISABLE TRIGGER trg_check_request_closure;
ALTER TABLE public.branch_requests DISABLE TRIGGER update_branch_requests_updated_at;

UPDATE public.branch_requests
SET client_phone = NULL, client_email = NULL
WHERE client_phone IS NOT NULL OR client_email IS NOT NULL;

ALTER TABLE public.branch_requests ENABLE TRIGGER trg_validate_pre_sale_coherence;
ALTER TABLE public.branch_requests ENABLE TRIGGER trg_validate_business_rules;
ALTER TABLE public.branch_requests ENABLE TRIGGER trg_validate_delivery_charges;
ALTER TABLE public.branch_requests ENABLE TRIGGER trg_validate_different_branches;
ALTER TABLE public.branch_requests ENABLE TRIGGER trg_block_supply_transitions;
ALTER TABLE public.branch_requests ENABLE TRIGGER trg_check_request_closure;
ALTER TABLE public.branch_requests ENABLE TRIGGER update_branch_requests_updated_at;

-- 3. Trigger: desviar PII a la tabla privada
CREATE OR REPLACE FUNCTION public.fn_divert_client_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_phone IS NOT NULL OR NEW.client_email IS NOT NULL THEN
    INSERT INTO public.branch_request_client_contacts (request_id, client_phone, client_email)
    VALUES (NEW.id, NEW.client_phone, NEW.client_email)
    ON CONFLICT (request_id) DO UPDATE
      SET client_phone = COALESCE(EXCLUDED.client_phone, public.branch_request_client_contacts.client_phone),
          client_email = COALESCE(EXCLUDED.client_email, public.branch_request_client_contacts.client_email),
          updated_at = now();
    NEW.client_phone := NULL;
    NEW.client_email := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_divert_client_contact ON public.branch_requests;
CREATE TRIGGER trg_divert_client_contact
BEFORE INSERT OR UPDATE OF client_phone, client_email ON public.branch_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_divert_client_contact();

-- 4. Lectura autorizada desde la tabla privada
CREATE OR REPLACE FUNCTION public.fn_get_request_client_contact(p_request_id uuid)
RETURNS TABLE(client_phone text, client_email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN QUERY
  SELECT c.client_phone::text, c.client_email::text
  FROM public.branch_requests br
  LEFT JOIN public.branch_request_client_contacts c ON c.request_id = br.id
  WHERE br.id = p_request_id
    AND (
      public.is_privileged(auth.uid())
      OR br.created_by = auth.uid()
      OR br.operational_responsible_id = auth.uid()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_get_request_client_contact(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_get_request_client_contact(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_request_client_contact(uuid) TO authenticated;

-- 5. Restaurar acceso a nivel tabla (ya sin PII en las columnas) y cerrar anon
GRANT SELECT ON public.branch_requests TO authenticated;
REVOKE ALL ON public.branch_requests FROM anon;