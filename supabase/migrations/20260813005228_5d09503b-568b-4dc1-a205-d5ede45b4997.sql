CREATE OR REPLACE FUNCTION public.fn_catalog_facets()
RETURNS TABLE(kind text, value text, total bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'category'::text, btrim(category), count(*)
  FROM public.products
  WHERE is_active AND category IS NOT NULL AND btrim(category) <> ''
  GROUP BY 2
  UNION ALL
  SELECT 'brand'::text, btrim(brand), count(*)
  FROM public.products
  WHERE is_active AND brand IS NOT NULL AND btrim(brand) <> ''
  GROUP BY 2
  HAVING count(*) >= 3
$$;

REVOKE ALL ON FUNCTION public.fn_catalog_facets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_catalog_facets() TO authenticated, service_role;