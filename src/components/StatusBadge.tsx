import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  config: Record<string, { label: string; color?: string; variant?: string }>;
  className?: string;
}

export function StatusBadge({ status, config, className }: StatusBadgeProps) {
  const cfg = config[status] || { label: status, color: "bg-muted text-muted-foreground" };
  
  if (cfg.color) {
    return (
      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cfg.color, className)}>
        {cfg.label}
      </span>
    );
  }

  return (
    <Badge variant={(cfg as any).variant || "default"} className={className}>
      {cfg.label}
    </Badge>
  );
}
