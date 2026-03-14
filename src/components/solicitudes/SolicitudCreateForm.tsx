import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBranches, useProducts } from "@/hooks/use-branches";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface FormValues {
  requesting_branch_id: string;
  source_branch_id: string;
  request_type: string;
  shipping_method: string;
  client_name?: string;
  client_address?: string;
  notes?: string;
  items: {
    product_id: string;
    quantity_requested: number;
    item_purpose: string;
    client_name?: string;
    client_address?: string;
  }[];
}

export function SolicitudCreateForm({ onSuccess }: { onSuccess: () => void }) {
  const { data: branches } = useBranches();
  const { data: products } = useProducts();
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      request_type: "reposition",
      shipping_method: "own_fleet",
      items: [{ product_id: "", quantity_requested: 1, item_purpose: "reposition" }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const requestType = watch("request_type");

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Debés iniciar sesión"); return; }

      const { data: request, error } = await supabase
        .from("branch_requests")
        .insert({
          requesting_branch_id: values.requesting_branch_id,
          source_branch_id: values.source_branch_id,
          request_type: values.request_type as any,
          shipping_method: values.shipping_method as any,
          client_name: values.client_name || null,
          client_address: values.client_address || null,
          notes: values.notes || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      const itemsToInsert = values.items.map((item) => ({
        request_id: request.id,
        product_id: item.product_id,
        quantity_requested: item.quantity_requested,
        item_purpose: item.item_purpose as any,
        client_name: item.item_purpose === "client" ? (item.client_name || values.client_name || null) : null,
        client_address: item.item_purpose === "client" ? (item.client_address || values.client_address || null) : null,
      }));

      const { error: itemsError } = await supabase.from("branch_request_items").insert(itemsToInsert);
      if (itemsError) throw itemsError;

      toast.success(`Solicitud #${request.request_number} creada`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "Error al crear solicitud");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Sucursal solicitante</Label>
          <select {...register("requesting_branch_id", { required: true })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Seleccionar...</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Sucursal origen</Label>
          <select {...register("source_branch_id", { required: true })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">Seleccionar...</option>
            {branches?.map((b) => <option key={b.id} value={b.id}>{b.code} - {b.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tipo de solicitud</Label>
          <select {...register("request_type")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="reposition">Reposición</option>
            <option value="client">Pedido Cliente</option>
            <option value="mixed">Mixto</option>
            <option value="online">Pedido Online</option>
            <option value="redistribution">Redistribución</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>Método de envío</Label>
          <select {...register("shipping_method")} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="own_fleet">Flota propia</option>
            <option value="courier">Encomienda</option>
            <option value="cut">Corte</option>
            <option value="pickup">Retiro en sucursal</option>
          </select>
        </div>
      </div>

      {(requestType === "client" || requestType === "mixed") && (
        <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-muted/50 border border-border/50">
          <div className="space-y-2">
            <Label>Cliente (nombre)</Label>
            <Input {...register("client_name")} placeholder="Nombre del cliente" />
          </div>
          <div className="space-y-2">
            <Label>Dirección de entrega</Label>
            <Input {...register("client_address")} placeholder="Dirección" />
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Ítems</Label>
          <Button type="button" variant="outline" size="sm" onClick={() => append({ product_id: "", quantity_requested: 1, item_purpose: requestType === "client" ? "client" : "reposition" })}>
            <Plus className="h-4 w-4 mr-1" /> Agregar ítem
          </Button>
        </div>
        {fields.map((field, idx) => (
          <div key={field.id} className="grid grid-cols-12 gap-2 items-end p-3 rounded-lg bg-muted/30 border border-border/30">
            <div className="col-span-4 space-y-1">
              <Label className="text-xs">Producto</Label>
              <select {...register(`items.${idx}.product_id`, { required: true })} className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm">
                <option value="">Seleccionar...</option>
                {products?.map((p) => <option key={p.id} value={p.id}>{p.sku || p.bims_code} - {p.name}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Cantidad</Label>
              <Input type="number" min={1} {...register(`items.${idx}.quantity_requested`, { required: true, valueAsNumber: true })} className="h-9" />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-xs">Propósito</Label>
              <select {...register(`items.${idx}.item_purpose`)} className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm">
                <option value="reposition">Reposición</option>
                <option value="client">Cliente</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              {watch(`items.${idx}.item_purpose`) === "client" && (
                <>
                  <Label className="text-xs">Cliente</Label>
                  <Input {...register(`items.${idx}.client_name`)} placeholder="Nombre" className="h-9" />
                </>
              )}
            </div>
            <div className="col-span-1">
              {fields.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea {...register("notes")} placeholder="Observaciones adicionales..." rows={2} />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Creando..." : "Crear Solicitud"}
      </Button>
    </form>
  );
}
