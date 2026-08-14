ALTER TABLE public.branch_requests ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS branch_requests_client_uuid_key ON public.branch_requests (client_uuid) WHERE client_uuid IS NOT NULL;

ALTER TABLE public.sales_carts ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_carts_client_uuid_key ON public.sales_carts (client_uuid) WHERE client_uuid IS NOT NULL;