const BIMS_IMAGE_HOST = "190.128.128.182";

/** Route BIMS HTTP images through our edge function proxy for HTTPS */
export function proxyImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === BIMS_IMAGE_HOST) {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      return `https://${projectId}.supabase.co/functions/v1/bims-image-proxy?url=${encodeURIComponent(url)}`;
    }
  } catch { /* not a valid URL, return as-is */ }
  return url;
}
