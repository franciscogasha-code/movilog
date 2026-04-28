CREATE OR REPLACE FUNCTION public.fn_get_trip_driver_names(p_trip_ids uuid[])
RETURNS TABLE (
  trip_id uuid,
  driver_id uuid,
  driver_user_id uuid,
  driver_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS trip_id,
    t.driver_id,
    d.user_id AS driver_user_id,
    COALESCE(NULLIF(trim(p.full_name), ''), 'Sin chofer') AS driver_name
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.user_id = d.user_id
  WHERE t.id = ANY(p_trip_ids)
    AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_trip_detail(p_trip_id uuid)
RETURNS TABLE (
  id uuid,
  trip_number integer,
  trip_type trip_type,
  status trip_status,
  origin_branch_id uuid,
  destination_description text,
  driver_id uuid,
  vehicle_id uuid,
  planned_departure timestamp with time zone,
  actual_departure timestamp with time zone,
  actual_arrival timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  driver_user_id uuid,
  driver_name text,
  vehicle_plate character varying,
  vehicle_brand character varying,
  vehicle_model character varying,
  origin_branch_name character varying,
  origin_branch_code character varying
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.trip_number,
    t.trip_type,
    t.status,
    t.origin_branch_id,
    t.destination_description,
    t.driver_id,
    t.vehicle_id,
    t.planned_departure,
    t.actual_departure,
    t.actual_arrival,
    t.created_at,
    t.updated_at,
    d.user_id AS driver_user_id,
    COALESCE(NULLIF(trim(p.full_name), ''), 'Sin chofer') AS driver_name,
    v.plate AS vehicle_plate,
    v.brand AS vehicle_brand,
    v.model AS vehicle_model,
    b.name AS origin_branch_name,
    b.code AS origin_branch_code
  FROM public.trips t
  LEFT JOIN public.drivers d ON d.id = t.driver_id
  LEFT JOIN public.profiles p ON p.user_id = d.user_id
  LEFT JOIN public.vehicles v ON v.id = t.vehicle_id
  LEFT JOIN public.branches b ON b.id = t.origin_branch_id
  WHERE t.id = p_trip_id
    AND auth.uid() IS NOT NULL;
$$;