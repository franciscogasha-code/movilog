import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Determina si un pedido hijo abastece una venta comercial real
 * (preventa convertida, pedido cliente o pedido online).
 *
 * Regla: el hijo ES Reposición (no se cambia request_type), pero su PADRE
 * es la venta comprometida. Por eso la prioridad se HEREDA visualmente.
 *
 * Fuente única de verdad: el `parent_request_id` y los campos del padre.
 */
export function isCommercialBackedChild(parent?: {
  request_type?: string | null;
  is_pre_sale?: boolean | null;
} | null): boolean {
  if (!parent) return false;
  if (parent.is_pre_sale) return true;
  const t = parent.request_type;
  return t === "client" || t === "online" || t === "pre_sale_online";
}

interface Props {
  className?: string;
  /** Versión compacta (solo "AB Preventa", sin ícono) para listas muy densas. */
  compact?: boolean;
}

/**
 * Badge "AB Preventa" — prioridad operativa heredada del pedido padre.
 * Color ámbar (warning) para señalar urgencia comercial sin romper layouts.
 */
export function CommercialBackedBadge({ className, compact = false }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="warning"
          className={cn(
            "shrink-0 gap-1 whitespace-nowrap",
            compact ? "text-[10px] px-1.5 py-0" : "text-[10px]",
            className,
          )}
        >
          {!compact && <ShoppingBag className="h-3 w-3" />}
          AB Preventa
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        Abastecimiento de venta comprometida (preventa / pedido cliente / online).
        Prioridad comercial heredada del pedido padre.
      </TooltipContent>
    </Tooltip>
  );
}
