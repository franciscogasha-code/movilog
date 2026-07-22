
ALTER TABLE public.vehicle_usages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id);

ALTER TABLE public.vehicle_usages
  DROP CONSTRAINT IF EXISTS vehicle_usages_status_check;
ALTER TABLE public.vehicle_usages
  ADD CONSTRAINT vehicle_usages_status_check CHECK (status IN ('open','closed'));

-- Backfill: rows already having end_mileage are considered closed
UPDATE public.vehicle_usages
SET status = 'closed',
    closed_at = COALESCE(ended_at, updated_at)
WHERE end_mileage IS NOT NULL AND status = 'open';

-- Only one open trip per vehicle
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vehicle_open_trip
  ON public.vehicle_usages (vehicle_id) WHERE status = 'open';

-- Enforce consistency between status and end fields
CREATE OR REPLACE FUNCTION public.fn_vu_enforce_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'closed' THEN
    IF NEW.end_mileage IS NULL OR NEW.ended_at IS NULL OR NEW.end_odometer_photo_path IS NULL THEN
      RAISE EXCEPTION 'No se puede cerrar el viaje sin km final, fecha y foto del odómetro final';
    END IF;
    IF NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vu_enforce_status ON public.vehicle_usages;
CREATE TRIGGER trg_vu_enforce_status
  BEFORE INSERT OR UPDATE ON public.vehicle_usages
  FOR EACH ROW EXECUTE FUNCTION public.fn_vu_enforce_status();
