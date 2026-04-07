
-- Add barcode column to products for full barcode search support
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode character varying;

-- Add delivery_payer column to branch_requests for tracking who pays delivery
ALTER TABLE public.branch_requests ADD COLUMN IF NOT EXISTS delivery_payer character varying;

-- Create index on products barcode for faster search
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode) WHERE barcode IS NOT NULL;
