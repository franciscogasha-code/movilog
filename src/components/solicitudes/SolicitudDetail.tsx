import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, ITEM_PURPOSE_LABELS, REJECTION_REASONS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import { Clock, Package, MapPin, User, ArrowRight } from "lucide-react";

export function SolicitudDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
  const { data: request, isLoading } = useQuery({
    queryKey: ["branch-request-detail", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          *,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code)
        `)
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["branch-request-items", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select(`*, product:products(name, sku, bims_code)`)
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: events } = useQuery({
    queryKey: ["request-events", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("reference_id", requestId)
        .eq("reference_type", "branch_request")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  if (!request) return <div className="p-4 text-muted-foreground">No encontrada</div>;

  const r = request as any;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-display text-xl font-bold">Solicitud #{r.request_number}</h3>
            <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(r.created_at).toLocaleString("es-PY")}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {r.request_type === "client" ? "Pedido Cliente" : r.request_type === "reposition" ? "Reposición" : "Mixto"}
        </Badge>
      </div>

      {/* Route info */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Origen</p>
            <p className="font-semibold">{r.source_branch?.code} — {r.source_branch?.name}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Destino</p>
            <p className="font-semibold">{r.requesting_branch?.code} — {r.requesting_branch?.name}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Envío:</span>{" "}
          <span className="font-medium">{SHIPPING_METHOD_LABELS[r.shipping_method]}</span>
        </div>
        {r.client_name && (
          <div>
            <span className="text-muted-foreground">Cliente:</span>{" "}
            <span className="font-medium">{r.client_name}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Cierre logístico:</span>{" "}
          <span className="font-medium">{r.logistic_closed_at ? "✓" : "Pendiente"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Cierre admin:</span>{" "}
          <span className="font-medium">{r.admin_closed_at ? "✓" : r.request_type === "reposition" ? "N/A" : "Pendiente"}</span>
        </div>
      </div>

      {/* Items */}
      <div>
        <h4 className="font-display font-semibold mb-3">Ítems ({items?.length || 0})</h4>
        <div className="space-y-2">
          {items?.map((item: any) => (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
              <Package className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{item.product?.name}</p>
                <p className="text-xs text-muted-foreground">{item.product?.sku || item.product?.bims_code}</p>
              </div>
              <Badge variant="outline" className="text-xs">
                {ITEM_PURPOSE_LABELS[item.item_purpose] || item.item_purpose}
              </Badge>
              <div className="text-right min-w-[120px]">
                <span className="font-mono font-semibold">{item.quantity_requested}</span>
                {item.quantity_accepted != null && item.quantity_accepted > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">/ {item.quantity_accepted} aceptados</span>
                )}
              </div>
              {item.rejection_reason_type && (
                <Badge variant="destructive" className="text-xs">
                  {REJECTION_REASONS[item.rejection_reason_type] || item.rejection_reason_type}
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h4 className="font-display font-semibold mb-3">Timeline de eventos</h4>
        {!events?.length ? (
          <p className="text-sm text-muted-foreground">Sin eventos registrados</p>
        ) : (
          <div className="space-y-0">
            {events.map((ev, idx) => (
              <div key={ev.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                  {idx < events.length - 1 && <div className="w-px flex-1 bg-border" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium">{ev.event_description || ev.event_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString("es-PY")}
                    {ev.new_status && <span className="ml-2">→ {ev.new_status}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {r.notes && (
        <div>
          <h4 className="font-display font-semibold mb-1">Notas</h4>
          <p className="text-sm text-muted-foreground">{r.notes}</p>
        </div>
      )}
    </div>
  );
}
