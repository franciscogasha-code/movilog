import { useState, useMemo, useEffect } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranches } from "@/hooks/use-branches";
import { useAutoDetectBranch } from "@/components/shared/BranchSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Formulario Pre Venta Online (capa comercial previa).
 * - Crea branch_requests con is_pre_sale=true, request_type='pre_sale_online', status='draft'.
 * - Validación cliente con zod (frontend). Re-validación final en RPC fn_send_presale_to_operation.
 * - No genera fulfillment, no afecta stock comprometido, no aparece en módulos operativos.
 */

const SHIPPING_METHODS = [
  { v: "pickup", l: "Retiro del cliente" },
  { v: "own_fleet", l: "Flota propia" },
  { v: "delivery", l: "Delivery" },
  { v: "courier", l: "Courier" },
] as const;

const SALES_CHANNELS = [
  { v: "whatsapp", l: "WhatsApp" },
  { v: "instagram", l: "Instagram" },
  { v: "presencial", l: "Presencial" },
  { v: "telefono", l: "Teléfono" },
  { v: "otro", l: "Otro" },
];

const clientSchema = (requiresAddress: boolean) =>
  z.object({
    client_name: z.string().trim().min(2, "Nombre muy corto").max(120),
    client_phone: z.string().trim().min(6, "Teléfono inválido").max(40),
    client_email: z.string().trim().email("Email inválido").max(120).optional().or(z.literal("")),
    client_address: requiresAddress
      ? z.string().trim().min(5, "Dirección requerida para delivery/courier").max(300)
      : z.string().trim().max(300).optional().or(z.literal("")),
  });

interface SelItem {
  product: ProductResult;
  quantity: number;
}

export function PreSaleCreateForm({ onSuccess, editingId }: { onSuccess: () => void; editingId?: string }) {
  const { user } = useAuth();
  const { defaultBranchId } = useAutoDetectBranch();
  const { data: branches = [] } = useBranches();

  const [requestingBranchId, setRequestingBranchId] = useState(defaultBranchId || "");
  const [salesChannel, setSalesChannel] = useState("whatsapp");
  const [shippingMethod, setShippingMethod] = useState<string>("pickup");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<SelItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editingId);
  const [wasConfirmed, setWasConfirmed] = useState(false);

  // Cargar datos para edición
  useEffect(() => {
    if (!editingId) return;
    let mounted = true;
    (async () => {
      try {
        const { data: req, error } = await supabase
          .from("branch_requests")
          .select("*")
          .eq("id", editingId)
          .single();
        if (error) throw error;
        if (!mounted) return;
        setRequestingBranchId(req.requesting_branch_id);
        setSalesChannel((req as any).sales_channel ?? "whatsapp");
        setShippingMethod(req.shipping_method);
        setClientName(req.client_name ?? "");
        setClientPhone((req as any).client_phone ?? "");
        setClientEmail((req as any).client_email ?? "");
        setClientAddress(req.client_address ?? "");
        setNotes(req.notes ?? "");
        setWasConfirmed(((req as any).pre_sale_status ?? "draft") === "confirmed");
        const { data: its } = await supabase
          .from("branch_request_items")
          .select("*, product:products(*)")
          .eq("request_id", editingId);
        if (mounted && its) {
          setItems(
            its.map((it: any) => ({
              product: it.product,
              quantity: Number(it.quantity_requested),
            })),
          );
        }
      } catch (e: any) {
        toast.error(`No se pudo cargar: ${e.message}`);
      } finally {
        if (mounted) setLoadingEdit(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [editingId]);

  const requiresAddress = shippingMethod === "delivery" || shippingMethod === "courier";

  const addProduct = (p: ProductResult) => {
    if (items.find((i) => i.product.id === p.id)) {
      toast.info("Producto ya agregado");
      return;
    }
    setItems((prev) => [...prev, { product: p, quantity: 1 }]);
  };

  const canSubmit = useMemo(
    () => !!user && !!requestingBranchId && items.length > 0 && clientName.trim() && clientPhone.trim(),
    [user, requestingBranchId, items, clientName, clientPhone],
  );

  async function handleSubmit() {
    if (!user) return;
    const parsed = clientSchema(requiresAddress).safeParse({
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail,
      client_address: clientAddress,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Datos del cliente inválidos");
      return;
    }
    if (!items.length) {
      toast.error("Agregá al menos un producto");
      return;
    }
    setSubmitting(true);
    try {
      let requestId = editingId;
      let requestNumber: number | undefined;

      if (editingId) {
        const { data: upd, error } = await supabase
          .from("branch_requests")
          .update({
            requesting_branch_id: requestingBranchId,
            source_branch_id: requestingBranchId,
            shipping_method: shippingMethod as any,
            delivery_target: requiresAddress ? ("client" as any) : ("branch" as any),
            client_name: parsed.data.client_name,
            client_phone: parsed.data.client_phone,
            client_email: parsed.data.client_email || null,
            client_address: parsed.data.client_address || null,
            sales_channel: salesChannel,
            notes: notes || null,
            // Regla negocio: cualquier edición invalida la confirmación previa.
            // El cliente debe re-confirmar la nueva versión antes de enviar a operación.
            pre_sale_status: "draft",
            pre_sale_confirmed_at: null,
          } as any)
          .eq("id", editingId)
          .select("request_number")
          .single();
        if (error) throw error;
        requestNumber = upd.request_number;

        // Reemplazar items: borrar actuales + insertar
        const { error: delErr } = await supabase
          .from("branch_request_items")
          .delete()
          .eq("request_id", editingId);
        if (delErr) throw delErr;
      } else {
        const { data: req, error } = await supabase
          .from("branch_requests")
          .insert({
            requesting_branch_id: requestingBranchId,
            source_branch_id: requestingBranchId,
            request_type: "pre_sale_online" as any,
            status: "draft" as any,
            delivery_target: requiresAddress ? ("client" as any) : ("branch" as any),
            shipping_method: shippingMethod as any,
            client_name: parsed.data.client_name,
            client_phone: parsed.data.client_phone,
            client_email: parsed.data.client_email || null,
            client_address: parsed.data.client_address || null,
            sales_channel: salesChannel,
            is_pre_sale: true,
            pre_sale_status: "draft",
            notes: notes || null,
            created_by: user.id,
          })
          .select()
          .single();
        if (error) throw error;
        requestId = req.id;
        requestNumber = req.request_number;
      }

      const itemsPayload = items.map((it) => ({
        request_id: requestId!,
        product_id: it.product.id,
        quantity_requested: it.quantity,
        item_purpose: "client" as any,
        client_name: parsed.data.client_name,
        client_address: parsed.data.client_address || null,
      }));
      const { error: itErr } = await supabase.from("branch_request_items").insert(itemsPayload);
      if (itErr) throw itErr;

      toast.success(editingId ? `Pre-venta #${requestNumber} actualizada` : `Pre-venta #${requestNumber} creada`);
      onSuccess();
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingEdit) {
    return <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning-foreground">
        <strong className="text-warning">Pre Venta Online</strong> — {editingId ? "editando borrador comercial." : "borrador comercial. No reserva stock ni genera operación hasta que la envíes a operación."}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Sucursal vendedora</Label>
          <Select value={requestingBranchId} onValueChange={setRequestingBranchId}>
            <SelectTrigger><SelectValue placeholder="Sucursal" /></SelectTrigger>
            <SelectContent>
              {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Canal de venta</Label>
          <Select value={salesChannel} onValueChange={setSalesChannel}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SALES_CHANNELS.map((c) => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Nombre cliente *</Label><Input value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
        <div><Label>Teléfono *</Label><Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></div>
        <div><Label>Email</Label><Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></div>
        <div>
          <Label>Método de envío</Label>
          <Select value={shippingMethod} onValueChange={setShippingMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SHIPPING_METHODS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {requiresAddress && (
        <div>
          <Label>Dirección de entrega *</Label>
          <Textarea value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} rows={2} />
        </div>
      )}

      <div className="space-y-2">
        <Label>Productos</Label>
        <ProductSearch onSelect={addProduct} />
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">Buscá y agregá al menos un producto.</p>
        ) : (
          <div className="space-y-1.5">
            {items.map((it, idx) => (
              <div key={it.product.id} className="flex items-center gap-2 rounded-md border border-border/50 p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{it.product.name}</div>
                  <div className="text-[11px] text-muted-foreground">{it.product.bims_code || it.product.sku || "—"}</div>
                </div>
                <Input
                  type="number" min={1} className="w-20"
                  value={it.quantity}
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value) || 1);
                    setItems((prev) => prev.map((x, i) => i === idx ? { ...x, quantity: n } : x));
                  }}
                />
                <Button size="icon" variant="ghost" onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label>Notas internas</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      <Button className="w-full" disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
        {editingId ? "Guardar cambios" : "Crear Pre-Venta"}
      </Button>
    </div>
  );
}
