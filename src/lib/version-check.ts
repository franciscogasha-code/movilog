const VERSION_URL = "/version.json";

export function getRunningVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
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

/** El chequeo solo corre en producción real (no dev, no preview, no iframe). */
export function isVersionCheckEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (!import.meta.env.PROD) return false;
  if (window.self !== window.top) return false;
  if (isPreviewHost(window.location.hostname)) return false;
  return true;
}

/** Devuelve la versión publicada, o null ante cualquier error (nunca rompe la app). */
export async function fetchPublishedVersion(): Promise<string | null> {
  if (!isVersionCheckEnabled()) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { version?: unknown };
    return typeof data?.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Limpia cachés del service worker y recarga con la versión nueva. */
export async function hardReloadToLatest(): Promise<void> {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.allSettled(
        names.filter((name) => name.startsWith("movilog-")).map((name) => caches.delete(name))
      );
    }
  } catch {
    // ignorar: la recarga igual debe ocurrir
  }
  window.location.reload();
}
