
-- 1. Enum: motivos tipificados de rechazo
CREATE TYPE public.rejection_reason_type AS ENUM (
  'no_stock_real',
  'stock_difference',
  'product_not_found',
  'stock_reserved',
  'not_convenient_rotation',
  'other'
);

-- 2. Enum: disposición de stock especial
CREATE TYPE public.stock_disposition AS ENUM (
  'ajuste_inventario',
  'reclamo_proveedor',
  'descuento_colaborador',
  'imputacion_salon',
  'imputacion_sucursal',
  'perdida_empresa',
  'venta_feria',
  'reconteo_pendiente',
  'other'
);

-- 3. Enum: propósito del ítem (cliente o reposición)
CREATE TYPE public.item_purpose AS ENUM (
  'client',
  'reposition'
);

-- 4. Agregar columna de motivo tipificado a branch_requests
ALTER TABLE public.branch_requests
  ADD COLUMN rejection_reason_type public.rejection_reason_type DEFAULT NULL;

-- 5. Separar cierre logístico y cierre administrativo
ALTER TABLE public.branch_requests
  ADD COLUMN logistic_closed_at timestamptz DEFAULT NULL,
  ADD COLUMN logistic_closed_by uuid DEFAULT NULL,
  ADD COLUMN admin_closed_at timestamptz DEFAULT NULL,
  ADD COLUMN admin_closed_by uuid DEFAULT NULL;

-- 6. Agregar propósito por ítem en branch_request_items
ALTER TABLE public.branch_request_items
  ADD COLUMN item_purpose public.item_purpose NOT NULL DEFAULT 'reposition',
  ADD COLUMN client_name varchar DEFAULT NULL,
  ADD COLUMN client_address text DEFAULT NULL;

-- 7. Cambiar special_stock.disposition de varchar a enum
ALTER TABLE public.special_stock
  ALTER COLUMN disposition TYPE public.stock_disposition USING disposition::public.stock_disposition;

-- 8. Agregar rejection_reason_type a branch_request_items para rechazos parciales por ítem
ALTER TABLE public.branch_request_items
  ADD COLUMN rejection_reason_type public.rejection_reason_type DEFAULT NULL;
