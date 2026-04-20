CREATE OR REPLACE FUNCTION public.get_users_emails()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only admins, supervisors and owners can view emails
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'supervisor'::app_role)
       OR public.is_owner(auth.uid())) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT u.id AS user_id, u.email::text
  FROM auth.users u;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_emails() TO authenticated;