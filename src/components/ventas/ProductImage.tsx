import { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { proxyImageUrl } from "@/lib/image-utils";

/**
 * Carga de fotos de producto tolerante a fallos.
 * - Limita la concurrencia global (el proxy BIMS se satura al hacer scroll rápido).
 * - Reintenta con espera creciente antes de mostrar "sin foto".
 * - Solo empieza a cargar cuando la tarjeta se acerca al viewport.
 */

const MAX_CONCURRENT = 5;
let active = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => { active++; resolve(); }));
}

function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
}

function loadOnce(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => { img.src = ""; reject(new Error("timeout")); }, timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(); };
    img.onerror = () => { clearTimeout(t); reject(new Error("error")); };
    img.src = src;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ProductImage({
  url,
  alt,
  className = "w-full h-full object-cover",
}: { url: string | null | undefined; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSrc(null);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    const el = holderRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!url || !visible) return;
    let cancelled = false;
    const target = proxyImageUrl(url);

    (async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        await acquire();
        try {
          await loadOnce(target, 12000);
          if (!cancelled) setSrc(target);
          return;
        } catch {
          /* reintento */
        } finally {
          release();
        }
        await sleep(600 * (attempt + 1));
      }
      if (!cancelled) setFailed(true);
    })();

    return () => { cancelled = true; };
  }, [url, visible]);

  if (!url || failed) {
    return <ImageOff className="h-8 w-8 text-muted-foreground" />;
  }

  return (
    <div ref={holderRef} className="w-full h-full flex items-center justify-center">
      {src ? (
        <img src={src} alt={alt} className={className} crossOrigin="anonymous" />
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60" />
      )}
    </div>
  );
}
