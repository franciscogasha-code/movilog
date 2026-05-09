import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Determina si un pedido hijo proviene REALMENTE de una preventa convertida.
 *
 * Fuente ÚNICA de verdad (estructural, no heurística):
 *   - parent.created_from_presale_id IS NOT NULL  → preventa convertida real
 *   - parent.is_pre_sale = true                   → todavía es preventa (defensivo)
 *
 * NO se considera preventa por:
 *   - request_type = 'online'  (pedido online normal)
 *   - request_type = 'client'  (pedido cliente normal)
 *   - flow_type / labels / heurísticas
 *
 * Esto evita falsos positivos como #611 (hijo de #609 online normal).
 */
export function isCommercialBackedChild(parent?: {
  is_pre_sale?: boolean | null;
  created_from_presale_id?: string | null;
} | null): boolean {
  if (!parent) return false;
  if (parent.is_pre_sale === true) return true;
  return !!parent.created_from_presale_id;
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
