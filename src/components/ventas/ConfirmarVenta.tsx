import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatGs } from "@/lib/ventas";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { CartItem, CartCustomer } from "@/hooks/use-sales-cart";

const SHIPPING_METHODS = [
  { value: "own_fleet", label: "Flota propia" },
  { value: "courier", label: "Courier" },
  { value: "pickup", label: "Retiro en sucursal" },
  { value: "delivery", label: "Entrega a domicilio" },
];

export function ConfirmarVenta({
  open,
  onOpenChange,
  customer,
  items,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CartCustomer;
  items: CartItem[];
  onSuccess: () => void;
}) {
  const { user, profile, branchAccess, allowedBranchIds } = useAuth();
  const { toast } = useToast();
  const [shippingMethod, setShippingMethod] = useState<string>("own_fleet");
  const [paymentMethod, setPaymentMethod] = useState<string>("contado");
  const [notes, setNotes] = useState("");
  const [shippingCost, setShippingCost] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  const { data: allowedBranches } = useQuery({
    queryKey: ["allowed-branches", allowedBranchIds],
    queryFn: async () => {
      if (profile?.all_branches_access) {
        const { data, error } = await supabase.from("branches").select("id, name, code").eq("is_active", true);
        if (error) throw error;
        return data ?? [];
      }
      if (allowedBranchIds.length === 0) return [];
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, code")
        .in("id", allowedBranchIds)
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    if (profile?.default_branch_id) {
      setSelectedBranchId(profile.default_branch_id);
    } else if (allowedBranches && allowedBranches.length === 1) {
      setSelectedBranchId(allowedBranches[0].id);
    }
  }, [open, profile?.default_branch_id, allowedBranches]);

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sin sesión");
      if (!selectedBranchId) throw new Error("Seleccioná la sucursal para la pre-venta");
      if (items.length === 0) throw new Error("Carrito vacío");
      if (!customer.name.trim()) throw new Error("Falta el cliente");

      // Crear el cliente manual si no existe en sales_customers
      let customerId = customer.id;
      if (!customerId) {
        const { data: existing, error: searchError } = await supabase
          .from("sales_customers")
          .select("id")
          .eq("name", customer.name.trim())
          .eq("source", "manual")
          .maybeSingle();
        if (searchError) throw searchError;

        if (existing?.id) {
          customerId = existing.id;
        } else {
          const { data: created, error: createError } = await supabase
            .from("sales_customers")
            .insert({
              name: customer.name.trim(),
              ruc: customer.ruc || null,
              phone: customer.phone || null,
              email: customer.email || null,
              address: customer.address || null,
              source: "manual",
              created_by: user.id,
            })
            .select("id")
            .single();
          if (createError) throw createError;
          customerId = created.id;
        }
      }

      // Crear el branch_requests como pre_sale_online
      const { data: order, error: orderError } = await supabase
        .from("branch_requests")
        .insert({
          request_type: "pre_sale_online",
          requesting_branch_id: selectedBranchId,
          source_branch_id: selectedBranchId,
          delivery_target: "client",
          shipping_method: shippingMethod as any,
          shipping_cost: shippingCost ? Number(shippingCost) : null,
          client_name: customer.name.trim(),
          client_phone: customer.phone || null,
          client_email: customer.email || null,
          client_address: customer.address || null,
          is_pre_sale: true,
          pre_sale_status: "confirmed",
          pre_sale_confirmed_at: new Date().toISOString(),
          sales_channel: "vendedor_externo",
          commercial_terms: `Pago: ${paymentMethod}. Notas: ${notes || "-"}`,
          notes: notes || null,
          status: "pending",
          created_by: user.id,
        })
        .select("id")
        .single();
      if (orderError) throw orderError;

      // Crear ítems
      const orderItems = items.map((item) => ({
        request_id: order.id,
        product_id: item.productId,
        quantity_requested: item.quantity,
        quantity_unfulfilled: 0,
        quantity_accepted: 0,
        quantity_picked: 0,
        quantity_received: 0,
        quantity_shipped: 0,
        local_supply_qty: 0,
        item_purpose: "client" as const,
        notes: item.notes || null,
      }));

      const { error: itemsError } = await supabase.from("branch_request_items").insert(orderItems);
      if (itemsError) throw itemsError;

      // Guardar borrador en sales_carts para trazabilidad del vendedor
      await supabase.from("sales_carts").insert({
        salesperson_id: user.id,
        customer_id: customerId,
        client_name: customer.name.trim(),
        client_phone: customer.phone || null,
        client_email: customer.email || null,
        client_address: customer.address || null,
        notes: notes || null,
        sales_channel: "vendedor_externo",
        status: "submitted",
      });

      return order.id;
    },
    onSuccess: (orderId) => {
      toast({
        title: "Pre-venta creada",
        description: `N° ${orderId.slice(0, 8)}. El pedido pasó a preparación.`,
      });
      onSuccess();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error al crear pre-venta",
        description: error instanceof Error ? error.message : "Ocurrió un error",
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Confirmar pre-venta</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="bg-muted/50 rounded-lg p-3 text-sm">
            <p className="font-medium">{customer.name}</p>
            {customer.ruc && <p className="text-muted-foreground">RUC: {customer.ruc}</p>}
            {customer.phone && <p className="text-muted-foreground">Tel: {customer.phone}</p>}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Resumen de ítems</p>
            <div className="max-h-32 overflow-y-auto text-sm space-y-1">
              {items.map((i) => (
                <div key={i.productId} className="flex justify-between">
                  <span className="line-clamp-1">
                    {i.quantity} × {i.name}
                  </span>
                  <span className="font-medium">{formatGs(i.quantity * i.unitPrice)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Forma de envío</Label>
              <select
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {SHIPPING_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Forma de pago</Label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
                <option value="cheque">Cheque</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Costo de envío (opcional)</Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones para preparación..."
              className="min-h-[60px]"
            />
          </div>

          <div className="flex items-center justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatGs(total + (Number(shippingCost) || 0))}</span>
          </div>

          <Button
            className="w-full"
            onClick={() => createOrder.mutate()}
            disabled={createOrder.isPending}
          >
            {createOrder.isPending ? "Creando..." : "Crear pre-venta"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
