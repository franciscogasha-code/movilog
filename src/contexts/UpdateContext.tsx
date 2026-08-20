import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface UpdateContextValue {
  needsUpdate: boolean;
  updateSW: (() => Promise<void>) | null;
  dismiss: () => void;
  registerUpdate: (updateFn: () => Promise<void>) => void;
}

const UpdateContext = createContext<UpdateContextValue>({
  needsUpdate: false,
  updateSW: null,
  dismiss: () => {},
  registerUpdate: () => {},
});

const DISMISS_KEY = "movilog:update-dismissed";

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => Promise<void>) | null>(null);

  const registerUpdate = useCallback((fn: () => Promise<void>) => {
    const dismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    if (!dismissed) {
      setUpdateFn(() => fn);
      setNeedsUpdate(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setNeedsUpdate(false);
  }, []);

  const updateSW = useCallback(async () => {
    if (updateFn) {
      await updateFn();
    }
  }, [updateFn]);

  // Si el usuario descarta el banner, no reaparece en la misma sesión.
  useEffect(() => {
    const handleBeforeUnload = () => {
      // sessionStorage se limpia automáticamente al cerrar la pestaña.
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <UpdateContext.Provider value={{ needsUpdate, updateSW, dismiss, registerUpdate }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  return useContext(UpdateContext);
}
