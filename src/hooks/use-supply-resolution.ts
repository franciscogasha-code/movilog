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

const cleanQty = (qty: number) => (Number.isFinite(qty) ? Math.max(0, qty) : 0);

const assignedExternalQty = (externals: SupplyResolutionExternal[]) =>
  externals.reduce((sum, external) => {
    const qty = cleanQty(external.qty);
    return external.branchId && qty > 0 ? sum + qty : sum;
  }, 0);

const hasMalformedExternal = (externals: SupplyResolutionExternal[]) =>
  externals.some((external) => cleanQty(external.qty) > 0 && !external.branchId);

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

  // Fuente única de verdad del commit parcial: filas externas vacías son borradores UI
  // y se ignoran igual que buildPayload; solo bloquean cantidades positivas sin sucursal
  // u oversupply. El faltante (requested - sum) continúa como demanda no satisfecha.
  const isItemValid = useCallback(
    (itemId: string, requested: number) => {
      const st = state[itemId] ?? empty;
      const total = cleanQty(st.localQty) + assignedExternalQty(st.externals);
      if (total > requested) return false;
      return !hasMalformedExternal(st.externals);
    },
    [state]
  );

  const isItemFullyCovered = useCallback(
    (itemId: string, requested: number) => {
      const st = state[itemId] ?? empty;
      return cleanQty(st.localQty) + assignedExternalQty(st.externals) === requested;
    },
    [state]
  );

  const itemSum = useCallback(
    (itemId: string) => {
      const st = state[itemId] ?? empty;
      return cleanQty(st.localQty) + assignedExternalQty(st.externals);
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
          local_qty: cleanQty(st.localQty),
          externals: st.externals
            .filter((e) => e.branchId && cleanQty(e.qty) > 0)
            .map((e) => ({ source_branch_id: e.branchId, qty: cleanQty(e.qty) })),
        };
      }),
    };
  }, [items, state]);

  /** Devuelve el id del próximo item incompleto (envuelve la lista). */
  const nextIncompleteId = useCallback(
    (currentId: string | null): string | null => {
      const idx = currentId ? items.findIndex((i) => i.id === currentId) : -1;
      const ordered = idx >= 0 ? [...items.slice(idx + 1), ...items.slice(0, idx)] : items;
      const next = ordered.find(
        (i) => !isItemFullyCovered(i.id, i.quantity_requested) && isItemValid(i.id, i.quantity_requested)
      );
      return next?.id ?? null;
    },
    [items, isItemValid, isItemFullyCovered]
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
