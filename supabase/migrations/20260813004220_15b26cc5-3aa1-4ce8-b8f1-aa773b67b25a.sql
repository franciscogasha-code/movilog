ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand text;
CREATE INDEX IF NOT EXISTS idx_products_brand ON public.products (brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);