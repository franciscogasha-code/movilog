
-- =====================================================
-- SLIS - Sistema Logístico Inteligente SANSEI
-- Modelo de Base de Datos Completo
-- =====================================================

-- =====================================================
-- 1. ENUMS
-- =====================================================

CREATE TYPE public.app_role AS ENUM (
  'admin', 'supervisor', 'warehouse_operator', 'driver', 
  'collector', 'branch_manager', 'branch_operator', 'viewer'
);

CREATE TYPE public.request_status AS ENUM (
  'pending', 'accepted', 'rejected', 'picking', 'ready_to_ship',
  'in_transit', 'received_ok', 'received_partial', 'closed'
);

CREATE TYPE public.request_type AS ENUM ('client', 'reposition', 'mixed');

CREATE TYPE public.shipping_method AS ENUM (
  'own_fleet', 'courier', 'pickup', 'direct_client', 'cut_shipment'
);

CREATE TYPE public.reserve_type AS ENUM ('soft', 'hard');

CREATE TYPE public.reserve_reason AS ENUM (
  'branch_request', 'client_order', 'pending_fulfillment'
);

CREATE TYPE public.fulfillment_status AS ENUM ('pending', 'partial', 'completed', 'cancelled');

CREATE TYPE public.document_status AS ENUM (
  'issued', 'with_driver', 'delivered_to_client', 'signed_by_client',
  'with_admin', 'sent_to_collector', 'received_by_collector',
  'presented_to_client', 'collection_scheduled', 'collection_completed', 'archived'
);

CREATE TYPE public.document_type AS ENUM (
  'invoice', 'remission', 'signed_invoice', 'credit_note', 'delivery_receipt'
);

CREATE TYPE public.trip_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.vehicle_status AS ENUM ('available', 'in_route', 'maintenance', 'out_of_service');

CREATE TYPE public.incident_type AS ENUM (
  'damaged', 'missing', 'surplus', 'wrong_product', 'expired', 'admin_stock', 'fair_stock'
);
CREATE TYPE public.incident_status AS ENUM ('open', 'under_review', 'resolved', 'escalated', 'closed');

CREATE TYPE public.directed_inventory_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.vehicle_loan_status AS ENUM ('requested', 'approved', 'active', 'returned', 'cancelled');

CREATE TYPE public.event_category AS ENUM (
  'request', 'fulfillment', 'document', 'trip', 'inventory', 
  'incident', 'vehicle', 'collection', 'stock'
);

CREATE TYPE public.anomaly_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE public.recommendation_status AS ENUM ('pending', 'accepted', 'rejected', 'expired');
CREATE TYPE public.kpi_area AS ENUM ('logistics', 'warehouse', 'fleet', 'collections', 'inventory', 'fulfillment', 'general');
CREATE TYPE public.kpi_aggregation AS ENUM ('count', 'sum', 'average', 'percentage', 'ratio', 'min', 'max');

-- =====================================================
-- 2. FUNCIONES UTILITARIAS
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =====================================================
-- 3. TABLAS BASE
-- =====================================================

CREATE TABLE public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  phone VARCHAR(50),
  is_central_warehouse BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  branch_id UUID REFERENCES public.branches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, branch_id)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.has_role_in_branch(_user_id UUID, _role app_role, _branch_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role AND branch_id = _branch_id) $$;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(200) NOT NULL,
  phone VARCHAR(50),
  default_branch_id UUID REFERENCES public.branches(id),
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate VARCHAR(20) NOT NULL UNIQUE,
  brand VARCHAR(50),
  model VARCHAR(50),
  year INTEGER,
  status vehicle_status NOT NULL DEFAULT 'available',
  assigned_branch_id UUID REFERENCES public.branches(id),
  current_mileage INTEGER DEFAULT 0,
  insurance_expiry DATE,
  vtv_expiry DATE,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  license_number VARCHAR(50),
  license_expiry DATE,
  assigned_vehicle_id UUID REFERENCES public.vehicles(id),
  assigned_branch_id UUID REFERENCES public.branches(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bims_code VARCHAR(50) UNIQUE,
  sku VARCHAR(50),
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(20) DEFAULT 'UN',
  weight_kg NUMERIC(10,3),
  volume_cm3 NUMERIC(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 4. SOLICITUDES ENTRE SUCURSALES
-- =====================================================

CREATE TABLE public.branch_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number SERIAL,
  request_type request_type NOT NULL DEFAULT 'reposition',
  requesting_branch_id UUID NOT NULL REFERENCES public.branches(id),
  source_branch_id UUID NOT NULL REFERENCES public.branches(id),
  shipping_method shipping_method NOT NULL DEFAULT 'own_fleet',
  shipping_paid_by UUID REFERENCES public.branches(id),
  shipping_cost NUMERIC(12,2),
  bims_invoice_number VARCHAR(50),
  bims_sale_reference VARCHAR(100),
  client_name VARCHAR(200),
  client_address TEXT,
  status request_status NOT NULL DEFAULT 'pending',
  current_custody_holder_id UUID REFERENCES auth.users(id),
  current_location_branch_id UUID REFERENCES public.branches(id),
  expected_next_event VARCHAR(100),
  expected_next_event_deadline TIMESTAMPTZ,
  priority VARCHAR(20) DEFAULT 'normal',
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  accepted_by UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  closed_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_requests ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.branch_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.branch_requests(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  quantity_requested NUMERIC(12,2) NOT NULL,
  quantity_picked NUMERIC(12,2) DEFAULT 0,
  quantity_shipped NUMERIC(12,2) DEFAULT 0,
  quantity_received NUMERIC(12,2) DEFAULT 0,
  quantity_accepted NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_request_items ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 5. VIAJES (creados antes de fulfillment para FK)
-- =====================================================

CREATE TABLE public.trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_number SERIAL,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  origin_branch_id UUID NOT NULL REFERENCES public.branches(id),
  planned_stops JSONB DEFAULT '[]',
  status trip_status NOT NULL DEFAULT 'planned',
  start_mileage INTEGER,
  end_mileage INTEGER,
  start_mileage_photo_url TEXT,
  end_mileage_photo_url TEXT,
  planned_departure TIMESTAMPTZ,
  actual_departure TIMESTAMPTZ,
  planned_arrival TIMESTAMPTZ,
  actual_arrival TIMESTAMPTZ,
  settlement_status VARCHAR(20) DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  settled_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 6. CUMPLIMIENTO FÍSICO (FULFILLMENT)
-- =====================================================

CREATE TABLE public.fulfillment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_request_id UUID REFERENCES public.branch_requests(id),
  bims_invoice_number VARCHAR(50),
  source_branch_id UUID NOT NULL REFERENCES public.branches(id),
  destination_branch_id UUID REFERENCES public.branches(id),
  destination_client_name VARCHAR(200),
  destination_client_address TEXT,
  shipping_method shipping_method NOT NULL,
  status fulfillment_status NOT NULL DEFAULT 'pending',
  current_custody_holder_id UUID REFERENCES auth.users(id),
  current_location_branch_id UUID REFERENCES public.branches(id),
  expected_next_event VARCHAR(100),
  expected_next_event_deadline TIMESTAMPTZ,
  trip_id UUID REFERENCES public.trips(id),
  dispatched_at TIMESTAMPTZ,
  dispatched_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fulfillment_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.fulfillment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id UUID NOT NULL REFERENCES public.fulfillment_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  request_item_id UUID REFERENCES public.branch_request_items(id),
  quantity_dispatched NUMERIC(12,2) NOT NULL,
  quantity_received NUMERIC(12,2) DEFAULT 0,
  quantity_accepted NUMERIC(12,2) DEFAULT 0,
  quantity_rejected NUMERIC(12,2) DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fulfillment_items ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 7. STOCK COMPROMETIDO
-- =====================================================

CREATE TABLE public.committed_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  quantity NUMERIC(12,2) NOT NULL,
  reserve_type reserve_type NOT NULL DEFAULT 'soft',
  reserve_reason reserve_reason NOT NULL,
  expires_at TIMESTAMPTZ,
  is_expired BOOLEAN DEFAULT false,
  branch_request_id UUID REFERENCES public.branch_requests(id),
  fulfillment_order_id UUID REFERENCES public.fulfillment_orders(id),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES auth.users(id),
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.committed_stock ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 8. MOTOR DE EVENTOS OPERATIVOS
-- =====================================================

CREATE TABLE public.operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category event_category NOT NULL,
  reference_id UUID NOT NULL,
  reference_type VARCHAR(50) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_description TEXT,
  previous_status VARCHAR(50),
  new_status VARCHAR(50),
  previous_custody_holder_id UUID REFERENCES auth.users(id),
  new_custody_holder_id UUID REFERENCES auth.users(id),
  previous_location_branch_id UUID REFERENCES public.branches(id),
  new_location_branch_id UUID REFERENCES public.branches(id),
  expected_next_event VARCHAR(100),
  expected_next_event_deadline TIMESTAMPTZ,
  triggered_by UUID NOT NULL REFERENCES auth.users(id),
  metadata JSONB DEFAULT '{}',
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_events_reference ON public.operational_events(reference_type, reference_id);
CREATE INDEX idx_events_category ON public.operational_events(category);
CREATE INDEX idx_events_created ON public.operational_events(created_at DESC);

-- =====================================================
-- 9. TRAZABILIDAD DOCUMENTAL
-- =====================================================

CREATE TABLE public.tracked_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type document_type NOT NULL,
  document_number VARCHAR(100) NOT NULL,
  branch_request_id UUID REFERENCES public.branch_requests(id),
  fulfillment_order_id UUID REFERENCES public.fulfillment_orders(id),
  trip_id UUID REFERENCES public.trips(id),
  status document_status NOT NULL DEFAULT 'issued',
  current_holder_id UUID REFERENCES auth.users(id),
  current_holder_role app_role,
  current_location_branch_id UUID REFERENCES public.branches(id),
  expected_next_event VARCHAR(100),
  expected_next_event_deadline TIMESTAMPTZ,
  issued_at TIMESTAMPTZ DEFAULT now(),
  signed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  bims_reference VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tracked_documents ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 10. FLOTA EXTENDIDA
-- =====================================================

CREATE TABLE public.fuel_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  liters NUMERIC(8,2) NOT NULL,
  price_per_liter NUMERIC(8,2),
  total_amount NUMERIC(12,2) NOT NULL,
  mileage_at_fill INTEGER,
  station_name VARCHAR(100),
  receipt_photo_url TEXT,
  payment_method VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fuel_records ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.per_diem_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES public.trips(id),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  concept VARCHAR(200) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  receipt_photo_url TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.per_diem_records ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.driver_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.trips(id),
  driver_id UUID NOT NULL REFERENCES public.drivers(id),
  total_collections NUMERIC(12,2) DEFAULT 0,
  total_fuel NUMERIC(12,2) DEFAULT 0,
  total_per_diem NUMERIC(12,2) DEFAULT 0,
  total_other_expenses NUMERIC(12,2) DEFAULT 0,
  net_amount NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  documents_returned JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.driver_settlements ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  lending_branch_id UUID NOT NULL REFERENCES public.branches(id),
  borrowing_branch_id UUID NOT NULL REFERENCES public.branches(id),
  status vehicle_loan_status NOT NULL DEFAULT 'requested',
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  start_date DATE,
  expected_return_date DATE,
  actual_return_date DATE,
  start_mileage INTEGER,
  return_mileage INTEGER,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_loans ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_maintenance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  maintenance_type VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  scheduled_date DATE,
  completed_date DATE,
  mileage_at_service INTEGER,
  cost NUMERIC(12,2),
  provider VARCHAR(200),
  next_maintenance_date DATE,
  next_maintenance_mileage INTEGER,
  status VARCHAR(20) DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_maintenance ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 11. INVENTARIOS DIRIGIDOS
-- =====================================================

CREATE TABLE public.directed_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status directed_inventory_status NOT NULL DEFAULT 'planned',
  inventory_scope VARCHAR(50) DEFAULT 'full',
  scope_filter JSONB,
  scheduled_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users(id),
  completed_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  data_source VARCHAR(50) DEFAULT 'manual',
  upload_file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.directed_inventories ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.directed_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES public.directed_inventories(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  expected_quantity NUMERIC(12,2),
  counted_quantity NUMERIC(12,2),
  difference NUMERIC(12,2),
  counted_by UUID REFERENCES auth.users(id),
  counted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.directed_inventory_items ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 12. INCIDENTES Y STOCK ESPECIAL
-- =====================================================

CREATE TABLE public.logistics_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_type incident_type NOT NULL,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  branch_request_id UUID REFERENCES public.branch_requests(id),
  fulfillment_order_id UUID REFERENCES public.fulfillment_orders(id),
  trip_id UUID REFERENCES public.trips(id),
  inventory_id UUID REFERENCES public.directed_inventories(id),
  product_id UUID REFERENCES public.products(id),
  quantity_affected NUMERIC(12,2),
  status incident_status NOT NULL DEFAULT 'open',
  current_custody_holder_id UUID REFERENCES auth.users(id),
  current_location_branch_id UUID REFERENCES public.branches(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  photo_urls JSONB DEFAULT '[]',
  resolution TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  reported_by UUID NOT NULL REFERENCES auth.users(id),
  assigned_to UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.logistics_incidents ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.special_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  product_id UUID NOT NULL REFERENCES public.products(id),
  stock_type VARCHAR(50) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  incident_id UUID REFERENCES public.logistics_incidents(id),
  disposition VARCHAR(50),
  disposition_date DATE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.special_stock ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 13. KPIs EXTENSIBLES
-- =====================================================

CREATE TABLE public.kpi_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  area kpi_area NOT NULL,
  source_table VARCHAR(100) NOT NULL,
  aggregation kpi_aggregation NOT NULL,
  value_column VARCHAR(100),
  filter_conditions JSONB DEFAULT '{}',
  date_column VARCHAR(100) DEFAULT 'created_at',
  unit VARCHAR(20) DEFAULT 'count',
  format VARCHAR(20) DEFAULT 'number',
  decimal_places INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  target_value NUMERIC(12,2) NOT NULL,
  warning_threshold NUMERIC(12,2),
  critical_threshold NUMERIC(12,2),
  weight NUMERIC(5,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.kpi_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id),
  period_date DATE NOT NULL,
  value NUMERIC(12,2) NOT NULL,
  previous_value NUMERIC(12,2),
  change_percentage NUMERIC(8,2),
  target_value NUMERIC(12,2),
  achievement_percentage NUMERIC(8,2),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.kpi_values ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_kpi_values_lookup ON public.kpi_values(kpi_id, branch_id, period_date DESC);

-- =====================================================
-- 14. IA
-- =====================================================

CREATE TABLE public.ai_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area kpi_area NOT NULL,
  branch_id UUID REFERENCES public.branches(id),
  anomaly_type VARCHAR(100) NOT NULL,
  severity anomaly_severity NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  supporting_data JSONB DEFAULT '{}',
  affected_entities JSONB DEFAULT '[]',
  is_acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  is_recurring BOOLEAN DEFAULT false,
  occurrence_count INTEGER DEFAULT 1,
  first_detected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_anomalies ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ai_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area kpi_area NOT NULL,
  branch_id UUID REFERENCES public.branches(id),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  expected_impact TEXT,
  supporting_data JSONB DEFAULT '{}',
  anomaly_id UUID REFERENCES public.ai_anomalies(id),
  status recommendation_status NOT NULL DEFAULT 'pending',
  actioned_by UUID REFERENCES auth.users(id),
  actioned_at TIMESTAMPTZ,
  action_notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 15. TRIGGERS
-- =====================================================

CREATE TRIGGER update_branches_updated_at BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_branch_requests_updated_at BEFORE UPDATE ON public.branch_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_fulfillment_orders_updated_at BEFORE UPDATE ON public.fulfillment_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_committed_stock_updated_at BEFORE UPDATE ON public.committed_stock FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tracked_documents_updated_at BEFORE UPDATE ON public.tracked_documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_trips_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_driver_settlements_updated_at BEFORE UPDATE ON public.driver_settlements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_vehicle_loans_updated_at BEFORE UPDATE ON public.vehicle_loans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_vehicle_maintenance_updated_at BEFORE UPDATE ON public.vehicle_maintenance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_directed_inventories_updated_at BEFORE UPDATE ON public.directed_inventories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_logistics_incidents_updated_at BEFORE UPDATE ON public.logistics_incidents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_special_stock_updated_at BEFORE UPDATE ON public.special_stock FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_kpi_definitions_updated_at BEFORE UPDATE ON public.kpi_definitions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_kpi_targets_updated_at BEFORE UPDATE ON public.kpi_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 16. RLS POLICIES
-- =====================================================

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage branches" ON public.branches FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "View vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage vehicles" ON public.vehicles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "View drivers" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage drivers" ON public.drivers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View products" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage products" ON public.products FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View requests" ON public.branch_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Create requests" ON public.branch_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Update requests" ON public.branch_requests FOR UPDATE TO authenticated USING (true);

CREATE POLICY "View request items" ON public.branch_request_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage request items" ON public.branch_request_items FOR ALL TO authenticated USING (true);

CREATE POLICY "View fulfillments" ON public.fulfillment_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage fulfillments" ON public.fulfillment_orders FOR ALL TO authenticated USING (true);

CREATE POLICY "View fulfillment items" ON public.fulfillment_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage fulfillment items" ON public.fulfillment_items FOR ALL TO authenticated USING (true);

CREATE POLICY "View committed stock" ON public.committed_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage committed stock" ON public.committed_stock FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'warehouse_operator')
);

CREATE POLICY "View events" ON public.operational_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert events" ON public.operational_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = triggered_by);

CREATE POLICY "View documents" ON public.tracked_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage documents" ON public.tracked_documents FOR ALL TO authenticated USING (true);

CREATE POLICY "View trips" ON public.trips FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage trips" ON public.trips FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'driver')
);

CREATE POLICY "View fuel" ON public.fuel_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert fuel" ON public.fuel_records FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "View per diem" ON public.per_diem_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert per diem" ON public.per_diem_records FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "View settlements" ON public.driver_settlements FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage settlements" ON public.driver_settlements FOR ALL TO authenticated USING (true);

CREATE POLICY "View loans" ON public.vehicle_loans FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage loans" ON public.vehicle_loans FOR ALL TO authenticated USING (true);

CREATE POLICY "View maintenance" ON public.vehicle_maintenance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage maintenance" ON public.vehicle_maintenance FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
);

CREATE POLICY "View inventories" ON public.directed_inventories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage inventories" ON public.directed_inventories FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'warehouse_operator')
);

CREATE POLICY "View inventory items" ON public.directed_inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage inventory items" ON public.directed_inventory_items FOR ALL TO authenticated USING (true);

CREATE POLICY "View incidents" ON public.logistics_incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Create incidents" ON public.logistics_incidents FOR INSERT TO authenticated WITH CHECK (auth.uid() = reported_by);
CREATE POLICY "Update incidents" ON public.logistics_incidents FOR UPDATE TO authenticated USING (true);

CREATE POLICY "View special stock" ON public.special_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage special stock" ON public.special_stock FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
);

CREATE POLICY "View KPI defs" ON public.kpi_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin KPI defs" ON public.kpi_definitions FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View KPI targets" ON public.kpi_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin KPI targets" ON public.kpi_targets FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "View KPI values" ON public.kpi_values FOR SELECT TO authenticated USING (true);
CREATE POLICY "Insert KPI values" ON public.kpi_values FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "View anomalies" ON public.ai_anomalies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage anomalies" ON public.ai_anomalies FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
);

CREATE POLICY "View recommendations" ON public.ai_recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Manage recommendations" ON public.ai_recommendations FOR ALL TO authenticated USING (
  public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor')
);
