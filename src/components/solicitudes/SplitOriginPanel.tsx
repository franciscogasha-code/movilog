import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useBranches } from "@/hooks/use-branches";

export interface OriginSplit {
  branchId: string;
  quantity: number;
}

interface SplitOriginPanelProps {
  totalQuantity: number;
  splits: OriginSplit[];
  onChange: (splits: OriginSplit[]) => void;
  /** Stock disponible por código de sucursal (BIMS o local). */
  stockByWarehouseCode?: Record<string, number> | null;
  /** Sucursal solicitante: no puede ser origen. */
  requestingBranchId?: string;
  onClose: () => void;
}

export function SplitOriginPanel({
  totalQuantity,
  splits,
  onChange,
  stockByWarehouseCode,
  requestingBranchId,
  onClose,
}: SplitOriginPanelProps) {
  const { data: branches } = useBranches();

  const assigned = useMemo(
    () => splits.reduce((s, x) => s + (Number.isFinite(x.quantity) ? x.quantity : 0), 0),
    [splits],
  );
  const remaining = totalQuantity - assigned;
  const isComplete = remaining === 0 && splits.length > 0;

  // Sucursales seleccionables: con stock > 0 (si conocemos stock) y distintas de la solicitante.
  const candidateBranches = useMemo(() => {
    if (!branches) return [];
    return branches
      .filter((b) => b.is_active !== false)
      .filter((b) => b.id !== requestingBranchId)
      .map((b) => {
        const stock = stockByWarehouseCode?.[b.code] ?? 0;
        return { ...b, stock };
      });
  }, [branches, requestingBranchId, stockByWarehouseCode]);

  const usedBranchIds = new Set(splits.map((s) => s.branchId).filter(Boolean));
  const availableForAdd = candidateBranches.filter((b) => !usedBranchIds.has(b.id));

  const updateSplit = (index: number, patch: Partial<OriginSplit>) => {
    const next = splits.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const removeSplit = (index: number) => {
    onChange(splits.filter((_, i) => i !== index));
  };

  const addSplit = () => {
    onChange([...splits, { branchId: "", quantity: 0 }]);
  };

  // Auto-ajustar cantidad para que no exceda stock ni el total.
  const clampQty = (raw: number, branchId: string, currentIdx: number) => {
    const stock = stockByWarehouseCode?.[branches?.find((b) => b.id === branchId)?.code ?? ""] ?? Infinity;
    const otherAssigned = splits.reduce(
      (s, x, i) => (i === currentIdx ? s : s + (Number.isFinite(x.quantity) ? x.quantity : 0)),
      0,
    );
    const maxByTotal = Math.max(0, totalQuantity - otherAssigned);
    return Math.max(0, Math.min(raw, stock, maxByTotal));
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/20">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          Distribuir <span className="tabular-nums">{totalQuantity}</span> unidades entre sucursales
        </p>
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
          Cerrar
        </Button>
      </div>

      <div className="space-y-2">
        {splits.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            Aún no hay sucursales asignadas. Tocá "Agregar sucursal" para empezar.
          </p>
        )}

        {splits.map((split, idx) => {
          const branch = branches?.find((b) => b.id === split.branchId);
          const stock = branch ? stockByWarehouseCode?.[branch.code] ?? 0 : 0;
          const overStock = !!branch && split.quantity > stock;

          return (
            <div key={idx} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
              <select
                value={split.branchId}
                onChange={(e) => updateSplit(idx, { branchId: e.target.value, quantity: 0 })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Elegir sucursal...</option>
                {candidateBranches
                  .filter((b) => b.id === split.branchId || !usedBranchIds.has(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {stockByWarehouseCode ? `· ${Math.floor(b.stock)} disp.` : ""}
                    </option>
                  ))}
              </select>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={split.quantity || ""}
                onChange={(e) => {
                  const raw = parseInt(e.target.value) || 0;
                  updateSplit(idx, { quantity: clampQty(raw, split.branchId, idx) });
                }}
                placeholder="0"
                className={`w-20 h-9 text-sm tabular-nums ${overStock ? "border-destructive" : ""}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeSplit(idx)}
                className="h-9 px-2"
                aria-label="Quitar sucursal"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          );
        })}

        {availableForAdd.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSplit}
            className="h-8 text-xs w-full sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Agregar sucursal
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        {isComplete ? (
          <Badge variant="secondary" className="text-xs gap-1">
            <CheckCircle2 className="h-3 w-3" /> Completo {assigned} / {totalQuantity}
          </Badge>
        ) : remaining > 0 ? (
          <Badge variant="outline" className="text-xs gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Faltan asignar {remaining}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs gap-1 border-destructive/40 text-destructive">
            <AlertTriangle className="h-3 w-3" /> Excede en {Math.abs(remaining)}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground tabular-nums">
          {assigned} / {totalQuantity}
        </span>
      </div>
    </div>
  );
}
