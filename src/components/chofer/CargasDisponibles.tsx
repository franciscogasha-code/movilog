import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function CargasDisponibles() {
  const queryClient = useQueryClient();

  const { data: fulfillments, isLoading } = useQuery({
    queryKey: ["all-available-fulfillments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target)
        `)
        .in("status", ["waiting_for_cut", "waiting_for_courier", "picking"])
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const pickupOutOfCutoff = async (fulfillmentId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Validate BIMS
      const { data: validation } = await supabase.rpc("fn_validate_driver_pickup", {
        p_fulfillment_id: fulfillmentId,
      });

      const result = validation as any;
      if (!result?.allowed) {
        toast.error(result?.reason || "No se puede retirar esta carga");
        return;
      }

      const { error } = await supabase
        .from("fulfillment_orders")
        .update({
          status: "dispatched" as any,
          dispatched_at: new Date().toISOString(),
          dispatched_by: user.id,
          current_custody_holder_id: user.id,
        })
        .eq("id", fulfillmentId);

      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "fulfillment_order",
        reference_id: fulfillmentId,
        event_type: "driver_pickup",
        category: "logistics" as any,
        event_description: "Retiro fuera de corte formal",
        new_status: "dispatched",
        new_custody_holder_id: user.id,
        triggered_by: user.id,
        metadata: { out_of_cutoff: true },
      });

      toast.success("Retiro confirmado (fuera de corte)");
      queryClient.invalidateQueries({ queryKey: ["all-available-fulfillments"] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const grouped = fulfillments?.reduce((acc: Record<string, any[]>, f: any) => {
    const key = f.source_branch?.code || "Sin sucursal";
    if (!acc[key]) acc[key] = [];
    acc[key].push(f);
    return acc;
  }, {}) || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-sm">
        <AlertTriangle className="h-4 w-4 text-secondary shrink-0" />
        <span>
          Cargas retiradas desde aquí se registran como <strong>movimiento fuera de corte</strong>.
          Para retiros formales, iniciá un corte o viaje primero.
        </span>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Cargando cargas...</div>
      ) : !fulfillments?.length ? (
        <Card className="glass-card">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No hay cargas pendientes de retiro</p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([branchCode, items]) => (
          <Card key={branchCode} className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <Package className="h-4 w-4 text-muted-foreground" />
                Sucursal {branchCode}
                <Badge variant="secondary" className="text-xs">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {items.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
                        <span className="text-muted-foreground ml-2">→ {f.destination_branch?.code || f.destination_client_name || "—"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!f.bims_transfer_number && !f.bims_invoice_number && (
                        <Badge variant="outline" className="text-xs text-secondary border-secondary/30">
                          Sin doc. BIMS
                        </Badge>
                      )}
                      {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
                      {(f.branch_request?.delivery_target === "client" || f.shipping_method === "courier") && f.package_count > 0 && (
                        <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {f.status === "waiting_for_cut" ? "Esperando corte" : f.status === "waiting_for_courier" ? "Esperando transporte" : f.status}
                      </Badge>
                      <Button size="sm" onClick={() => pickupOutOfCutoff(f.id)} className="h-7 text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Retirar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
