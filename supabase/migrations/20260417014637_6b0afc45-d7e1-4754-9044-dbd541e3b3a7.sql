-- Permitir al rol jefe_logistica gestionar viajes (crear, actualizar, cancelar)
-- igual que admin/supervisor/owner. La visibilidad ya estaba abierta para todos los autenticados.
DROP POLICY IF EXISTS "Manage trips" ON public.trips;

CREATE POLICY "Manage trips"
ON public.trips
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR public.has_role(auth.uid(), 'jefe_logistica'::app_role)
  OR public.has_role(auth.uid(), 'driver'::app_role)
  OR public.has_role(auth.uid(), 'warehouse_operator'::app_role)
  OR public.is_owner(auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR public.has_role(auth.uid(), 'jefe_logistica'::app_role)
  OR public.has_role(auth.uid(), 'driver'::app_role)
  OR public.has_role(auth.uid(), 'warehouse_operator'::app_role)
  OR public.is_owner(auth.uid())
);