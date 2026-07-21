
-- ============ TABLES ============

CREATE TABLE public.vehicle_usage_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_usage_categories TO authenticated;
GRANT ALL ON public.vehicle_usage_categories TO service_role;

ALTER TABLE public.vehicle_usage_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vuc_select" ON public.vehicle_usage_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "vuc_manage" ON public.vehicle_usage_categories
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid()))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid()));

CREATE TRIGGER trg_vuc_updated_at BEFORE UPDATE ON public.vehicle_usage_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ VEHICLE NICKNAME ============
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS nickname text;

-- ============ FUEL EFFICIENCY ============
ALTER TABLE public.fuel_records ADD COLUMN IF NOT EXISTS computed_efficiency_kmpl numeric(8,3);

-- ============ VEHICLE USAGES ============

CREATE TABLE public.vehicle_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_name_text text,
  category_id uuid REFERENCES public.vehicle_usage_categories(id) ON DELETE SET NULL,
  destination text,
  start_mileage integer NOT NULL,
  end_mileage integer,
  km_traveled integer GENERATED ALWAYS AS (COALESCE(end_mileage,0) - COALESCE(start_mileage,0)) STORED,
  linked_request_id uuid REFERENCES public.branch_requests(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  start_odometer_photo_path text,
  end_odometer_photo_path text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_mileage IS NULL OR end_mileage >= start_mileage)
);

CREATE INDEX idx_vehicle_usages_vehicle ON public.vehicle_usages(vehicle_id, started_at DESC);
CREATE INDEX idx_vehicle_usages_driver ON public.vehicle_usages(driver_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_usages TO authenticated;
GRANT ALL ON public.vehicle_usages TO service_role;

ALTER TABLE public.vehicle_usages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vu_select" ON public.vehicle_usages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "vu_insert" ON public.vehicle_usages
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role)
    OR is_owner(auth.uid())
    OR (
      driver_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = vehicle_usages.driver_id AND d.user_id = auth.uid())
    )
  );

CREATE POLICY "vu_update" ON public.vehicle_usages
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role)
    OR is_owner(auth.uid())
    OR created_by = auth.uid()
  );

CREATE POLICY "vu_delete" ON public.vehicle_usages
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid()));

CREATE TRIGGER trg_vu_updated_at BEFORE UPDATE ON public.vehicle_usages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ FUEL_RECORDS RLS HARDENING ============

DROP POLICY IF EXISTS "Insert fuel" ON public.fuel_records;
DROP POLICY IF EXISTS "View fuel" ON public.fuel_records;

CREATE POLICY "fr_select" ON public.fuel_records
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "fr_insert" ON public.fuel_records
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role)
    OR is_owner(auth.uid())
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = fuel_records.driver_id AND d.user_id = auth.uid())
  );

CREATE POLICY "fr_manage" ON public.fuel_records
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid()));

CREATE POLICY "fr_delete" ON public.fuel_records
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid()));

-- ============ AUTO MILEAGE UPDATE ============

CREATE OR REPLACE FUNCTION public.fn_recompute_vehicle_mileage(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max integer;
BEGIN
  SELECT GREATEST(
    COALESCE((SELECT MAX(end_mileage) FROM public.vehicle_usages WHERE vehicle_id = p_vehicle_id), 0),
    COALESCE((SELECT MAX(start_mileage) FROM public.vehicle_usages WHERE vehicle_id = p_vehicle_id), 0),
    COALESCE((SELECT MAX(mileage_at_fill) FROM public.fuel_records WHERE vehicle_id = p_vehicle_id), 0),
    COALESCE((SELECT MAX(end_mileage) FROM public.trips WHERE vehicle_id = p_vehicle_id), 0),
    COALESCE((SELECT MAX(start_mileage) FROM public.trips WHERE vehicle_id = p_vehicle_id), 0)
  ) INTO v_max;

  UPDATE public.vehicles
    SET current_mileage = GREATEST(COALESCE(current_mileage,0), COALESCE(v_max,0)),
        updated_at = now()
    WHERE id = p_vehicle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trg_recompute_mileage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_recompute_vehicle_mileage(NEW.vehicle_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vu_recompute_mileage
  AFTER INSERT OR UPDATE ON public.vehicle_usages
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recompute_mileage();

CREATE TRIGGER trg_fr_recompute_mileage
  AFTER INSERT OR UPDATE ON public.fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_recompute_mileage();

-- ============ FUEL EFFICIENCY TRIGGER ============

CREATE OR REPLACE FUNCTION public.fn_compute_fuel_efficiency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_mileage integer;
BEGIN
  IF NEW.mileage_at_fill IS NULL OR NEW.liters IS NULL OR NEW.liters <= 0 THEN
    NEW.computed_efficiency_kmpl := NULL;
    RETURN NEW;
  END IF;

  SELECT mileage_at_fill INTO v_prev_mileage
  FROM public.fuel_records
  WHERE vehicle_id = NEW.vehicle_id
    AND id <> NEW.id
    AND mileage_at_fill IS NOT NULL
    AND (date < NEW.date OR (date = NEW.date AND created_at < COALESCE(NEW.created_at, now())))
  ORDER BY date DESC, created_at DESC
  LIMIT 1;

  IF v_prev_mileage IS NOT NULL AND NEW.mileage_at_fill > v_prev_mileage THEN
    NEW.computed_efficiency_kmpl := ROUND(((NEW.mileage_at_fill - v_prev_mileage)::numeric / NEW.liters)::numeric, 3);
  ELSE
    NEW.computed_efficiency_kmpl := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fr_efficiency
  BEFORE INSERT OR UPDATE ON public.fuel_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_compute_fuel_efficiency();

-- ============ SEED CATEGORIES ============
INSERT INTO public.vehicle_usage_categories (name, description) VALUES
  ('Entre sucursales', 'Traslados entre sucursales de la empresa'),
  ('A proveedor', 'Visita o retiro en proveedor'),
  ('A cliente', 'Visita, entrega o cobro a cliente'),
  ('Trámites administrativos', 'Gestiones bancarias, municipales u oficiales'),
  ('Otro', 'Uso no clasificado')
ON CONFLICT (name) DO NOTHING;

-- ============ STORAGE POLICIES ============

CREATE POLICY "vehicle_photos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-photos');

CREATE POLICY "vehicle_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vehicle-photos');

CREATE POLICY "vehicle_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid())));

CREATE POLICY "vehicle_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND (owner = auth.uid() OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'supervisor'::app_role) OR is_owner(auth.uid())));
