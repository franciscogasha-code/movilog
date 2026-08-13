import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, User, Package, ListTodo } from "lucide-react";
import { ClientePicker } from "@/components/ventas/ClientePicker";
import { CatalogoGrid } from "@/components/ventas/CatalogoGrid";
import { ProductoFicha } from "@/components/ventas/ProductoFicha";
import { CarritoPanel } from "@/components/ventas/CarritoPanel";
import { ConfirmarVenta } from "@/components/ventas/ConfirmarVenta";
import { useSalesCart } from "@/hooks/use-sales-cart";
import { resolvePrice, ProductRow } from "@/lib/ventas";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const TABS = ["cliente", "catalogo", "carrito", "pedidos"] as const;

export default function Ventas() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("cliente");
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const { items, addItem, updateQuantity, updateNotes, removeItem, clearCart, total, count } =
    useSalesCart();

  const [customer, setCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    ruc: "",
    priceListId: null as string | null,
  });

  const cartItemIds = new Set(items.map((i) => i.productId));

  const { data: preSales } = useQuery({
    queryKey: ["sales_pre_sales", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("branch_requests")
        .select("id, request_number, status, created_at, client_name")
        .eq("created_by", user.id)
        .eq("is_pre_sale", true)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleAddProduct = (product: ProductRow, quantity: number) => {
    if (quantity === 0) {
      setSelectedProduct(product);
      return;
    }
    const price = resolvePrice(product, customer.priceListId, quantity);
    addItem({
      productId: product.id,
      code: product.bims_code,
      name: product.name,
      imageUrl: product.image_url,
      unit: product.unit,
      quantity,
      unitPrice: price,
      notes: "",
    });
    toast({ title: "Producto agregado", description: `${product.name} × ${quantity}` });
    setSelectedProduct(null);
  };

  const handleConfirm = () => {
    if (!customer.name.trim()) {
      toast({ title: "Falta cliente", description: "Seleccioná un cliente antes de confirmar", variant: "destructive" });
      setActiveTab("cliente");
      return;
    }
    if (items.length === 0) {
      toast({ title: "Carrito vacío", description: "Agregá productos antes de confirmar", variant: "destructive" });
      setActiveTab("catalogo");
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 pb-24">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold">Ventas</h1>
            <p className="text-sm text-muted-foreground">Catálogo vendedor</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCartOpen(true)} className="relative">
            <ShoppingCart className="h-4 w-4 mr-1" />
            Carrito
            {count > 0 && (
              <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-[10px]">
                {count}
              </Badge>
            )}
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="w-full grid grid-cols-4 mb-4">
            <TabsTrigger value="cliente" className="text-xs">
              <User className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Cliente</span>
            </TabsTrigger>
            <TabsTrigger value="catalogo" className="text-xs">
              <Package className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Catálogo</span>
            </TabsTrigger>
            <TabsTrigger value="carrito" className="text-xs">
              <ShoppingCart className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Carrito</span>
              {count > 0 && (
                <Badge variant="default" className="ml-1 h-4 w-4 p-0 flex items-center justify-center text-[9px]">
                  {count}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pedidos" className="text-xs">
              <ListTodo className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Pedidos</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cliente" className="mt-0">
            <ClientePicker value={customer} onChange={setCustomer} />
            <Button
              className="w-full mt-4"
              disabled={!customer.name.trim()}
              onClick={() => setActiveTab("catalogo")}
            >
              Continuar al catálogo
            </Button>
          </TabsContent>

          <TabsContent value="catalogo" className="mt-0">
            <CatalogoGrid
              customerPriceListId={customer.priceListId}
              onAdd={handleAddProduct}
              cartItemIds={cartItemIds}
            />
          </TabsContent>

          <TabsContent value="carrito" className="mt-0">
            {items.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted-foreground mb-4">El carrito está vacío</p>
                <Button onClick={() => setActiveTab("catalogo")}>Ir al catálogo</Button>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.productId} className="border rounded-lg p-3 space-y-2">
                    <div className="flex justify-between">
                      <p className="font-medium text-sm">{item.name}</p>
                      <Button variant="ghost" size="icon" onClick={() => removeItem(item.productId)}>
                        <ShoppingCart className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                      >
                        −
                      </Button>
                      <span className="w-8 text-center text-sm">{item.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                      >
                        +
                      </Button>
                      <span className="ml-auto font-semibold">
                        {(item.quantity * item.unitPrice).toLocaleString("de-DE")}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between text-lg font-bold pt-4 border-t">
                  <span>Total</span>
                  <span>{total.toLocaleString("de-DE")}</span>
                </div>
                <Button className="w-full" onClick={handleConfirm}>
                  Revisar y confirmar
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="pedidos" className="mt-0">
            <div className="space-y-3">
              {(preSales ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Aún no tenés pre-ventas registradas
                </p>
              )}
              {(preSales ?? []).map((order: any) => (
                <div key={order.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Pedido #{order.request_number}</span>
                    <Badge variant="outline">{order.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{order.client_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: es })}
                  </p>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* FAB para confirmar desde cualquier pestaña */}
      {items.length > 0 && customer.name.trim() && activeTab !== "carrito" && (
        <div className="fixed bottom-4 left-4 right-4 z-50">
          <Button className="w-full shadow-lg" size="lg" onClick={handleConfirm}>
            Revisar y confirmar ({count} ítems / {total.toLocaleString("de-DE")})
          </Button>
        </div>
      )}

      <ProductoFicha
        product={selectedProduct}
        customerPriceListId={customer.priceListId}
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onAdd={handleAddProduct}
      />

      <CarritoPanel
        open={cartOpen}
        onOpenChange={setCartOpen}
        items={items}
        customer={customer}
        onUpdateQuantity={updateQuantity}
        onUpdateNotes={updateNotes}
        onRemove={removeItem}
        onConfirm={handleConfirm}
      />

      <ConfirmarVenta
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        customer={customer}
        items={items}
        onSuccess={() => {
          clearCart();
          setCustomer({ name: "", phone: "", email: "", address: "", ruc: "", priceListId: null });
          setActiveTab("pedidos");
        }}
      />
    </div>
  );
}
