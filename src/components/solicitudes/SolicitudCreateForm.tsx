import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ProductCard } from "@/components/shared/ProductCard";
import { BranchSelector, MultiBranchSelector, useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { Plus, Trash2, Package, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface SelectedItem {
  product: ProductResult;
  quantity: number;
}

type RequestType = "reposition" | "client" | "online";
type DeliveryTarget = "branch" | "client";
type ShippingMethod = "own_fleet" | "courier" | "pickup" | "delivery";

export function SolicitudCreateForm({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth();
  const { defaultBranchId, canChangeBranch } = useAutoDetectBranch();

  // Step 1: Context
  const [requestingBranchId, setRequestingBranchId] = useState("");
  const [requestType, setRequestType] = useState<RequestType>("reposition");

  // Step 2: Products
  const [items, setItems] = useState<SelectedItem[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Step 3: Origin (derived from availability)
  const [sourceBranchIds, setSourceBranchIds] = useState<string[]>([]);

  // Step 4: Logistics
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>("branch");
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("own_fleet");
  const [clientName, setClientName] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [deliveryPaidBy, setDeliveryPaidBy] = useState<"company" | "client">("company");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  // Auto-detect branch
  useEffect(() => {
    if (defaultBranchId && !requestingBranchId) {
      setRequestingBranchId(defaultBranchId);
    }
  }, [defaultBranchId, requestingBranchId]);

  // Business rules: reset fields when type changes
  useEffect(() => {
    if (requestType === "reposition") {
      setDeliveryTarget("branch");
      setClientName("");
      setClientAddress("");
    }
  }, [requestType]);

  const addProduct = (product: ProductResult) => {
    if (items.find(i => i.product.id === product.id)) {
      toast.info("Producto ya agregado");
      return;
    }
    setItems(prev => [...prev, { product, quantity: 1 }]);
    setExpandedProduct(product.id);
  };

  const removeProduct = (productId: string) => {
    setItems(prev => prev.filter(i => i.product.id !== productId));
    if (expandedProduct === productId) setExpandedProduct(null);
  };

  const updateQuantity = (productId: string, qty: number) => {
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: Math.max(1, qty) } : i));
  };

  const handleSelectSourceFromCard = (branchId: string) => {
    if (!sourceBranchIds.includes(branchId)) {
      setSourceBranchIds(prev => [...prev, branchId]);
    }
  };

  // Determine which fields to show
  const showClientFields = deliveryTarget === "client" && (requestType === "client" || requestType === "online");
  const showDeliveryTarget = requestType !== "reposition";
  const showDeliveryPaidBy = shippingMethod === "delivery";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestingBranchId || !items.length || !sourceBranchIds.length) {
      toast.error("Completar sucursal solicitante, productos y al menos una sucursal origen");
      return;
    }

    setSubmitting(true);
    try {
      if (!user) { toast.error("Debés iniciar sesión"); return; }

      // Use first source branch as primary (multi-source = multiple requests in future)
      const primarySourceId = sourceBranchIds[0];

      const { data: request, error } = await supabase
        .from("branch_requests")
        .insert({
          requesting_branch_id: requestingBranchId,
          source_branch_id: primarySourceId,
          request_type: requestType as any,
          delivery_target: deliveryTarget as any,
          shipping_method: shippingMethod as any,
          client_name: showClientFields ? (clientName || null) : null,
          client_address: showClientFields ? (clientAddress || null) : null,
          notes: notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Item purpose matches request type (no per-item purpose)
      const itemPurpose = requestType === "client" || requestType === "online" ? "client" : "reposition";

      const itemsToInsert = items.map((item) => ({
        request_id: request.id,
        product_id: item.product.id,
        quantity_requested: item.quantity,
        item_purpose: itemPurpose as any,
        client_name: showClientFields ? (clientName || null) : null,
        client_address: showClientFields ? (clientAddress || null) : null,
      }));

      const { error: itemsError } = await supabase.from("branch_request_items").insert(itemsToInsert);
      if (itemsError) throw itemsError;

      toast.success(`Pedido #${request.request_number} creado`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* STEP 1: Context */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Contexto</h3>
        <div className="grid grid-cols-2 gap-4">
          <BranchSelector
            label="Sucursal solicitante"
            value={requestingBranchId}
            onChange={setRequestingBranchId}
            disabled={!canChangeBranch && !!defaultBranchId}
          />
          <div className="space-y-2">
            <Label>Tipo de solicitud</Label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as RequestType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="reposition">Reposición</option>
              <option value="client">Pedido Cliente</option>
              <option value="online">Pedido Online</option>
            </select>
          </div>
        </div>
      </div>

      {/* STEP 2: Products */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">2. Productos</h3>
        <ProductSearch
          onSelect={addProduct}
          excludeIds={items.map(i => i.product.id)}
        />

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.product.id} className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-muted/30">
                  <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.product.sku && `SKU: ${item.product.sku}`}
                      {item.product.bims_code && ` • Cód: ${item.product.bims_code}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs shrink-0">Cant:</Label>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.product.id, parseInt(e.target.value) || 1)}
                      className="w-20 h-8 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedProduct(expandedProduct === item.product.id ? null : item.product.id)}
                    >
                      {expandedProduct === item.product.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(item.product.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                {/* Expanded: Product card with stock / actions */}
                {expandedProduct === item.product.id && (
                  <div className="p-3 border-t border-border/50">
                    <ProductCard
                      productId={item.product.id}
                      productName={item.product.name}
                      productSku={item.product.sku}
                      productBimsCode={item.product.bims_code}
                      productCategory={item.product.category}
                      productUnit={item.product.unit}
                      onSelectSourceBranch={handleSelectSourceFromCard}
                      compact={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {items.length === 0 && (
          <div className="text-center p-6 rounded-lg border border-dashed border-border text-muted-foreground text-sm">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Buscá y agregá productos usando el buscador
          </div>
        )}
      </div>

      {/* STEP 3: Origin */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">3. Origen del stock</h3>
        <p className="text-xs text-muted-foreground">Seleccioná la(s) sucursal(es) de donde se enviará la mercadería. Podés elegir desde la ficha del producto.</p>
        <MultiBranchSelector
          selected={sourceBranchIds}
          onChange={setSourceBranchIds}
          excludeIds={requestingBranchId ? [requestingBranchId] : []}
          label="Sucursales origen"
        />
      </div>

      {/* STEP 4: Logistics */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">4. Logística</h3>

        <div className="grid grid-cols-2 gap-4">
          {showDeliveryTarget && (
            <div className="space-y-2">
              <Label>Destino de entrega</Label>
              <select
                value={deliveryTarget}
                onChange={(e) => setDeliveryTarget(e.target.value as DeliveryTarget)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="branch">A sucursal</option>
                <option value="client">A cliente</option>
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Método de envío</Label>
            <select
              value={shippingMethod}
              onChange={(e) => setShippingMethod(e.target.value as ShippingMethod)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="own_fleet">Flota propia</option>
              <option value="courier">Encomienda</option>
              <option value="pickup">Retiro en sucursal</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>
        </div>

        {/* Delivery payer */}
        {showDeliveryPaidBy && (
          <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-border/50">
            <Label>¿Quién paga el delivery?</Label>
            <div className="flex gap-3">
              <Badge
                variant={deliveryPaidBy === "company" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setDeliveryPaidBy("company")}
              >
                Empresa paga
              </Badge>
              <Badge
                variant={deliveryPaidBy === "client" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setDeliveryPaidBy("client")}
              >
                Cliente paga
              </Badge>
            </div>
          </div>
        )}

        {/* Client fields */}
        {showClientFields && (
          <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-muted/50 border border-border/50">
            <div className="space-y-2">
              <Label>Cliente (nombre)</Label>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="space-y-2">
              <Label>Dirección de entrega</Label>
              <Input
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="Dirección"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Notas</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones adicionales..." rows={2} />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={submitting || !items.length || !sourceBranchIds.length}>
        {submitting ? "Creando..." : `Crear Pedido (${items.length} producto${items.length !== 1 ? "s" : ""})`}
      </Button>
    </form>
  );
}
