-- 1. Security definer function to check branch access
CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND all_branches_access = true
  )
  OR EXISTS (
    SELECT 1 FROM public.profile_branch_access pba
    JOIN public.profiles p ON p.id = pba.profile_id
    WHERE p.user_id = _user_id AND pba.branch_id = _branch_id
  )
$$;

-- 2. Restrict branch_requests SELECT to user's branches
DROP POLICY "View requests" ON public.branch_requests;
CREATE POLICY "View requests" ON public.branch_requests
FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), requesting_branch_id)
  OR can_access_branch(auth.uid(), source_branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

-- 3. Restrict fulfillment_orders SELECT
DROP POLICY "View fulfillments" ON public.fulfillment_orders;
CREATE POLICY "View fulfillments" ON public.fulfillment_orders
FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), source_branch_id)
  OR can_access_branch(auth.uid(), destination_branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

-- 4. Restrict logistics_incidents SELECT
DROP POLICY "View incidents" ON public.logistics_incidents;
CREATE POLICY "View incidents" ON public.logistics_incidents
FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_owner(auth.uid())
);

-- 5. Add courier_billing_mode column
ALTER TABLE public.branch_requests
ADD COLUMN courier_billing_mode character varying DEFAULT NULL;

COMMENT ON COLUMN public.branch_requests.courier_billing_mode IS 'on_invoice = incluir en factura, collect_at_destination = cobro en destino';