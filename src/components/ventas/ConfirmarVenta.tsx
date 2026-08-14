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
import { enqueuePreSale, processEntry } from "@/lib/sales-outbox";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIdbState } from "@/hooks/use-idb-state";
import { WifiOff } from "lucide-react";

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
  const online = useOnlineStatus();
  const [shippingMethod, setShippingMethod] = useState<string>("own_fleet");
  const [paymentMethod, setPaymentMethod] = useState<string>("contado");
  const [notes, setNotes] = useState("");
  const [shippingCost, setShippingCost] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  // Última sucursal usada: queda en el dispositivo para poder cerrar pedidos sin señal
  const [lastBranchId, setLastBranchId] = useIdbState<string | null>("ventas-last-branch", null);

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
    } else if (lastBranchId) {
      setSelectedBranchId(lastBranchId);
    } else if (allowedBranchIds.length === 1) {
      setSelectedBranchId(allowedBranchIds[0]);
    }
  }, [open, profile?.default_branch_id, allowedBranches, lastBranchId, allowedBranchIds]);

  const createOrder = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sin sesión");
      if (!selectedBranchId) throw new Error("Seleccioná la sucursal para la pre-venta");
      if (items.length === 0) throw new Error("Carrito vacío");
      if (!customer.name.trim()) throw new Error("Falta el cliente");

      // 1) Siempre se guarda primero en el dispositivo
      setLastBranchId(selectedBranchId);

      const entry = await enqueuePreSale({
        customer,
        items,
        branchId: selectedBranchId,
        shippingMethod,
        paymentMethod,
        shippingCost: shippingCost ? Number(shippingCost) : null,
        notes,
        userId: user.id,
      });

      // 2) Si hay señal, se intenta enviar de inmediato
      if (!navigator.onLine) return { queued: true as const };
      const result = await processEntry(entry);
      if (!result.ok) return { queued: true as const, error: result.error };
      return { queued: false as const };
    },
    onSuccess: (result) => {
      if (result.queued) {
        toast({
          title: result.error ? "Pedido guardado, pendiente de envío" : "Pedido guardado sin conexión",
          description: result.error
            ? `No se pudo enviar ahora (${result.error}). Queda en "Pendientes de envío" y se reintenta solo.`
            : "Se va a enviar automáticamente cuando vuelva la conexión. Podés verlo en \"Pendientes de envío\".",
        });
      } else {
        toast({
          title: "Pre-venta creada",
          description: "El pedido pasó a preparación.",
        });
      }
      onSuccess();
      onOpenChange(false);
    },
    onError: (error) => {
      toast({
        title: "Error al confirmar",
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

          {(allowedBranches && allowedBranches.length > 1) && (
            <div className="space-y-1">
              <Label className="text-xs">Sucursal de origen *</Label>
              <select
                value={selectedBranchId ?? ""}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="" disabled>Seleccionar sucursal</option>
                {allowedBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.code ? `(${b.code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

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

          {!online && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
              <WifiOff className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <span>
                Estás sin conexión. El pedido se guarda en el dispositivo y se envía solo cuando
                vuelva la señal. No se pierde nada.
              </span>
            </div>
          )}

          {!selectedBranchId && (
            <p className="text-xs text-destructive">
              Elegí la sucursal de origen para poder guardar el pedido.
            </p>
          )}

          <Button
            className="w-full"
            onClick={() => createOrder.mutate()}
            disabled={createOrder.isPending || !selectedBranchId}
          >
            {createOrder.isPending
              ? "Guardando..."
              : online
                ? "Crear pre-venta"
                : "Guardar pedido"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
