import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranches } from "@/hooks/use-branches";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { BranchSelector } from "@/components/shared/BranchSelector";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ExcelImport } from "./ExcelImport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Loader2, Package } from "lucide-react";
import { notify } from "@/lib/notify";

interface EnvioDirectoFormProps {
  onSuccess: () => void;
}

interface LineItem {
  product: ProductResult;
  quantity: number;
}

const MAX_INSTRUCTION_SOURCE = 120;

/**
 * Envío directo origen → destino (push).
 * El operador de sucursal envía mercadería a otra sucursal a partir de una
 * orden externa (verbal, WhatsApp). Origen fijo a su sucursal.
 *
 * Reusa el mismo modelo que AdminReposicionForm (reposition / branch / own_fleet)
 * y avanza el pedido a preparación vía fn_transition_request_status, para no
 * pasar por la fase de abastecimiento y crear el fulfillment por el camino oficial.
 */
export function EnvioDirectoForm({ onSuccess }: EnvioDirectoFormProps) {
  const { user } = useAuth();
  const { data: branches } = useBranches();
  const { allowedBranchIds, isAllBranches, defaultBranchId } = useUserBranchFilter();

  const originOptions = useMemo(() => {
    const list = branches ?? [];
    if (isAllBranches) return list;
    return list.filter((b: any) => allowedBranchIds.includes(b.id));
  }, [branches, isAllBranches, allowedBranchIds]);

  const initialOrigin = useMemo(() => {
    if (defaultBranchId && originOptions.some((b: any) => b.id === defaultBranchId)) return defaultBranchId;
    return originOptions.length === 1 ? (originOptions[0] as any).id : "";
  }, [defaultBranchId, originOptions]);

  const [sourceBranchId, setSourceBranchId] = useState<string>("");
  const effectiveSource = sourceBranchId || initialOrigin;
  const originLocked = Boolean(initialOrigin) && originOptions.length <= 1;

  const [destBranchId, setDestBranchId] = useState("");
  const [instructionSource, setInstructionSource] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("manual");
  const [excelFile, setExcelFile] = useState<File | null>(null);

  const originBranch = useMemo(
    () => (branches ?? []).find((b: any) => b.id === effectiveSource) as any,
    [branches, effectiveSource],
  );

  const addProduct = (product: ProductResult) => {
    const existing = items.find((i) => i.product.id === product.id);
    if (existing) {
      setItems(items.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setItems([...items, { product, quantity: 1 }]);
    }
  };

  const updateQty = (productId: string, qty: number) => {
    if (qty < 1) return;
    setItems(items.map((i) => (i.product.id === productId ? { ...i, quantity: qty } : i)));
  };

  const removeItem = (productId: string) => {
    setItems(items.filter((i) => i.product.id !== productId));
  };

  const handleExcelConfirm = (excelItems: { product: ProductResult; quantity: number }[]) => {
    setItems(excelItems);
    notify.success(`${excelItems.length} productos cargados desde Excel`);
  };

  const totalLines = items.length;
  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const branchesValid = Boolean(effectiveSource && destBranchId && effectiveSource !== destBranchId);
  const instructionValid = instructionSource.trim().length > 0;
  const canSubmit = branchesValid && instructionValid && items.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      const { data: request, error: reqErr } = await supabase
        .from("branch_requests")
        .insert({
          source_branch_id: effectiveSource,
          requesting_branch_id: destBranchId,
          request_type: "reposition" as any,
          delivery_target: "branch" as any,
          shipping_method: "own_fleet" as any,
          instruction_source: instructionSource.trim().slice(0, MAX_INSTRUCTION_SOURCE),
          notes: notes.trim() || null,
          created_by: user.id,
          priority: "normal",
        } as any)
        .select("id, request_number")
        .single();

      if (reqErr) throw reqErr;

      const itemRows = items.map((i) => ({
        request_id: request.id,
        product_id: i.product.id,
        quantity_requested: i.quantity,
        item_purpose: "reposition" as any,
      }));

      const { error: itemErr } = await supabase.from("branch_request_items").insert(itemRows);
      if (itemErr) throw itemErr;

      // Adjunto Excel (opcional, no bloquea el alta)
      if (excelFile) {
        try {
          const filePath = `branch_requests/${request.id}/${excelFile.name}`;
          const { error: uploadErr } = await supabase.storage
            .from("request-attachments")
            .upload(filePath, excelFile);
          if (uploadErr) throw uploadErr;

          await supabase
            .from("branch_requests")
            .update({ attached_file_path: filePath } as any)
            .eq("id", request.id);
        } catch (uploadError: any) {
          console.warn("Error uploading Excel file:", uploadError);
          notify.warning("Envío creado, pero el archivo Excel no pudo adjuntarse");
        }
      }

      // El origen ya tiene el stock: entra directo a preparación (sin abastecimiento).
      // Se usa la RPC oficial para que se cree el fulfillment y se registren eventos.
      const { error: acceptErr } = await supabase.rpc("fn_transition_request_status" as any, {
        p_request_id: request.id,
        p_new_status: "accepted",
        p_reason: "Envío directo originado por la sucursal de origen",
        p_rejection_reason_type: null,
      });

      if (acceptErr) {
        notify.warning(`Envío #${request.request_number} creado en Pendiente`, {
          description: "Avanzá a Preparación desde el detalle del pedido.",
        });
        onSuccess();
        return;
      }

      const { error: prepErr } = await supabase.rpc("fn_transition_request_status" as any, {
        p_request_id: request.id,
        p_new_status: "in_preparation",
        p_reason: "Envío directo: preparación en origen",
        p_rejection_reason_type: null,
      });

      if (prepErr) {
        notify.warning(`Envío #${request.request_number} creado`, {
          description: "Quedó en Aceptado: avanzá a Preparación desde el detalle del pedido.",
        });
        onSuccess();
        return;
      }

      notify.success(`Envío #${request.request_number} creado en preparación`, {
        description: `${totalLines} ${totalLines === 1 ? "producto" : "productos"} · ${totalUnits} ${totalUnits === 1 ? "unidad" : "unidades"}`,
      });
      onSuccess();
    } catch (err: any) {
      console.error("Error creating direct shipment:", err);
      notify.error(err.message || "Error al crear el envío");
    } finally {
      setSubmitting(false);
    }
  };

  if (originOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No tenés una sucursal asignada para originar envíos. Pedí acceso a un administrador.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Bloque 1: datos generales */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Datos generales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {originLocked ? (
            <div className="space-y-2">
              <Label>Sucursal origen</Label>
              <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {originBranch ? `${originBranch.name} (${originBranch.code})` : "Tu sucursal"}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Sucursal origen</Label>
              <select
                value={effectiveSource}
                onChange={(e) => setSourceBranchId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Seleccionar sucursal...</option>
                {originOptions.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <BranchSelector
            value={destBranchId}
            onChange={setDestBranchId}
            label="Sucursal destino"
            excludeIds={effectiveSource ? [effectiveSource] : []}
          />
        </div>

        <div>
          <Label>
            Solicitado por / medio <span className="text-destructive">*</span>
          </Label>
          <Input
            value={instructionSource}
            maxLength={MAX_INSTRUCTION_SOURCE}
            onChange={(e) => setInstructionSource(e.target.value)}
            placeholder="Ej: Verbal - Gerente Caballero / WhatsApp"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Quién pidió el envío y por qué medio. {instructionSource.length}/{MAX_INSTRUCTION_SOURCE}
          </p>
        </div>

        <div>
          <Label>Notas (opcional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observaciones adicionales..."
            rows={2}
            className="mt-1"
          />
        </div>
      </div>

      {/* Bloque 2: productos */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Productos</h3>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="manual">Carga manual</TabsTrigger>
            <TabsTrigger value="excel">Desde Excel</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <ProductSearch onSelect={addProduct} placeholder="Buscar producto para agregar..." excludeIds={[]} />
          </TabsContent>

          <TabsContent value="excel" className="mt-3">
            <ExcelImport onConfirm={handleExcelConfirm} onFileSelected={setExcelFile} />
          </TabsContent>
        </Tabs>
      </div>

      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {totalLines} {totalLines === 1 ? "línea" : "líneas"} · {totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}
            </span>
            {tab === "excel" && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setItems([])}>
                Limpiar todo
              </Button>
            )}
          </div>

          <div className="border border-border rounded-md overflow-x-auto max-h-[280px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left p-2 font-medium text-muted-foreground">Producto</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Código</th>
                  <th className="text-right p-2 font-medium text-muted-foreground w-24">Cantidad</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.product.id} className="border-b border-border/50">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate max-w-[200px]">{item.product.name}</span>
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground font-mono">
                      {item.product.bims_code || item.product.sku || "—"}
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateQty(item.product.id, parseInt(e.target.value) || 1)}
                        className="w-20 text-right ml-auto h-8"
                      />
                    </td>
                    <td className="p-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.product.id)}
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
        {!instructionValid && items.length > 0 && (
          <p className="text-xs text-destructive self-center">Completá "Solicitado por / medio"</p>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!canSubmit} className="w-full sm:w-auto">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear envío ({totalLines} productos)
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar envío a otra sucursal</AlertDialogTitle>
              <AlertDialogDescription>
                Se creará un envío desde {originBranch?.name ?? "tu sucursal"} con {totalLines}{" "}
                {totalLines === 1 ? "producto" : "productos"} ({totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}) y
                quedará en preparación. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Creando..." : "Confirmar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
