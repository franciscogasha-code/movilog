import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, X, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScannerState = "starting" | "scanning" | "denied" | "unsupported" | "error";

interface BarcodeScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se dispara con el código decodificado (ya con anti-duplicado aplicado). */
  onDetected: (code: string) => void;
  /** Si es true (default), no se cierra al detectar: sigue escaneando. */
  continuous?: boolean;
  /** Texto de estado (ej: "3 agregados") mostrado dentro del overlay. */
  statusText?: string;
  /** Acción alternativa: buscar a mano. */
  onManualSearch?: () => void;
  title?: string;
}

/** Ignoramos el mismo código si se repite dentro de esta ventana. */
const SAME_CODE_MS = 1500;

const RETAIL_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
] as const;

export function BarcodeScanner({
  open,
  onOpenChange,
  onDetected,
  continuous = true,
  statusText,
  onManualSearch,
  title = "Escanear código",
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<{ reset?: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const stoppedRef = useRef(false);
  const [state, setState] = useState<ScannerState>("starting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const handleCode = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      const now = Date.now();
      if (lastCodeRef.current.code === code && now - lastCodeRef.current.at < SAME_CODE_MS) return;
      lastCodeRef.current = { code, at: now };
      try {
        navigator.vibrate?.(60);
      } catch {
        /* noop */
      }
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      onDetected(code);
      if (!continuous) onOpenChange(false);
    },
    [continuous, onDetected, onOpenChange]
  );

  const stopAll = useCallback(() => {
    stoppedRef.current = true;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      readerRef.current?.reset?.();
    } catch {
      /* noop */
    }
    readerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopAll();
      return;
    }

    stoppedRef.current = false;
    setErrorMsg(null);
    setState("starting");

    let cancelled = false;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unsupported");
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError") setState("denied");
        else {
          setState("error");
          setErrorMsg((err as Error)?.message ?? "No se pudo abrir la cámara");
        }
        return;
      }

      if (cancelled || stoppedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      try {
        await video.play();
      } catch {
        /* iOS puede rechazar; el atributo autoplay/playsinline lo cubre */
      }
      if (cancelled || stoppedRef.current) return;
      setState("scanning");

      // 1) Camino nativo (Android Chrome): BarcodeDetector
      const NativeDetector = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
      if (NativeDetector) {
        try {
          const supported: string[] = await NativeDetector.getSupportedFormats();
          const formats = RETAIL_FORMATS.filter((f) => supported.includes(f));
          if (formats.length > 0) {
            const detector = new NativeDetector({ formats });
            const loop = async () => {
              if (cancelled || stoppedRef.current) return;
              try {
                const results = await detector.detect(video);
                if (results?.length) handleCode(String(results[0].rawValue ?? ""));
              } catch {
                /* frame inválido: seguimos */
              }
              if (!cancelled && !stoppedRef.current) rafRef.current = requestAnimationFrame(loop);
            };
            rafRef.current = requestAnimationFrame(loop);
            return;
          }
        } catch {
          /* caemos a ZXing */
        }
      }

      // 2) Fallback cross-platform (iOS Safari incluido): ZXing
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled || stoppedRef.current) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 200 });
        readerRef.current = reader as unknown as { reset?: () => void };
        reader.decodeFromVideoElement(video, (result) => {
          if (cancelled || stoppedRef.current) return;
          if (result) handleCode(result.getText());
        });
      } catch (err) {
        setState("error");
        setErrorMsg((err as Error)?.message ?? "No se pudo iniciar el lector");
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [open, handleCode, stopAll]);

  useEffect(() => () => stopAll(), [stopAll]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-background flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="font-display font-semibold text-sm truncate">{title}</p>
          {statusText && <p className="text-xs text-muted-foreground">{statusText}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
          <X className="h-4 w-4 mr-1.5" />
          Listo
        </Button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black/90">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          autoPlay
          playsInline
        />

        {state === "scanning" && (
          <>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={cn(
                  "w-[80%] max-w-sm aspect-[3/2] rounded-lg border-2 transition-colors",
                  flash ? "border-primary" : "border-primary/60"
                )}
              >
                <div className="h-full w-full flex items-center justify-center">
                  <ScanLine className="h-8 w-8 text-primary/70" />
                </div>
              </div>
            </div>
            <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-muted-foreground px-6">
              Apuntá al código de barras. El escaneo sigue activo hasta que toques "Listo".
            </p>
          </>
        )}

        {state === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Abriendo cámara...</p>
          </div>
        )}

        {(state === "denied" || state === "unsupported" || state === "error") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center bg-background">
            <Camera className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {state === "denied"
                ? "No tenemos permiso para usar la cámara"
                : state === "unsupported"
                  ? "Este dispositivo o navegador no permite usar la cámara"
                  : "No se pudo iniciar la cámara"}
            </p>
            <p className="text-xs text-muted-foreground">
              {state === "denied"
                ? "Habilitá la cámara para este sitio en los ajustes del navegador y volvé a intentar. Mientras tanto podés buscar el producto a mano."
                : (errorMsg ?? "Podés buscar el producto a mano.")}
            </p>
            <div className="flex gap-2 pt-1">
              {onManualSearch && (
                <Button
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onManualSearch();
                  }}
                >
                  Buscar a mano
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
