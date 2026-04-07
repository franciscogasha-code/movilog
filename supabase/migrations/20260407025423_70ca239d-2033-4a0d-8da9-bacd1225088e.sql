
-- Add commercial fields to products table for BIMS data
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sell_price numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS buy_price numeric;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_scales jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_lists jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_by_warehouse jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS total_stock numeric DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS bims_warehouse_id text;

-- Add validation trigger to prevent double-charge on delivery
CREATE OR REPLACE FUNCTION public.fn_validate_delivery_charges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.shipping_origin_paid > 0 AND NEW.shipping_destination_paid > 0 THEN
    RAISE EXCEPTION 'No se permite cobrar envío en origen y destino simultáneamente';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_delivery_charges ON public.branch_requests;
CREATE TRIGGER trg_validate_delivery_charges
  BEFORE INSERT OR UPDATE ON public.branch_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_validate_delivery_charges();
