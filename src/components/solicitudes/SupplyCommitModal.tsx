import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, PackageCheck, Warehouse, Building2 } from "lucide-react";
import { useBranches } from "@/hooks/use-branches";
import { useMemo } from "react";

interface ProductMap {
  [productId: string]: { name: string; sku?: string | null };
}

interface ItemDef {
  id: string;
  product_id: string;
  quantity_requested: number;
}

interface State {
  [itemId: string]: { localQty: number; externals: { branchId: string; qty: number }[] };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemDef[];
  state: State;
  products: ProductMap;
  requestingBranchName?: string;
  onConfirm: () => void;
  loading: boolean;
}

export function SupplyCommitModal({
  open,
  onOpenChange,
  items,
  state,
  products,
  requestingBranchName,
  onConfirm,
  loading,
}: Props) {
  const { data: branches } = useBranches();

  const { byBranch, locals } = useMemo(() => {
    const byBranch: Record<string, { branchName: string; lines: { name: string; qty: number }[] }> = {};
    const locals: { name: string; qty: number }[] = [];
    for (const it of items) {
      const st = state[it.id];
      if (!st) continue;
      const prod = products[it.product_id];
      const name = prod?.name ?? "Producto";
      if (st.localQty > 0) locals.push({ name, qty: st.localQty });
      for (const ext of st.externals) {
        if (!ext.branchId || ext.qty <= 0) continue;
        const b = branches?.find((x) => x.id === ext.branchId);
        const branchName = b?.name ?? "Sucursal";
        if (!byBranch[ext.branchId]) byBranch[ext.branchId] = { branchName, lines: [] };
        byBranch[ext.branchId].lines.push({ name, qty: ext.qty });
      }
    }
    return { byBranch, locals };
  }, [items, state, products, branches]);

  const branchEntries = Object.entries(byBranch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-amber-600" />
            Confirmar abastecimiento
          </DialogTitle>
          <DialogDescription>
            Revisá lo que se va a generar. Esta acción no se puede revertir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {locals.length > 0 && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2">
                <Warehouse className="h-3.5 w-3.5" />
                Stock local en {requestingBranchName ?? "tu sucursal"}
              </p>
              <ul className="space-y-1 text-sm">
                {locals.map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">{l.name}</span>
                    <span className="tabular-nums font-medium shrink-0">{l.qty}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {branchEntries.length === 0 && locals.length > 0 && (
            <p className="text-xs text-muted-foreground">
              No se crearán pedidos internos. El pedido pasará a <strong>Abastecido</strong> automáticamente.
            </p>
          )}

          {branchEntries.map(([branchId, info]) => (
            <div key={branchId} className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 flex items-center gap-1.5 mb-2">
                <Building2 className="h-3.5 w-3.5" />
                Pedido interno a {info.branchName}
              </p>
              <ul className="space-y-1 text-sm">
                {info.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">{l.name}</span>
                    <span className="tabular-nums font-medium shrink-0">{l.qty}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirmar abastecimiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
