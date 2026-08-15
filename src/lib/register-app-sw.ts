import { registerSW } from "virtual:pwa-register";

const APP_SW_PATH = "/sw.js";

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

  registerSW({ immediate: true });
}