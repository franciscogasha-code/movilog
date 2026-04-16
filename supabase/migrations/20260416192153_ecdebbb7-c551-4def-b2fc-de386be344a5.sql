
-- Visión global de lectura para Jefe de Logística en módulos logísticos
-- Reutiliza la función has_role existente.

-- branch_requests: ver todos los pedidos
DROP POLICY IF EXISTS "View requests" ON public.branch_requests;
CREATE POLICY "View requests"
ON public.branch_requests FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), requesting_branch_id)
  OR can_access_branch(auth.uid(), source_branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'jefe_logistica'::app_role)
  OR is_owner(auth.uid())
);

-- fulfillment_orders: ver todas las cargas/cumplimientos
DROP POLICY IF EXISTS "View fulfillments" ON public.fulfillment_orders;
CREATE POLICY "View fulfillments"
ON public.fulfillment_orders FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), source_branch_id)
  OR can_access_branch(auth.uid(), destination_branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'jefe_logistica'::app_role)
  OR is_owner(auth.uid())
);

-- logistics_incidents: ver todas las incidencias logísticas
DROP POLICY IF EXISTS "View incidents" ON public.logistics_incidents;
CREATE POLICY "View incidents"
ON public.logistics_incidents FOR SELECT TO authenticated
USING (
  can_access_branch(auth.uid(), branch_id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'jefe_logistica'::app_role)
  OR is_owner(auth.uid())
);
