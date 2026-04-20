import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Warehouse, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { runDriverAction } from "@/lib/driver-actions";

export function CargasEnAcopio() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: hubLoads, isLoading } = useQuery({
    queryKey: ["hub-loads", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      // RLS ya filtra por sucursales accesibles al usuario
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          current_location_branch:branches!fulfillment_orders_current_location_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target)
        `)
        .eq("status", "at_hub" as any)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const pickupFromHub = async (fulfillmentId: string) => {
    try {
      const { data, error } = await runDriverAction({
        action: "pickup_from_hub",
        fulfillmentId,
      });
      if (error) throw error;

      const result = data as any;
      if (result?.success) {
        toast.success("Carga tomada desde acopio");
        queryClient.invalidateQueries({ queryKey: ["hub-loads"] });
        queryClient.invalidateQueries({ queryKey: ["my-custody-loads"] });
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (isLoading) return null;
  if (!hubLoads?.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-sm uppercase text-muted-foreground tracking-wider flex items-center gap-2">
        <Warehouse className="h-4 w-4" /> En acopio ({hubLoads.length})
      </h3>

      {hubLoads.map((f: any) => (
        <Card key={f.id} className="glass-card border-info/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-sm">
                    Pedido #{f.branch_request?.request_number || "—"}
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {f.destination_branch?.code || f.destination_client_name || "—"}
                  </span>
                  <Badge className="text-xs bg-info/10 text-info">
                    En acopio{f.current_location_branch?.code ? ` · ${f.current_location_branch.code}` : ""}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Desde: {f.source_branch?.code}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(f.updated_at), { addSuffix: true, locale: es })}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => pickupFromHub(f.id)}
              >
                Tomar carga
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
