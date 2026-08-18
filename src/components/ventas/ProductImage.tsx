import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";

/**
 * Imagen de catálogo con carga diferida nativa.
 *
 * El navegador decide qué solicitudes priorizar y cancela las que salen del
 * viewport. Evitamos una cola global en JavaScript: al hacer scroll rápido esa
 * cola retenía tarjetas lejanas y dejaba las visibles esperando detrás.
 */
const MAX_RETRIES = 2;

export function ProductImage({
  url,
  alt,
  className = "w-full h-full object-cover",
}: { url: string | null | undefined; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setAttempt(0);
  }, [url]);

  if (!url || failed) {
    return <ImageOff className="h-8 w-8 text-muted-foreground" />;
  }

  const baseSrc = proxyImageUrl(url);
  const src = attempt === 0
    ? baseSrc
    : `${baseSrc}&retry=${attempt}`;

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {!loaded && (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      )}
      <img
        key={src}
        src={src}
        alt={alt}
        className={`${className} ${loaded ? "" : "absolute inset-0 opacity-0"}`}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (attempt < MAX_RETRIES) {
            window.setTimeout(() => setAttempt((current) => current + 1), 500 * (attempt + 1));
          } else {
            setFailed(true);
          }
        }}
      />
    </div>
  );
}
