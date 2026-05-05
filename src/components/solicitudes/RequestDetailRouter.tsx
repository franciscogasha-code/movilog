import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SolicitudDetail } from "./SolicitudDetail";
import { PreSaleDetail } from "./PreSaleDetail";

/**
 * Router de detalle: decide entre SolicitudDetail (operativo) o PreSaleDetail
 * (borrador comercial) según is_pre_sale. Soporta deep-links (?detail=UUID)
 * porque resuelve el flag con una query liviana directa por id.
 *
 * No altera el flujo existente: SolicitudDetail recibe los mismos props que
 * antes; PreSaleDetail solo se monta para registros con is_pre_sale=true.
 */
export function RequestDetailRouter({
  requestId,
  onUpdate,
}: {
  requestId: string;
  onUpdate: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["request-kind", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("id, is_pre_sale")
        .eq("id", requestId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No se pudo cargar el pedido.
      </div>
    );
  }

  return (data as any).is_pre_sale ? (
    <PreSaleDetail requestId={requestId} onUpdate={onUpdate} />
  ) : (
    <SolicitudDetail requestId={requestId} onUpdate={onUpdate} />
  );
}
