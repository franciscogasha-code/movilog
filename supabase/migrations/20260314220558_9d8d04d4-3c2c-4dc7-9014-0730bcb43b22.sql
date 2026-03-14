
-- =============================================
-- PHASE 1: OPERATIONAL REFINEMENTS FOR SLIS
-- =============================================

-- 1. Expand request_type enum with online + redistribution
ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'online';
ALTER TYPE public.request_type ADD VALUE IF NOT EXISTS 'redistribution';

-- 2. Expand shipping_method with direct_client
ALTER TYPE public.shipping_method ADD VALUE IF NOT EXISTS 'direct_client';

-- 3. Add damage_origin enum for incident detail
CREATE TYPE public.damage_origin AS ENUM (
  'transfer_reception',
  'collaborator',
  'customer',
  'sealed_package',
  'product_defect'
);

-- 4. Consultation status enum
CREATE TYPE public.consultation_status AS ENUM ('open', 'responded', 'converted', 'expired');

-- 5. Trip type enum
CREATE TYPE public.trip_type AS ENUM ('urban_cutoff', 'interurban_planned');

-- 6. Shipment package type enum  
CREATE TYPE public.package_label_type AS ENUM ('inter_branch', 'customer', 'courier');
