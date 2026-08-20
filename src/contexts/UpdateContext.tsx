import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { setUpdateAvailableCallback } from "@/lib/register-app-sw";

interface UpdateContextValue {
  needsUpdate: boolean;
  updateSW: (() => Promise<void>) | null;
  dismiss: () => void;
}

const UpdateContext = createContext<UpdateContextValue>({
  needsUpdate: false,
  updateSW: null,
  dismiss: () => {},
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

  // Registrar el callback para que el service worker pueda notificar al contexto.
  useEffect(() => {
    setUpdateAvailableCallback(registerUpdate);
    return () => setUpdateAvailableCallback(null);
  }, [registerUpdate]);

  return (
    <UpdateContext.Provider value={{ needsUpdate, updateSW, dismiss }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  return useContext(UpdateContext);
}
