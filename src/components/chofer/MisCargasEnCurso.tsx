import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, MapPin, Truck, AlertTriangle, ArrowRight } from "lucide-react";
import { EntregaModal } from "./EntregaModal";
import { TransferirCustodiaModal } from "./TransferirCustodiaModal";
import { FULFILLMENT_STATUS_CONFIG } from "@/lib/constants";

export function MisCargasEnCurso() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [entregaModal, setEntregaModal] = useState<{ id: string; mode: "branch" | "customer" | "failed" | "hub" } | null>(null);
  const [transferModal, setTransferModal] = useState<string | null>(null);

  const { data: myLoads, isLoading } = useQuery({
    queryKey: ["my-custody-loads", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target, client_name, client_address)
        `)
        .eq("current_custody_holder_id", user.id)
        .in("status", ["in_transit", "dispatched", "delivery_failed"] as any[])
        .order("dispatched_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["my-custody-loads"] });
    queryClient.invalidateQueries({ queryKey: ["assigned-loads"] });
    queryClient.invalidateQueries({ queryKey: ["available-loads"] });
    queryClient.invalidateQueries({ queryKey: ["hub-loads"] });
  };

  const getDeliveryTarget = (f: any) => {
    if (f.branch_request?.delivery_target === "client") return "client";
    return "branch";
  };

  const getStatusBadge = (status: string) => {
    const config = FULFILLMENT_STATUS_CONFIG[status];
    if (config) return <Badge className={`text-xs ${config.color}`}>{config.label}</Badge>;
    return <Badge variant="outline" className="text-xs">{status}</Badge>;
  };

  if (isLoading) return <div className="p-4 text-center text-muted-foreground text-sm">Cargando...</div>;

  if (!myLoads?.length) {
    return (
      <Card className="glass-card">
        <CardContent className="p-8 text-center">
          <Package className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-muted-foreground text-sm">No tenés cargas bajo tu custodia</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-semibold text-sm uppercase text-muted-foreground tracking-wider flex items-center gap-2">
        <Truck className="h-4 w-4" /> Bajo mi custodia ({myLoads.length})
      </h3>

      {myLoads.map((f: any) => {
        const target = getDeliveryTarget(f);
        const isFailed = f.status === "delivery_failed";

        return (
          <Card key={f.id} className={`glass-card ${isFailed ? "border-destructive/30" : ""}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm">
                      Pedido #{f.branch_request?.request_number || "—"}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {target === "client"
                        ? f.branch_request?.client_name || f.destination_client_name || "Cliente"
                        : f.destination_branch?.code || "—"}
                    </span>
                    {getStatusBadge(f.status)}
                    {target === "client" && (
                      <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">Cliente</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Desde: {f.source_branch?.code}
                    </span>
                    {f.dispatched_at && (
                      <span>
                        Retirado: {new Date(f.dispatched_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    {isFailed && f.delivery_failed_reason && (
                      <span className="text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {f.delivery_failed_reason}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  {target === "branch" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEntregaModal({ id: f.id, mode: "branch" })}
                    >
                      Entregar en sucursal
                    </Button>
                  )}
                  {target === "client" && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEntregaModal({ id: f.id, mode: "customer" })}
                    >
                      Entregar a cliente
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setEntregaModal({ id: f.id, mode: "hub" })}
                  >
                    Dejar en acopio
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setTransferModal(f.id)}
                  >
                    Transferir
                  </Button>
                  {!isFailed && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-destructive"
                      onClick={() => setEntregaModal({ id: f.id, mode: "failed" })}
                    >
                      Entrega fallida
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Entrega Modal */}
      {entregaModal && (
        <EntregaModal
          fulfillmentId={entregaModal.id}
          mode={entregaModal.mode}
          open={true}
          onClose={() => setEntregaModal(null)}
          onSuccess={() => { setEntregaModal(null); invalidateAll(); }}
        />
      )}

      {/* Transfer Modal */}
      {transferModal && (
        <TransferirCustodiaModal
          fulfillmentId={transferModal}
          open={true}
          onClose={() => setTransferModal(null)}
          onSuccess={() => { setTransferModal(null); invalidateAll(); }}
        />
      )}
    </div>
  );
}
