import { Badge } from "@/components/ui/badge";
import { Info, ArrowRight } from "lucide-react";
import { type RequestType, type DeliveryTarget } from "@/lib/business-rules";

export type EffectiveOriginMode = "undefined" | "single" | "multi";

interface ContextBannerProps {
  requestType: RequestType;
  deliveryTarget: DeliveryTarget;
  /**
   * Modo de origen efectivo, calculado dinámicamente desde los items reales.
   * - "undefined": el usuario aún no eligió origen
   * - "single": un único origen real
   * - "multi": el usuario dividió entre 2+ sucursales
   */
  effectiveOriginMode?: EffectiveOriginMode;
}

const TYPE_LABELS: Record<RequestType, string> = {
  reposition: "Reposición",
  client: "Pedido Cliente",
  online: "Pedido Online",
};

const TARGET_LABELS: Record<DeliveryTarget, string> = {
  branch: "Sucursal",
  client: "Cliente",
};

const MODE_LABELS: Record<EffectiveOriginMode, string> = {
  undefined: "Origen por definir",
  single: "Origen único",
  multi: "Multi-origen",
};

export function ContextBanner({ requestType, deliveryTarget, effectiveOriginMode = "undefined" }: ContextBannerProps) {
  const isMulti = effectiveOriginMode === "multi";
  const isSingle = effectiveOriginMode === "single";

  // Tono visual: azul para multi (acción decidida), verde-suave para single (decidido), ámbar para indefinido.
  const tone = isMulti
    ? "bg-blue-500/5 border-blue-500/20 text-blue-900 dark:text-blue-200"
    : isSingle
      ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-900 dark:text-emerald-200"
      : "bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-200";

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm min-w-0 ${tone}`}>
      <Info className="h-4 w-4 shrink-0 opacity-70 mt-0.5" />
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <Badge variant="outline" className="text-xs whitespace-nowrap">{TYPE_LABELS[requestType]}</Badge>
        <ArrowRight className="h-3 w-3 opacity-50 shrink-0" />
        <Badge variant="outline" className="text-xs whitespace-nowrap">{TARGET_LABELS[deliveryTarget]}</Badge>
        <ArrowRight className="h-3 w-3 opacity-50 shrink-0" />
        <Badge variant={isMulti ? "default" : isSingle ? "secondary" : "outline"} className="text-xs whitespace-nowrap">
          {MODE_LABELS[effectiveOriginMode]}
        </Badge>
      </div>
    </div>
  );
}
