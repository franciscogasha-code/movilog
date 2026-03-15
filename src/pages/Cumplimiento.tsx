import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { FULFILLMENT_STATUS_CONFIG, SHIPPING_METHOD_LABELS } from "@/lib/constants";
import { Truck, Package } from "lucide-react";

export default function Cumplimiento() {
  const { data: orders, isLoading } = useQuery({
    queryKey: ["fulfillment-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          *,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type)
        `)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const activeCount = orders?.filter((o) => !["completed", "cancelled"].includes(o.status)).length || 0;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Ejecución Física</h1>
        <p className="text-muted-foreground mt-1">Detalle de ejecución: picking, despacho, tránsito y recepción vinculados a pedidos</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-primary/10 p-3 rounded-xl"><Truck className="h-5 w-5 text-primary" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">En ejecución</p>
              <p className="text-2xl font-display font-bold">{activeCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="bg-accent/10 p-3 rounded-xl"><Package className="h-5 w-5 text-accent" /></div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Total</p>
              <p className="text-2xl font-display font-bold">{orders?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Ejecuciones vinculadas a pedidos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : !orders?.length ? (
            <div className="p-8 text-center text-muted-foreground">No hay ejecuciones registradas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Pedido</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Origen</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Destino</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Envío</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">BIMS</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o: any) => (
                    <tr key={o.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-mono font-semibold">
                        {o.branch_request ? `#${o.branch_request.request_number}` : "—"}
                      </td>
                      <td className="p-3 font-medium">{o.source_branch?.code || "—"}</td>
                      <td className="p-3">
                        {o.destination_branch?.code || o.destination_client_name || "—"}
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">{SHIPPING_METHOD_LABELS[o.shipping_method] || o.shipping_method}</td>
                      <td className="p-3 text-xs">
                        {o.bims_transfer_number && <span className="text-primary font-medium">T: {o.bims_transfer_number}</span>}
                        {o.bims_transfer_number && o.bims_invoice_number && " / "}
                        {o.bims_invoice_number && <span className="text-primary font-medium">F: {o.bims_invoice_number}</span>}
                        {!o.bims_transfer_number && !o.bims_invoice_number && <span className="text-warning">Sin doc.</span>}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={o.status} config={FULFILLMENT_STATUS_CONFIG} />
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
