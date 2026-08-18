const BIMS_IMAGE_HOST = "190.128.128.182";
// Cambiar esta versión cuando cambie la estrategia CORS/cache de las imágenes.
// Evita que un service worker instalado reutilice respuestas opacas antiguas.
const BIMS_IMAGE_CACHE_VERSION = "3";

/** Route BIMS HTTP images through our edge function proxy for HTTPS. */
export function proxyImageUrl(
  url: string,
  freshRequestId?: string,
  purpose: "catalog" | "pdf" = "catalog",
): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === BIMS_IMAGE_HOST) {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const fresh = freshRequestId ? `&fresh=${encodeURIComponent(freshRequestId)}` : "";
      const mode = purpose === "pdf" ? "&mode=pdf" : "";
      return `https://${projectId}.supabase.co/functions/v1/bims-image-proxy?v=${BIMS_IMAGE_CACHE_VERSION}${mode}${fresh}&url=${encodeURIComponent(url)}`;
    }
  } catch { /* not a valid URL, return as-is */ }
  return url;
}
