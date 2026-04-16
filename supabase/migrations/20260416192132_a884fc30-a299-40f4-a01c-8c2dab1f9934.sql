
-- 1. Agregar nuevo rol al enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'jefe_logistica';
