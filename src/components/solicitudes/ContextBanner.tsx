import { Badge } from "@/components/ui/badge";
import { Info, ArrowRight } from "lucide-react";
import { type RequestType, type DeliveryTarget, getOriginMode, getOriginModeLabel } from "@/lib/business-rules";

interface ContextBannerProps {
  requestType: RequestType;
  deliveryTarget: DeliveryTarget;
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

export function ContextBanner({ requestType, deliveryTarget }: ContextBannerProps) {
  const mode = getOriginMode(requestType, deliveryTarget);
  const isMulti = mode === "multi";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${
      isMulti
        ? "bg-blue-500/5 border-blue-500/20 text-blue-900 dark:text-blue-200"
        : "bg-amber-500/5 border-amber-500/20 text-amber-900 dark:text-amber-200"
    }`}>
      <Info className="h-4 w-4 shrink-0 opacity-70" />
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs">{TYPE_LABELS[requestType]}</Badge>
        <ArrowRight className="h-3 w-3 opacity-50" />
        <Badge variant="outline" className="text-xs">{TARGET_LABELS[deliveryTarget]}</Badge>
        <ArrowRight className="h-3 w-3 opacity-50" />
        <Badge variant={isMulti ? "default" : "secondary"} className="text-xs">
          {getOriginModeLabel(mode)}
        </Badge>
      </div>
    </div>
  );
}
