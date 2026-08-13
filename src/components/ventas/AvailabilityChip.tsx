import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export const LOW_STOCK_THRESHOLD = 5;

export type AvailabilityLevel = "available" | "low" | "none";

export function availabilityLevel(stock: number): AvailabilityLevel {
  if (!stock || stock <= 0) return "none";
  if (stock <= LOW_STOCK_THRESHOLD) return "low";
  return "available";
}

const LABELS: Record<AvailabilityLevel, string> = {
  available: "Disponible",
  low: "Últimas unidades",
  none: "Sin stock · consultar",
};

const ICONS: Record<AvailabilityLevel, typeof CheckCircle2> = {
  available: CheckCircle2,
  low: AlertTriangle,
  none: XCircle,
};

const STYLES: Record<AvailabilityLevel, string> = {
  available: "border-emerald-600/40 text-emerald-600",
  low: "border-amber-500/50 text-amber-600",
  none: "border-destructive/40 text-destructive",
};

export function AvailabilityChip({
  stock,
  className,
  size = "default",
}: {
  stock: number;
  className?: string;
  size?: "default" | "sm";
}) {
  const level = availabilityLevel(stock);
  const Icon = ICONS[level];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium",
        STYLES[level],
        size === "sm" && "px-1.5 py-0 text-[10px]",
        className
      )}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {LABELS[level]}
    </Badge>
  );
}
