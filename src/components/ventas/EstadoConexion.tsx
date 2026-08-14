import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function EstadoConexion({
  online,
  pendingCount,
  syncing,
  onClick,
}: {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  onClick?: () => void;
}) {
  const label = !online
    ? "Sin conexión"
    : syncing || pendingCount > 0
      ? `Sincronizando (${pendingCount})`
      : "En línea";

  const Icon = !online ? WifiOff : syncing ? RefreshCw : Wifi;

  return (
    <Badge
      variant="outline"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      className={cn(
        "gap-1.5 font-normal",
        onClick && "cursor-pointer",
        !online && "border-destructive/50 text-destructive",
        online && pendingCount > 0 && "border-amber-500/50 text-amber-600 dark:text-amber-400"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
      {label}
    </Badge>
  );
}
