import { useUpdate } from "@/contexts/UpdateContext";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";

export function UpdateBanner() {
  const { needsUpdate, updateSW, dismiss } = useUpdate();

  if (!needsUpdate) return null;

  return (
    <div className="sticky top-0 z-50 w-full bg-primary text-primary-foreground px-3 sm:px-4 py-2 shadow-sm">
      <div className="flex items-center justify-between gap-3 max-w-full">
        <div className="flex items-center gap-2 min-w-0">
          <RefreshCw className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium truncate">
            Hay una versión nueva de MoviLog
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={dismiss}
            className="h-7 text-xs px-2"
          >
            Más tarde
          </Button>
          <Button
            size="sm"
            onClick={() => void updateSW?.()}
            className="h-7 text-xs px-2"
          >
            Actualizar
          </Button>
          <button
            onClick={dismiss}
            aria-label="Cerrar aviso"
            className="ml-1 p-1 rounded hover:bg-primary-foreground/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
