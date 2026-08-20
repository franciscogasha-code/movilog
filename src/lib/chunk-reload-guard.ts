/**
 * Guarda anti "chunk viejo": cuando el navegador tiene HTML cacheado y pide un
 * archivo JS que ya no existe en el servidor, la app queda en blanco.
 *
 * Recargamos UNA sola vez, y solo si se cumplen TODAS estas condiciones:
 *  1. No hubo ya una recarga automática en esta sesión para esta versión de build.
 *  2. El navegador está online.
 *  3. El error es de carga de módulo/chunk (no cualquier error de red).
 *  4. Pasaron al menos 10 s desde el arranque de la sesión.
 *
 * Si alguna falla, no se recarga: el error cae al ErrorBoundary.
 */

const STORAGE_KEY = `movilog:chunk-reload:${typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"}`;
const MIN_UPTIME_MS = 10_000;

const startedAt = Date.now();

const CHUNK_ERROR_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "unable to preload css",
  "loading chunk",
  "loading css chunk",
];

export function isChunkLoadError(reason: unknown): boolean {
  const message =
    typeof reason === "string"
      ? reason
      : reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : "";
  const normalized = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function alreadyReloaded(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Si sessionStorage no está disponible no podemos garantizar la guarda:
    // preferimos NO recargar antes que arriesgar un bucle.
    return true;
  }
}

function markReloaded(): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* noop */
  }
}

export function maybeReloadForStaleChunk(reason: unknown): boolean {
  if (!isChunkLoadError(reason)) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (Date.now() - startedAt < MIN_UPTIME_MS) return false;
  if (alreadyReloaded()) return false;

  markReloaded();
  console.warn("[chunk-guard] Versión desactualizada detectada. Recargando una sola vez.");
  window.location.reload();
  return true;
}

export function installChunkReloadGuard(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as unknown as { payload?: unknown }).payload;
    maybeReloadForStaleChunk(payload ?? "failed to fetch dynamically imported module");
  });


  window.addEventListener("unhandledrejection", (event) => {
    maybeReloadForStaleChunk(event.reason);
  });

  window.addEventListener("error", (event) => {
    maybeReloadForStaleChunk(event.error ?? event.message);
  });
}
