import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG, REQUEST_TYPE_LABELS, DELIVERY_TARGET_LABELS, SHIPPING_METHOD_LABELS } from "@/lib/constants";
import { Layers, Info, ExternalLink } from "lucide-react";

/**
 * Vista resumen del Pedido Padre (contenedor de trazabilidad multi-origen).
 *
 * El pedido padre NO ejecuta acciones operativas. Su estado se deriva
 * automáticamente del avance de los pedidos hijos vía trigger DB
 * `tr_sync_parent_status`. Esta vista expone únicamente:
 *  - resumen de la solicitud original
 *  - listado de hijos con su estado y origen real
 *  - acceso rápido al detalle de cada hijo
 */
export function ParentRequestSummary({
  parent,
  onOpenChild,
}: {
  parent: any;
  onOpenChild: (childId: string) => void;
}) {
  const { data: children = [], isLoading } = useQuery({
    queryKey: ["parent-children", parent.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          id, request_number, status, source_branch_id, requesting_branch_id,
          created_at, updated_at,
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code),
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)
        `)
        .eq("parent_request_id", parent.id)
        .order("request_number", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const totalChildren = children.length;
  const closedChildren = children.filter((c: any) => c.status === "closed" || c.status === "rejected").length;
  const inProgressChildren = children.filter((c: any) => c.status !== "pending" && c.status !== "closed" && c.status !== "rejected").length;
  const cleanNotes = (parent.notes || "")
    .replace(/\[Pedido padre multi-origen\]\s*/gi, "")
    .replace(/\[LEGACY[^\]]*\]/gi, "")
    .replace(/Cerrado automáticamente por saneamiento\./gi, "")
    .trim();

  return (
    <div className="space-y-4">
      {/* Banner contextual */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 border border-accent/30">
        <Layers className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">Pedido agrupado #{parent.request_number}</span>
            <Badge variant="outline" className="text-[10px] border-accent text-accent">Multi-origen</Badge>
            <StatusBadge status={parent.status} config={REQUEST_STATUS_CONFIG} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Este es un contenedor de trazabilidad. Las acciones operativas se ejecutan sobre cada pedido hijo.
            Su estado se actualiza automáticamente según el avance de los hijos.
          </p>
        </div>
      </div>

      {/* Resumen original */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" /> Solicitud original
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Solicitante</div>
              <div className="font-medium">{parent.requesting_branch?.name || "—"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Tipo</div>
              <div className="font-medium capitalize">{REQUEST_TYPE_LABELS[parent.request_type] || parent.request_type}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Destino</div>
              <div className="font-medium">{DELIVERY_TARGET_LABELS[parent.delivery_target] || parent.delivery_target}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Envío</div>
              <div className="font-medium">{SHIPPING_METHOD_LABELS[parent.shipping_method] || parent.shipping_method}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Creado</div>
              <div className="font-medium">{new Date(parent.created_at).toLocaleDateString("es-PY")}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Avance</div>
              <div className="font-medium">{closedChildren}/{totalChildren} cerrados · {inProgressChildren} en curso</div>
            </div>
          </div>
          {cleanNotes && (
            <div className="text-xs pt-2 border-t border-border/50">
              <span className="text-muted-foreground">Observaciones: </span>
              <span>{cleanNotes}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Listado de hijos */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-semibold">
            Pedidos hijos ({totalChildren})
          </h3>

          {isLoading ? (
            <div className="text-xs text-muted-foreground">Cargando hijos...</div>
          ) : totalChildren === 0 ? (
            <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded">
              Este pedido padre no tiene hijos vinculados (registro legacy).
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {children.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono font-semibold text-sm">#{c.request_number}</span>
                      <Badge variant="outline" className="text-[10px]">Hijo</Badge>
                      <StatusBadge status={c.status} config={REQUEST_STATUS_CONFIG} />
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      <span>De: </span>
                      <span className="text-foreground/80 font-medium">{c.source_branch?.name || "—"}</span>
                      <span className="mx-1">→</span>
                      <span>Para: </span>
                      <span className="text-foreground/80 font-medium">{c.requesting_branch?.name || "—"}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs shrink-0"
                    onClick={() => onOpenChild(c.id)}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                    Abrir
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
