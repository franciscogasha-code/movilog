import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

const APP_SW_PATH = "/sw.js";

type UpdateCallback = (update: () => Promise<void>) => void;

let updateCallback: UpdateCallback | null = null;
let pendingUpdate: (() => Promise<void>) | null = null;

export function setUpdateAvailableCallback(cb: UpdateCallback | null) {
  updateCallback = cb;
  if (cb && pendingUpdate) {
    cb(pendingUpdate);
    pendingUpdate = null;
  }
}

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => {
        const workerUrl =
          registration.active?.scriptURL ??
          registration.waiting?.scriptURL ??
          registration.installing?.scriptURL ??
          "";
        return new URL(workerUrl || APP_SW_PATH, window.location.origin).pathname === APP_SW_PATH;
      })
      .map((registration) => registration.unregister())
  );
}

export async function registerAppServiceWorker(): Promise<void> {
  const disabled =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(window.location.search).get("sw") === "off";

  if (disabled) {
    await unregisterAppWorker();
    return;
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const doUpdate = () => updateSW(true);
      if (updateCallback) {
        updateCallback(doUpdate);
      } else {
        pendingUpdate = doUpdate;
      }

      // Toast secundario; el banner fijo es la notificación principal.
      toast.info("Hay una versión nueva de MoviLog", {
        description: "Actualizá para trabajar con la última versión.",
        duration: Infinity,
        id: "movilog-sw-update",
        action: {
          label: "Actualizar",
          onClick: () => void updateSW(true),
        },
      });
    },
  });
}
