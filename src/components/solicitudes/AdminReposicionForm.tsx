import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BranchSelector } from "@/components/shared/BranchSelector";
import { ProductSearch, type ProductResult } from "@/components/shared/ProductSearch";
import { ExcelImport } from "./ExcelImport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

interface AdminReposicionFormProps {
  onSuccess: () => void;
}

interface LineItem {
  product: ProductResult;
  quantity: number;
}

export function AdminReposicionForm({ onSuccess }: AdminReposicionFormProps) {
  const { user } = useAuth();
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destBranchId, setDestBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState("manual");
  const [excelFile, setExcelFile] = useState<File | null>(null);

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
    toast.success(`${excelItems.length} productos cargados desde Excel`);
  };

  const totalLines = items.length;
  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const branchesValid = sourceBranchId && destBranchId && sourceBranchId !== destBranchId;
  const canSubmit = branchesValid && items.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      const fullNotes = `[Reposición administrativa] ${notes}`.trim();

      const { data: request, error: reqErr } = await supabase
        .from("branch_requests")
        .insert({
          source_branch_id: sourceBranchId,
          requesting_branch_id: destBranchId,
          request_type: "reposition" as any,
          delivery_target: "branch" as any,
          shipping_method: "own_fleet" as any,
          notes: fullNotes,
          created_by: user.id,
          priority: "normal",
        })
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

      // Upload Excel file if available
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
          toast.warning("Pedido creado, pero el archivo Excel no pudo adjuntarse");
        }
      }

      toast.success(`Pedido #${request.request_number} creado con ${items.length} productos`);
      onSuccess();
    } catch (err: any) {
      console.error("Error creating admin reposition:", err);
      toast.error(err.message || "Error al crear el pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Block 1: General data */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Datos generales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <BranchSelector
            value={sourceBranchId}
            onChange={setSourceBranchId}
            label="Sucursal origen"
            excludeIds={destBranchId ? [destBranchId] : []}
          />
          <BranchSelector
            value={destBranchId}
            onChange={setDestBranchId}
            label="Sucursal destino"
            excludeIds={sourceBranchId ? [sourceBranchId] : []}
          />
        </div>
        {sourceBranchId && destBranchId && sourceBranchId === destBranchId && (
          <p className="text-xs text-destructive">Origen y destino no pueden ser la misma sucursal</p>
        )}
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

      {/* Block 2: Load method */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Productos</h3>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="manual">Carga manual</TabsTrigger>
            <TabsTrigger value="excel">Desde Excel</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <ProductSearch
              onSelect={addProduct}
              placeholder="Buscar producto para agregar..."
              excludeIds={[]}
            />
          </TabsContent>

          <TabsContent value="excel" className="mt-3">
            <ExcelImport onConfirm={handleExcelConfirm} onFileSelected={setExcelFile} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Items table */}
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
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(item.product.id)} className="h-8 w-8 p-0">
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

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!canSubmit}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Crear reposición ({totalLines} productos)
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar reposición administrativa</AlertDialogTitle>
              <AlertDialogDescription>
                Se creará un pedido de reposición con {totalLines} {totalLines === 1 ? "producto" : "productos"} ({totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}).
                Esta acción no se puede deshacer.
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
