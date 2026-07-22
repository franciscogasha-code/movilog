
-- =========================================================
-- FLEET PHASE 2 — Maintenance planning, fines, KPI view
-- =========================================================

-- 1) Extend vehicle_maintenance
ALTER TABLE public.vehicle_maintenance
  ADD COLUMN IF NOT EXISTS scheduled_km integer,
  ADD COLUMN IF NOT EXISTS alert_km_threshold integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS alert_days_threshold integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS recurrence_km integer,
  ADD COLUMN IF NOT EXISTS recurrence_days integer,
  ADD COLUMN IF NOT EXISTS parent_maintenance_id uuid REFERENCES public.vehicle_maintenance(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_status_date
  ON public.vehicle_maintenance(status, scheduled_date);

-- 2) Auto-schedule next maintenance when completed
CREATE OR REPLACE FUNCTION public.fn_maintenance_autoschedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_km integer;
  v_next_date date;
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status,'') <> 'completed' THEN
    IF NEW.recurrence_km IS NOT NULL OR NEW.recurrence_days IS NOT NULL THEN
      v_next_km := CASE WHEN NEW.recurrence_km IS NOT NULL
                        THEN COALESCE(NEW.mileage_at_service, NEW.scheduled_km, 0) + NEW.recurrence_km
                        ELSE NULL END;
      v_next_date := CASE WHEN NEW.recurrence_days IS NOT NULL
                          THEN COALESCE(NEW.completed_date, CURRENT_DATE) + (NEW.recurrence_days || ' days')::interval
                          ELSE NULL END;

      -- Do not duplicate if a child scheduled record already exists
      IF NOT EXISTS (
        SELECT 1 FROM public.vehicle_maintenance
        WHERE parent_maintenance_id = NEW.id
      ) THEN
        INSERT INTO public.vehicle_maintenance (
          vehicle_id, maintenance_type, description,
          scheduled_date, scheduled_km,
          alert_km_threshold, alert_days_threshold,
          recurrence_km, recurrence_days,
          status, parent_maintenance_id
        ) VALUES (
          NEW.vehicle_id, NEW.maintenance_type, NEW.description,
          v_next_date, v_next_km,
          NEW.alert_km_threshold, NEW.alert_days_threshold,
          NEW.recurrence_km, NEW.recurrence_days,
          'scheduled', NEW.id
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_autoschedule ON public.vehicle_maintenance;
CREATE TRIGGER trg_maintenance_autoschedule
AFTER UPDATE ON public.vehicle_maintenance
FOR EACH ROW EXECUTE FUNCTION public.fn_maintenance_autoschedule();

-- 3) Fine status enum
DO $$ BEGIN
  CREATE TYPE public.fine_status AS ENUM ('pending','paid','appealed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Vehicle fines table
CREATE TABLE IF NOT EXISTS public.vehicle_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  fine_number text,
  issued_at timestamptz NOT NULL,
  location text,
  infraction_type text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  due_date date,
  status public.fine_status NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  receipt_photo_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fines_vehicle ON public.vehicle_fines(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fines_status ON public.vehicle_fines(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_fines_due_date ON public.vehicle_fines(due_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_fines TO authenticated;
GRANT ALL ON public.vehicle_fines TO service_role;

ALTER TABLE public.vehicle_fines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fines_select_authenticated"
  ON public.vehicle_fines FOR SELECT TO authenticated USING (true);

CREATE POLICY "fines_insert_privileged"
  ON public.vehicle_fines FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.is_owner(auth.uid())
  );

CREATE POLICY "fines_update_privileged_or_driver"
  ON public.vehicle_fines FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.is_owner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicle_fines.driver_id
        AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.is_owner(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicle_fines.driver_id
        AND d.user_id = auth.uid()
    )
  );

CREATE POLICY "fines_delete_privileged"
  ON public.vehicle_fines FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.is_owner(auth.uid())
  );

CREATE TRIGGER update_vehicle_fines_updated_at
  BEFORE UPDATE ON public.vehicle_fines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) KPI monthly view per vehicle
CREATE OR REPLACE VIEW public.v_fleet_kpis_by_vehicle AS
WITH usage_agg AS (
  SELECT
    vu.vehicle_id,
    date_trunc('month', vu.started_at)::date AS month,
    SUM(COALESCE(vu.km_traveled, 0))::int AS usage_km
  FROM public.vehicle_usages vu
  WHERE vu.started_at IS NOT NULL
  GROUP BY vu.vehicle_id, date_trunc('month', vu.started_at)
),
trips_agg AS (
  SELECT
    t.vehicle_id,
    date_trunc('month', COALESCE(t.actual_departure, t.planned_departure, t.created_at))::date AS month,
    0::int AS trips_km  -- trips table has no km column; placeholder for future
  FROM public.trips t
  WHERE t.vehicle_id IS NOT NULL
  GROUP BY t.vehicle_id, date_trunc('month', COALESCE(t.actual_departure, t.planned_departure, t.created_at))
),
fuel_agg AS (
  SELECT
    f.vehicle_id,
    date_trunc('month', f.date::timestamp)::date AS month,
    SUM(COALESCE(f.liters,0))::numeric AS liters,
    SUM(COALESCE(f.total_amount,0))::numeric AS spent,
    AVG(NULLIF(f.computed_efficiency_kmpl,0))::numeric AS avg_kmpl
  FROM public.fuel_records f
  GROUP BY f.vehicle_id, date_trunc('month', f.date::timestamp)
)
SELECT
  v.id AS vehicle_id,
  v.plate,
  v.nickname,
  COALESCE(u.month, t.month, f.month) AS month,
  COALESCE(u.usage_km, 0) + COALESCE(t.trips_km, 0) AS km,
  COALESCE(f.liters, 0) AS liters,
  COALESCE(f.spent, 0) AS spent,
  f.avg_kmpl
FROM public.vehicles v
LEFT JOIN usage_agg u ON u.vehicle_id = v.id
FULL OUTER JOIN trips_agg t ON t.vehicle_id = v.id AND t.month = u.month
FULL OUTER JOIN fuel_agg f ON f.vehicle_id = v.id AND f.month = COALESCE(u.month, t.month)
WHERE v.id IS NOT NULL;

GRANT SELECT ON public.v_fleet_kpis_by_vehicle TO authenticated, service_role;
