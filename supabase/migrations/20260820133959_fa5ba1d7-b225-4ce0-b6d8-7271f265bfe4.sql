ALTER TABLE public.branch_requests
  ADD COLUMN IF NOT EXISTS instruction_source text;

COMMENT ON COLUMN public.branch_requests.instruction_source IS
  'Origen de la orden externa (verbal, WhatsApp, etc.) para envíos directos entre sucursales';