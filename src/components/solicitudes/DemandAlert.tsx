import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Info } from "lucide-react";
import { getDemandSeverity, DEMAND_SEVERITY_LABELS, type DemandSeverity } from "@/lib/business-rules";

interface DemandAlertProps {
  productId: string;
}

const SEVERITY_STYLES: Record<DemandSeverity, { bg: string; border: string; icon: string }> = {
  low: { bg: "bg-blue-500/10", border: "border-blue-500/20", icon: "text-blue-600" },
  medium: { bg: "bg-amber-500/10", border: "border-amber-500/20", icon: "text-amber-600" },
  high: { bg: "bg-destructive/10", border: "border-destructive/20", icon: "text-destructive" },
};

export function DemandAlert({ productId }: DemandAlertProps) {
  const { data: openDemand } = useQuery({
    queryKey: ["demand-alert", productId],
    queryFn: async () => {
      const { data: items } = await supabase
        .from("branch_request_items")
        .select("quantity_requested, request_id")
        .eq("product_id", productId);

      if (!items || items.length === 0) return null;

      const requestIds = items.map(i => i.request_id);
      const { data: requests } = await supabase
        .from("branch_requests")
        .select("id, status, requesting_branch_id, created_at")
        .in("id", requestIds)
        .in("status", ["pending", "accepted", "picking", "dispatched"]);

      if (!requests || requests.length === 0) return null;

      const openReqIds = new Set(requests.map(r => r.id));
      const openItems = items.filter(i => openReqIds.has(i.request_id));
      if (openItems.length === 0) return null;

      const branchIds = [...new Set(requests.map(r => r.requesting_branch_id))];
      const { data: branches } = await supabase
        .from("branches")
        .select("id, name")
        .in("id", branchIds);

      const branchNames = (branches || []).map(b => b.name);
      const totalQty = openItems.reduce((sum, i) => sum + (i.quantity_requested || 0), 0);
      const latestDate = requests.reduce((max, r) => r.created_at > max ? r.created_at : max, "");

      return {
        count: openItems.length,
        branches: branchNames,
        totalQty,
        lastDate: latestDate,
      };
    },
    staleTime: 30_000,
  });

  if (!openDemand) return null;

  // Use centralized algorithm from business-rules
  const severity = getDemandSeverity(openDemand.count);
  const styles = SEVERITY_STYLES[severity];
  const IconComp = severity === "low" ? Info : AlertTriangle;

  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg ${styles.bg} ${styles.border} border text-xs`}>
      <IconComp className={`h-3.5 w-3.5 ${styles.icon} shrink-0 mt-0.5`} />
      <div>
        <p className="font-medium text-foreground">
          {DEMAND_SEVERITY_LABELS[severity]}: {openDemand.count} solicitud(es) pendientes
        </p>
        <p className="text-muted-foreground mt-0.5">
          Sucursales: {openDemand.branches.join(", ")} • Total solicitado: {openDemand.totalQty} un.
          {openDemand.lastDate && (
            <span className="ml-1">
              • Última: {new Date(openDemand.lastDate).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
