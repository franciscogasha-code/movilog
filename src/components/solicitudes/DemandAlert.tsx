import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

interface DemandAlertProps {
  productId: string;
  productName: string;
}

export function DemandAlert({ productId, productName }: DemandAlertProps) {
  const { data: openDemand } = useQuery({
    queryKey: ["demand-alert", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select(`
          quantity_requested,
          request:branch_requests!branch_request_items_request_id_fkey(
            id, status, requesting_branch_id, created_at,
            requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name)
          )
        `)
        .eq("product_id", productId)
        .in("request.status" as any, ["pending", "accepted", "in_preparation"]);

      if (error) return null;

      // Filter only open requests
      const openItems = (data || []).filter(
        (item: any) => item.request && ["pending", "accepted", "in_preparation"].includes(item.request.status)
      );

      if (openItems.length === 0) return null;

      const branchSet = new Set<string>();
      let totalQty = 0;
      let latestDate = "";

      openItems.forEach((item: any) => {
        const branchName = item.request?.requesting_branch?.name;
        if (branchName) branchSet.add(branchName);
        totalQty += item.quantity_requested || 0;
        if (item.request?.created_at > latestDate) latestDate = item.request.created_at;
      });

      return {
        count: openItems.length,
        branches: Array.from(branchSet),
        totalQty,
        lastDate: latestDate,
      };
    },
    staleTime: 30_000,
  });

  if (!openDemand) return null;

  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-amber-800 dark:text-amber-300">
          Demanda activa: {openDemand.count} solicitud(es) pendientes
        </p>
        <p className="text-amber-700 dark:text-amber-400 mt-0.5">
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
