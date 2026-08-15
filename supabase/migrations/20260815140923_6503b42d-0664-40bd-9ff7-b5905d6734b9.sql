
-- Helpers
CREATE OR REPLACE FUNCTION public.fn_can_access_request(_user_id uuid, _request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branch_requests br
    WHERE br.id = _request_id
      AND (
        public.is_privileged(_user_id)
        OR br.created_by = _user_id
        OR br.current_custody_holder_id = _user_id
        OR public.can_access_branch(_user_id, br.requesting_branch_id)
        OR public.can_access_branch(_user_id, br.source_branch_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.fn_can_access_fulfillment(_user_id uuid, _fulfillment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fulfillment_orders fo
    WHERE fo.id = _fulfillment_id
      AND (
        public.is_privileged(_user_id)
        OR fo.current_custody_holder_id = _user_id
        OR public.can_access_branch(_user_id, fo.source_branch_id)
        OR public.can_access_branch(_user_id, fo.destination_branch_id)
        OR public.can_access_branch(_user_id, fo.current_location_branch_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.fn_can_access_inventory(_user_id uuid, _inventory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.directed_inventories di
    WHERE di.id = _inventory_id
      AND (
        public.is_privileged(_user_id)
        OR di.assigned_to = _user_id
        OR public.can_access_branch(_user_id, di.branch_id)
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.fn_is_fleet_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_privileged(_user_id)
      OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = _user_id AND d.is_active)
$$;

REVOKE EXECUTE ON FUNCTION public.fn_can_access_request(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_can_access_fulfillment(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_can_access_inventory(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_fleet_manager(uuid) FROM anon;

-- 1. branch_request_items
DROP POLICY IF EXISTS "Manage request items" ON public.branch_request_items;
DROP POLICY IF EXISTS "View request items" ON public.branch_request_items;
CREATE POLICY "View request items" ON public.branch_request_items FOR SELECT TO authenticated
  USING (public.fn_can_access_request(auth.uid(), request_id));
CREATE POLICY "Manage request items" ON public.branch_request_items FOR ALL TO authenticated
  USING (public.fn_can_access_request(auth.uid(), request_id))
  WITH CHECK (public.fn_can_access_request(auth.uid(), request_id));

-- 2. committed_stock
DROP POLICY IF EXISTS "View committed stock" ON public.committed_stock;
CREATE POLICY "View committed stock" ON public.committed_stock FOR SELECT TO authenticated
  USING (public.is_privileged(auth.uid()) OR public.can_access_branch(auth.uid(), branch_id));

-- 3. directed_inventories
DROP POLICY IF EXISTS "View inventories" ON public.directed_inventories;
CREATE POLICY "View inventories" ON public.directed_inventories FOR SELECT TO authenticated
  USING (public.is_privileged(auth.uid()) OR assigned_to = auth.uid() OR public.can_access_branch(auth.uid(), branch_id));

-- 4. directed_inventory_items
DROP POLICY IF EXISTS "Manage inventory items" ON public.directed_inventory_items;
DROP POLICY IF EXISTS "View inventory items" ON public.directed_inventory_items;
CREATE POLICY "View inventory items" ON public.directed_inventory_items FOR SELECT TO authenticated
  USING (public.fn_can_access_inventory(auth.uid(), inventory_id));
CREATE POLICY "Manage inventory items" ON public.directed_inventory_items FOR ALL TO authenticated
  USING (public.fn_can_access_inventory(auth.uid(), inventory_id))
  WITH CHECK (public.fn_can_access_inventory(auth.uid(), inventory_id));

-- 5. drivers
DROP POLICY IF EXISTS "View drivers" ON public.drivers;
CREATE POLICY "View drivers" ON public.drivers FOR SELECT TO authenticated
  USING (
    public.is_privileged(auth.uid())
    OR user_id = auth.uid()
    OR public.can_access_branch(auth.uid(), assigned_branch_id)
  );

-- 6. fulfillment_items
DROP POLICY IF EXISTS "Manage fulfillment items" ON public.fulfillment_items;
DROP POLICY IF EXISTS "View fulfillment items" ON public.fulfillment_items;
CREATE POLICY "View fulfillment items" ON public.fulfillment_items FOR SELECT TO authenticated
  USING (public.fn_can_access_fulfillment(auth.uid(), fulfillment_id));
CREATE POLICY "Manage fulfillment items" ON public.fulfillment_items FOR ALL TO authenticated
  USING (public.fn_can_access_fulfillment(auth.uid(), fulfillment_id))
  WITH CHECK (public.fn_can_access_fulfillment(auth.uid(), fulfillment_id));

-- 7. operational_events
DROP POLICY IF EXISTS "View events" ON public.operational_events;
CREATE POLICY "View events" ON public.operational_events FOR SELECT TO authenticated
  USING (
    public.is_privileged(auth.uid())
    OR triggered_by = auth.uid()
    OR new_custody_holder_id = auth.uid()
    OR previous_custody_holder_id = auth.uid()
    OR public.can_access_branch(auth.uid(), new_location_branch_id)
    OR public.can_access_branch(auth.uid(), previous_location_branch_id)
    OR (reference_type = 'branch_request' AND public.fn_can_access_request(auth.uid(), reference_id))
    OR (reference_type = 'fulfillment_order' AND public.fn_can_access_fulfillment(auth.uid(), reference_id))
  );

-- 8. shipment_packages
DROP POLICY IF EXISTS "Manage packages" ON public.shipment_packages;
DROP POLICY IF EXISTS "View packages" ON public.shipment_packages;
CREATE POLICY "View packages" ON public.shipment_packages FOR SELECT TO authenticated
  USING (public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id));
CREATE POLICY "Manage packages" ON public.shipment_packages FOR ALL TO authenticated
  USING (public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id))
  WITH CHECK (public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id));

-- 9. special_stock
DROP POLICY IF EXISTS "View special stock" ON public.special_stock;
CREATE POLICY "View special stock" ON public.special_stock FOR SELECT TO authenticated
  USING (public.is_privileged(auth.uid()) OR public.can_access_branch(auth.uid(), branch_id));

-- 10. tracked_documents
DROP POLICY IF EXISTS "Manage documents" ON public.tracked_documents;
DROP POLICY IF EXISTS "View documents" ON public.tracked_documents;
CREATE POLICY "View documents" ON public.tracked_documents FOR SELECT TO authenticated
  USING (
    public.is_privileged(auth.uid())
    OR current_holder_id = auth.uid()
    OR public.can_access_branch(auth.uid(), current_location_branch_id)
    OR (branch_request_id IS NOT NULL AND public.fn_can_access_request(auth.uid(), branch_request_id))
    OR (fulfillment_order_id IS NOT NULL AND public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id))
  );
CREATE POLICY "Manage documents" ON public.tracked_documents FOR ALL TO authenticated
  USING (
    public.is_privileged(auth.uid())
    OR current_holder_id = auth.uid()
    OR public.can_access_branch(auth.uid(), current_location_branch_id)
    OR (branch_request_id IS NOT NULL AND public.fn_can_access_request(auth.uid(), branch_request_id))
    OR (fulfillment_order_id IS NOT NULL AND public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id))
  )
  WITH CHECK (
    public.is_privileged(auth.uid())
    OR current_holder_id = auth.uid()
    OR public.can_access_branch(auth.uid(), current_location_branch_id)
    OR (branch_request_id IS NOT NULL AND public.fn_can_access_request(auth.uid(), branch_request_id))
    OR (fulfillment_order_id IS NOT NULL AND public.fn_can_access_fulfillment(auth.uid(), fulfillment_order_id))
  );

-- 11. vehicles
DROP POLICY IF EXISTS "View vehicles" ON public.vehicles;
CREATE POLICY "View vehicles" ON public.vehicles FOR SELECT TO authenticated
  USING (public.fn_is_fleet_manager(auth.uid()) OR public.can_access_branch(auth.uid(), assigned_branch_id));

-- 12. vehicle_maintenance
DROP POLICY IF EXISTS "View maintenance" ON public.vehicle_maintenance;
CREATE POLICY "View maintenance" ON public.vehicle_maintenance FOR SELECT TO authenticated
  USING (
    public.is_privileged(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.user_id = auth.uid() AND d.assigned_vehicle_id = vehicle_maintenance.vehicle_id
    )
  );

-- 13. Storage: request attachments upload scoping
DROP POLICY IF EXISTS "Authenticated users can upload request attachments" ON storage.objects;
CREATE POLICY "Authenticated users can upload request attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'request-attachments'
    AND owner = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.branch_requests br
      WHERE br.id = ((string_to_array(name, '/'))[2])::uuid
        AND (
          public.is_privileged(auth.uid())
          OR br.created_by = auth.uid()
          OR public.can_access_branch(auth.uid(), br.source_branch_id)
          OR public.can_access_branch(auth.uid(), br.requesting_branch_id)
        )
    )
  );

-- 14. Storage: vehicle photos upload scoping
DROP POLICY IF EXISTS "vehicle_photos_insert" ON storage.objects;
CREATE POLICY "vehicle_photos_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-photos'
    AND owner = auth.uid()
    AND public.fn_is_fleet_manager(auth.uid())
  );

-- 15. Client PII column protection on branch_requests
REVOKE SELECT ON public.branch_requests FROM authenticated;
GRANT SELECT (
  id, request_number, request_type, requesting_branch_id, source_branch_id, shipping_method,
  shipping_paid_by, shipping_cost, bims_invoice_number, bims_sale_reference, client_name,
  client_address, status, current_custody_holder_id, current_location_branch_id,
  expected_next_event, expected_next_event_deadline, priority, notes, created_by, accepted_by,
  accepted_at, rejected_by, rejected_at, rejection_reason, closed_by, closed_at, created_at,
  updated_at, rejection_reason_type, logistic_closed_at, logistic_closed_by, admin_closed_at,
  admin_closed_by, shipping_origin_paid, shipping_destination_paid, delivery_target,
  delivery_payer, parent_request_id, courier_billing_mode, operational_responsible_id,
  attached_file_path, flow_type, consolidation_override, is_pre_sale, pre_sale_status,
  sales_channel, pre_sale_confirmed_at, pre_sale_sent_at, pre_sale_pdf_generated_at,
  converted_to_request_id, created_from_presale_id, converted_at, converted_by_user_id,
  commercial_terms, client_uuid
) ON public.branch_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_get_request_client_contact(p_request_id uuid)
RETURNS TABLE(client_phone text, client_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  RETURN QUERY
  SELECT br.client_phone::text, br.client_email::text
  FROM public.branch_requests br
  WHERE br.id = p_request_id
    AND (
      public.is_privileged(auth.uid())
      OR br.created_by = auth.uid()
      OR br.operational_responsible_id = auth.uid()
    );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_get_request_client_contact(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_get_request_client_contact(uuid) TO authenticated;

-- 16. Reduce SECURITY DEFINER surface for signed-in users (unused RPCs)
REVOKE EXECUTE ON FUNCTION public.fn_is_parent_request(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_confirm_local_supply(uuid) FROM anon, authenticated;
