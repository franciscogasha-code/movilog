import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { setUpdateAvailableCallback } from "@/lib/register-app-sw";
import {
  fetchPublishedVersion,
  getRunningVersion,
  hardReloadToLatest,
  isVersionCheckEnabled,
} from "@/lib/version-check";

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
const POLL_MS = 5 * 60 * 1000;

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(value: string) {
  try {
    sessionStorage.setItem(DISMISS_KEY, value);
  } catch {
    // storage no disponible: se avisa igual en la próxima sesión
  }
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => Promise<void>) | null>(null);
  // Versión que disparó el aviso (del service worker o del chequeo propio).
  const pendingVersionRef = useRef<string>("sw");

  const registerUpdate = useCallback((fn: () => Promise<void>) => {
    setUpdateFn(() => fn);
    if (readDismissed() === "sw") return;
    pendingVersionRef.current = "sw";
    setNeedsUpdate(true);
  }, []);

  const dismiss = useCallback(() => {
    writeDismissed(pendingVersionRef.current);
    setNeedsUpdate(false);
  }, []);

  const updateSW = useCallback(async () => {
    if (updateFn) {
      await updateFn();
      return;
    }
    await hardReloadToLatest();
  }, [updateFn]);

  // Vía 1: service worker (vite-plugin-pwa).
  useEffect(() => {
    setUpdateAvailableCallback(registerUpdate);
    return () => setUpdateAvailableCallback(null);
  }, [registerUpdate]);

  // Vía 2: chequeo propio contra /version.json (independiente del service worker).
  useEffect(() => {
    if (!isVersionCheckEnabled()) return;

    let cancelled = false;
    const running = getRunningVersion();

    const check = async () => {
      if (cancelled || document.visibilityState === "hidden" || !navigator.onLine) return;
      const published = await fetchPublishedVersion();
      if (cancelled || !published || published === running) return;
      if (readDismissed() === published) return;
      pendingVersionRef.current = published;
      setNeedsUpdate(true);
    };

    void check();
    const interval = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);

  return (
    <UpdateContext.Provider value={{ needsUpdate, updateSW, dismiss }}>
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  return useContext(UpdateContext);
}
