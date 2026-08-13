-- Mirror local de clientes BIMS + alta manual
CREATE TABLE public.sales_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bims_contact_id TEXT,
  name TEXT NOT NULL,
  ruc TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  price_list_id TEXT,
  price_list_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  latitude NUMERIC,
  longitude NUMERIC,
  source TEXT NOT NULL DEFAULT 'bims' CHECK (source IN ('bims', 'manual')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(bims_contact_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_customers TO authenticated;
GRANT ALL ON public.sales_customers TO service_role;

ALTER TABLE public.sales_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver clientes comerciales" ON public.sales_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Gestionar clientes comerciales" ON public.sales_customers FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'salesperson')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'salesperson')
  );

-- Asignación vendedor ↔ cliente (cartera)
CREATE TABLE public.salesperson_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.sales_customers(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(salesperson_id, customer_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesperson_customers TO authenticated;
GRANT ALL ON public.salesperson_customers TO service_role;

ALTER TABLE public.salesperson_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver cartera propia" ON public.salesperson_customers FOR SELECT TO authenticated
  USING (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
CREATE POLICY "Gestionar cartera propia" ON public.salesperson_customers FOR ALL TO authenticated
  USING (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  WITH CHECK (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

-- Carritos / borradores de pedido del vendedor
CREATE TABLE public.sales_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.sales_customers(id) ON DELETE SET NULL,
  client_name TEXT,
  client_phone TEXT,
  client_email TEXT,
  client_address TEXT,
  notes TEXT,
  sales_channel TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  client_uuid TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_carts TO authenticated;
GRANT ALL ON public.sales_carts TO service_role;

ALTER TABLE public.sales_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver carritos propios" ON public.sales_carts FOR SELECT TO authenticated
  USING (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
CREATE POLICY "Gestionar carritos propios" ON public.sales_carts FOR ALL TO authenticated
  USING (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
  WITH CHECK (salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

-- Ítems de carrito
CREATE TABLE public.sales_cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES public.sales_carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_cart_items TO authenticated;
GRANT ALL ON public.sales_cart_items TO service_role;

ALTER TABLE public.sales_cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver ítems de carritos propios" ON public.sales_cart_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_carts c
      WHERE c.id = sales_cart_items.cart_id
        AND (c.salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  );
CREATE POLICY "Gestionar ítems de carritos propios" ON public.sales_cart_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sales_carts c
      WHERE c.id = sales_cart_items.cart_id
        AND (c.salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales_carts c
      WHERE c.id = sales_cart_items.cart_id
        AND (c.salesperson_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    )
  );

-- Triggers de actualización
CREATE TRIGGER update_sales_customers_updated_at BEFORE UPDATE ON public.sales_customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_salesperson_customers_updated_at BEFORE UPDATE ON public.salesperson_customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sales_carts_updated_at BEFORE UPDATE ON public.sales_carts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sales_cart_items_updated_at BEFORE UPDATE ON public.sales_cart_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();