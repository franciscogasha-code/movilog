import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "movilog.sales.clientMode";

type SalesPresentationValue = {
  clientMode: boolean;
  setClientMode: (v: boolean) => void;
  toggleClientMode: () => void;
};

const SalesPresentationContext = createContext<SalesPresentationValue>({
  clientMode: false,
  setClientMode: () => {},
  toggleClientMode: () => {},
});

export function SalesPresentationProvider({ children }: { children: React.ReactNode }) {
  const [clientMode, setClientModeState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, clientMode ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [clientMode]);

  const setClientMode = useCallback((v: boolean) => setClientModeState(v), []);
  const toggleClientMode = useCallback(() => setClientModeState((v) => !v), []);

  const value = useMemo(
    () => ({ clientMode, setClientMode, toggleClientMode }),
    [clientMode, setClientMode, toggleClientMode]
  );

  return (
    <SalesPresentationContext.Provider value={value}>{children}</SalesPresentationContext.Provider>
  );
}

export function useSalesPresentation() {
  return useContext(SalesPresentationContext);
}
