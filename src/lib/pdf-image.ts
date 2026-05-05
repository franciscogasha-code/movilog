/**
 * Helper para incrustar imágenes de productos en PDFs (Pre Venta Online).
 *
 * Reglas:
 *  - maxSize 64px lado mayor (resize en canvas).
 *  - Compresión JPEG calidad 0.6.
 *  - Timeout 3000 ms por imagen.
 *  - Fallback progresivo:
 *      1) reintento con calidad 0.4 y timeout 2000 ms,
 *      2) placeholder gris con código.
 *  - Cache en memoria por sesión (clave = url + tamaño).
 */

const MAX_SIZE = 64;
const PRIMARY_QUALITY = 0.6;
const FALLBACK_QUALITY = 0.4;
const PRIMARY_TIMEOUT_MS = 3000;
const FALLBACK_TIMEOUT_MS = 2000;

const cache = new Map<string, string>();

function placeholderDataUrl(label: string): string {
  if (typeof document === "undefined") {
    // SSR-safe fallback: 1x1 png transparent
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
  const c = document.createElement("canvas");
  c.width = MAX_SIZE;
  c.height = MAX_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, MAX_SIZE, MAX_SIZE);
  ctx.fillStyle = "#6b7280";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = (label || "—").slice(0, 10);
  ctx.fillText(text, MAX_SIZE / 2, MAX_SIZE / 2);
  return c.toDataURL("image/png");
}

function loadAndResize(url: string, quality: number, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (typeof Image === "undefined") return reject(new Error("no-dom"));
    const img = new Image();
    img.crossOrigin = "anonymous";

    const t = setTimeout(() => {
      img.src = ""; // abort
      reject(new Error("timeout"));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(t);
      try {
        const ratio = Math.min(MAX_SIZE / img.width, MAX_SIZE / img.height, 1);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("load-error"));
    };
    img.src = url;
  });
}

/**
 * Devuelve un dataURL listo para `doc.addImage`. Nunca lanza.
 */
export async function fetchProductImageForPdf(
  url: string | null | undefined,
  fallbackLabel: string,
): Promise<string> {
  if (!url) return placeholderDataUrl(fallbackLabel);
  const cacheKey = `${url}@${MAX_SIZE}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  try {
    const data = await loadAndResize(url, PRIMARY_QUALITY, PRIMARY_TIMEOUT_MS);
    cache.set(cacheKey, data);
    return data;
  } catch {
    try {
      const data = await loadAndResize(url, FALLBACK_QUALITY, FALLBACK_TIMEOUT_MS);
      cache.set(cacheKey, data);
      return data;
    } catch {
      const ph = placeholderDataUrl(fallbackLabel);
      cache.set(cacheKey, ph);
      return ph;
    }
  }
}

/**
 * Resuelve en paralelo varias imágenes para un PDF. Imágenes lentas no
 * bloquean al resto (Promise.allSettled internamente).
 */
export async function fetchProductImagesForPdf(
  items: { url: string | null | undefined; label: string }[],
): Promise<string[]> {
  const results = await Promise.allSettled(
    items.map((it) => fetchProductImageForPdf(it.url, it.label)),
  );
  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : placeholderDataUrl(items[i].label),
  );
}
