import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShoppingCart, User, Package, ListTodo, AlertCircle, Eye, EyeOff, FileText } from "lucide-react";
import { SalesPresentationProvider, useSalesPresentation } from "@/contexts/SalesPresentationContext";
import { ClientePicker } from "@/components/ventas/ClientePicker";
import { CatalogoGrid } from "@/components/ventas/CatalogoGrid";
import { CatalogoPdfPanel } from "@/components/ventas/CatalogoPdfPanel";
import { SeleccionesGuardadas } from "@/components/ventas/SeleccionesGuardadas";

import { ProductoFicha } from "@/components/ventas/ProductoFicha";
import { CarritoPanel, CartItemRow } from "@/components/ventas/CarritoPanel";
import { ConfirmarVenta } from "@/components/ventas/ConfirmarVenta";
import { useSalesCart } from "@/hooks/use-sales-cart";
import { useSalesOutbox } from "@/hooks/use-sales-outbox";
import { useIdbState } from "@/hooks/use-idb-state";
import { useSelectionAutosave, AUTOSAVE_DRAFT_NAME } from "@/hooks/use-selection-autosave";
import { EstadoConexion } from "@/components/ventas/EstadoConexion";
import { PendientesEnvio } from "@/components/ventas/PendientesEnvio";
import { resolvePrice, getScales, ProductRow } from "@/lib/ventas";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const TABS = ["cliente", "catalogo", "carrito", "pedidos"] as const;

function VentasContent({ userId }: { userId: string }) {
  const { clientMode, toggleClientMode } = useSalesPresentation();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useIdbState<(typeof TABS)[number]>(
    `sales-tab-${userId}`,
    "cliente"
  );
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useIdbState<boolean>(
    `sales-selection-mode-${userId}`,
    false
  );
  const [selectedIdList, setSelectedIdList, selectionHydrated] = useIdbState<string[]>(
    `sales-selected-ids-${userId}`,
    []
  );
  const selectedIds = useMemo(() => new Set(selectedIdList), [selectedIdList]);
  const setSelectedIds = (updater: (prev: Set<string>) => Set<string>) =>
    setSelectedIdList((prev) => Array.from(updater(new Set(prev))));
  const [pdfOpen, setPdfOpen] = useState(false);


  const { items, hydrated: cartHydrated, addItem, updateQuantity, updateNotes, removeItem, clearCart, total, count } =
    useSalesCart(`sales-cart-${userId}`);

  const { pending, online, syncing, retryOne, discard } = useSalesOutbox();

  const [customer, setCustomer] = useIdbState(`sales-customer-${userId}`, {
    name: "",
    phone: "",
    email: "",
    address: "",
    ruc: "",
    priceListId: null as string | null,
  });

  // Aviso único al recuperar una carga en curso tras recargar la app
  const restoreNotified = useRef(false);
  useEffect(() => {
    if (!cartHydrated || restoreNotified.current) return;
    restoreNotified.current = true;
    if (items.length > 0) {
      toast({
        title: "Se recuperó tu carga en curso",
        description: `${items.length} producto(s) en el carrito`,
      });
    }
  }, [cartHydrated, items.length, toast]);

  // Respaldo automático de la selección de catálogo en el servidor
  useSelectionAutosave({
    userId,
    selectedIds: selectedIdList,
    customer,
    enabled: selectionHydrated,
  });

  // Si el respaldo local se perdió, recuperamos la última selección del servidor
  const recoveryChecked = useRef(false);
  useEffect(() => {
    if (!selectionHydrated || recoveryChecked.current) return;
    recoveryChecked.current = true;
    if (selectedIdList.length > 0) return;
    void (async () => {
      const { data } = await supabase
        .from("sales_catalog_drafts")
        .select("id, name, product_ids, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ids = (data?.product_ids ?? []) as string[];
      if (ids.length === 0) return;
      toast({
        title: "Tenés una selección guardada",
        description: `${ids.length.toLocaleString("de-DE")} productos${
          data?.name && data.name !== AUTOSAVE_DRAFT_NAME ? ` — ${data.name}` : ""
        }. Tocá para recuperarla.`,
        action: (
          <ToastAction
            altText="Recuperar selección"
            onClick={() => {
              setSelectedIdList(ids);
              setSelectionMode(true);
              setActiveTab("catalogo");
            }}
          >
            Recuperar
          </ToastAction>
        ),
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionHydrated]);




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
    const scales = getScales(product);
    const basePrice = product.sell_price ?? price;
    // Si el precio no proviene de escalas ni del precio base, es lista fija del cliente
    const scalePrice = [...scales]
      .filter((s) => quantity >= s.min_quantity)
      .sort((a, b) => b.min_quantity - a.min_quantity)[0]?.price;
    const hasFixedListPrice = price !== (scalePrice ?? basePrice);
    addItem({
      productId: product.id,
      code: product.bims_code,
      name: product.name,
      imageUrl: product.image_url,
      unit: product.unit,
      quantity,
      unitPrice: price,
      notes: "",
      priceScales: scales,
      basePrice,
      hasFixedListPrice,
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
      <div className="flex-1 overflow-y-auto p-4 pb-20">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display font-bold">Ventas</h1>
            <p className="text-sm text-muted-foreground">
              {clientMode ? "Catálogo en modo cliente" : "Catálogo vendedor"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <EstadoConexion
              online={online}
              pendingCount={pending.length}
              syncing={syncing}
              onClick={() => setActiveTab("pedidos")}
            />
            {activeTab === "catalogo" && (
              <Button
                variant={selectionMode ? "default" : "outline"}
                size="sm"
                aria-pressed={selectionMode}
                onClick={() => {
                  setSelectionMode(!selectionMode);
                }}

              >
                <FileText className="h-4 w-4 mr-1.5" />
                {selectionMode ? "Salir" : "Catálogo PDF"}
              </Button>
            )}
            <Button
              variant={clientMode ? "default" : "outline"}
              size="sm"
              onClick={toggleClientMode}
              aria-pressed={clientMode}
            >
              {clientMode ? <Eye className="h-4 w-4 mr-1.5" /> : <EyeOff className="h-4 w-4 mr-1.5" />}
              {clientMode ? "Modo cliente" : "Modo vendedor"}
            </Button>
          </div>
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
            <div className="flex justify-end mb-2">
              <SeleccionesGuardadas
                userId={userId}
                currentIds={selectedIdList}
                onReplace={(ids) => {
                  setSelectedIdList(ids);
                  setSelectionMode(true);
                }}
                onMerge={(ids) => {
                  setSelectedIdList((prev) => Array.from(new Set([...prev, ...ids])));
                  setSelectionMode(true);
                }}
              />
            </div>
            <CatalogoGrid

              stateKey={`sales-catalog-${userId}`}
              customerPriceListId={customer.priceListId}
              onAdd={handleAddProduct}
              cartItemIds={cartItemIds}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={(id) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelectManyIds={(ids) =>
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  ids.forEach((id) => next.add(id));
                  return next;
                })
              }
              onClearSelection={() => setSelectedIdList([])}
              onGeneratePdf={() => setPdfOpen(true)}
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
                {!customer.name.trim() && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle className="text-sm flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      Falta seleccionar cliente
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      Seleccioná un cliente antes de confirmar el pedido. Tocá "Cliente" arriba para elegirlo.
                    </AlertDescription>
                  </Alert>
                )}
                {items.map((item) => (
                  <CartItemRow
                    key={item.productId}
                    item={item}
                    onUpdateQuantity={updateQuantity}
                    onUpdateNotes={updateNotes}
                    onRemove={removeItem}
                  />
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
            <PendientesEnvio
              entries={pending}
              syncing={syncing}
              online={online}
              onRetry={retryOne}
              onDiscard={discard}
            />
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

      {/* FAB flotante de carrito */}
      {items.length > 0 && activeTab !== "carrito" && !cartOpen && !selectedProduct && !selectionMode && (
        <Button
          onClick={() => setCartOpen(true)}
          aria-label={`Abrir carrito: ${count} ítems, total ${total.toLocaleString("de-DE")}`}
          className="fixed bottom-5 right-5 z-[110] rounded-full h-12 px-4 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300"
          size="default"
        >
          <span className="relative inline-flex mr-2">
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <Badge className="absolute -top-2.5 -right-2.5 h-5 w-5 flex items-center justify-center p-0 text-[10px] pointer-events-none ring-2 ring-primary-foreground shadow-sm">
                {count}
              </Badge>
            )}
          </span>
          <span className="font-semibold text-sm">{total.toLocaleString("de-DE")}</span>
        </Button>
      )}

      <ProductoFicha
        product={selectedProduct}
        customerPriceListId={customer.priceListId}
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onAdd={handleAddProduct}
        cartQuantity={
          items.find((i) => i.productId === selectedProduct?.id)?.quantity ?? 0
        }
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
        onSelectCustomer={() => {
          setCartOpen(false);
          setActiveTab("cliente");
        }}
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

      <CatalogoPdfPanel
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        selectedIds={Array.from(selectedIds)}
        onRemoveId={(id) =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          })
        }
        customer={customer}
        salespersonName={profile?.full_name}
        userId={userId}
        onRestoreIds={(ids) => {
          setSelectedIdList(ids);
          setSelectionMode(true);
          setActiveTab("catalogo");
        }}
        onClearSelection={() => setSelectedIdList([])}
      />
    </div>
  );
}

export default function Ventas() {
  const { user, loading } = useAuth();
  // Montamos recién con la sesión resuelta: así el carrito siempre usa la
  // clave del usuario y nunca se pisa un guardado bueno con estado vacío.
  if (loading || !user) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando ventas...</p>
      </div>
    );
  }
  return (
    <SalesPresentationProvider>
      <VentasContent userId={user.id} />
    </SalesPresentationProvider>
  );
}
