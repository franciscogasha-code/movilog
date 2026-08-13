ALTER TABLE public.products ADD COLUMN IF NOT EXISTS bims_label_id text;
CREATE INDEX IF NOT EXISTS idx_products_bims_label_id ON public.products (bims_label_id);