CREATE TABLE public.sales_catalog_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  product_ids uuid[] NOT NULL DEFAULT '{}',
  customer jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_catalog_drafts TO authenticated;
GRANT ALL ON public.sales_catalog_drafts TO service_role;
ALTER TABLE public.sales_catalog_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalog_drafts_select_own" ON public.sales_catalog_drafts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "catalog_drafts_insert_own" ON public.sales_catalog_drafts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_drafts_update_own" ON public.sales_catalog_drafts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "catalog_drafts_delete_own" ON public.sales_catalog_drafts FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE INDEX sales_catalog_drafts_user_updated_idx ON public.sales_catalog_drafts (user_id, updated_at DESC);
CREATE OR REPLACE FUNCTION public.set_sales_catalog_draft_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_sales_catalog_draft_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_sales_catalog_draft_updated_at() TO service_role;
CREATE TRIGGER set_sales_catalog_drafts_updated_at
BEFORE UPDATE ON public.sales_catalog_drafts
FOR EACH ROW EXECUTE FUNCTION public.set_sales_catalog_draft_updated_at();