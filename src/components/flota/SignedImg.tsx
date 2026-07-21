import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/signed-url";
import { ImageOff } from "lucide-react";

export function SignedImg({
  path,
  bucket = "vehicle-photos",
  className,
  alt = "",
}: { path?: string | null; bucket?: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUrl(null);
    if (!path) return;
    getSignedUrl(bucket, path).then((u) => {
      if (!cancelled) {
        if (u) setUrl(u);
        else setFailed(true);
      }
    });
    return () => { cancelled = true; };
  }, [path, bucket]);

  if (!path || failed) {
    return (
      <div className={`flex items-center justify-center bg-muted/30 text-muted-foreground ${className ?? ""}`}>
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }
  if (!url) return <div className={`bg-muted/20 animate-pulse ${className ?? ""}`} />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
