import { useCallback, useMemo, useState } from "react";

export interface SupplyResolutionExternal {
  branchId: string;
  qty: number;
}

export interface SupplyResolutionItemState {
  localQty: number;
  externals: SupplyResolutionExternal[];
}

export type SupplyResolutionState = Record<string, SupplyResolutionItemState>;

export interface SupplyResolutionItemDef {
  id: string;
  product_id: string;
  quantity_requested: number;
}

const empty: SupplyResolutionItemState = { localQty: 0, externals: [] };

export function useSupplyResolution(items: SupplyResolutionItemDef[]) {
  const [state, setState] = useState<SupplyResolutionState>(() =>
    Object.fromEntries(items.map((i) => [i.id, { ...empty }]))
  );

  const setLocal = useCallback((itemId: string, qty: number) => {
    setState((s) => ({ ...s, [itemId]: { ...(s[itemId] ?? empty), localQty: Math.max(0, qty || 0) } }));
  }, []);

  const setExternals = useCallback((itemId: string, externals: SupplyResolutionExternal[]) => {
    setState((s) => ({ ...s, [itemId]: { ...(s[itemId] ?? empty), externals } }));
  }, []);

  const reset = useCallback(() => {
    setState(Object.fromEntries(items.map((i) => [i.id, { ...empty }])));
  }, [items]);

  // Permite abastecimiento parcial controlado: sum <= requested.
  // El faltante (requested - sum) se registra como demanda no satisfecha
  // sin bloquear el flujo operativo. Solo bloquea oversupply o externos malformados.
  const isItemValid = useCallback(
    (itemId: string, requested: number) => {
      const st = state[itemId] ?? empty;
      const sumExt = st.externals.reduce((a, e) => a + (Number.isFinite(e.qty) ? e.qty : 0), 0);
      const total = st.localQty + sumExt;
      if (total > requested) return false;
      return st.externals.every((e) => e.branchId && e.qty > 0);
    },
    [state]
  );

  const isItemFullyCovered = useCallback(
    (itemId: string, requested: number) => {
      const st = state[itemId] ?? empty;
      const sumExt = st.externals.reduce((a, e) => a + (Number.isFinite(e.qty) ? e.qty : 0), 0);
      return st.localQty + sumExt === requested;
    },
    [state]
  );

  const itemSum = useCallback(
    (itemId: string) => {
      const st = state[itemId] ?? empty;
      return st.localQty + st.externals.reduce((a, e) => a + (e.qty || 0), 0);
    },
    [state]
  );

  const allValid = useMemo(
    () => items.every((i) => isItemValid(i.id, i.quantity_requested)),
    [items, isItemValid]
  );

  const buildPayload = useCallback(() => {
    return {
      items: items.map((i) => {
        const st = state[i.id] ?? empty;
        return {
          request_item_id: i.id,
          local_qty: st.localQty,
          externals: st.externals
            .filter((e) => e.branchId && e.qty > 0)
            .map((e) => ({ source_branch_id: e.branchId, qty: e.qty })),
        };
      }),
    };
  }, [items, state]);

  /** Devuelve el id del próximo item incompleto (envuelve la lista). */
  const nextIncompleteId = useCallback(
    (currentId: string | null): string | null => {
      const idx = currentId ? items.findIndex((i) => i.id === currentId) : -1;
      const ordered = idx >= 0 ? [...items.slice(idx + 1), ...items.slice(0, idx)] : items;
      const next = ordered.find((i) => !isItemValid(i.id, i.quantity_requested));
      return next?.id ?? null;
    },
    [items, isItemValid]
  );

  return {
    state,
    setLocal,
    setExternals,
    reset,
    isItemValid,
    isItemFullyCovered,
    itemSum,
    allValid,
    buildPayload,
    nextIncompleteId,
  };
}
