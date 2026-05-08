import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, CheckCircle2, ExternalLink, PackageCheck, Clock } from "lucide-react";
import { toast } from "sonner";
import { REQUEST_STATUS_CONFIG } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Panel de Abastecimiento — visible cuando el pedido está en `in_supply`.
 *
 * Cubre los dos casos del Volumen 3:
 *  A) Stock 100% local en la sucursal ejecutora → "Confirmar abastecimiento local"
 *     llama a fn_confirm_local_supply y promueve a `supplied`.
 *  B) Existen pedidos internos vinculados (parent_request_id = este pedido):
 *     se listan en vivo. La promoción a `supplied` ocurre automáticamente vía
 *     trg_auto_promote_to_supplied cuando todos cierran.
 *
 * NO afecta el flujo logístico actual: solo se monta para status='in_supply'.
 */
export function SupplyResolutionPanel({
  requestId,
  onUpdate,
}: {
  requestId: string;
  onUpdate: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: children = [], isLoading } = useQuery({
    queryKey: ["supply-children", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("id, request_number, status, source_branch:branches!branch_requests_source_branch_id_fkey(name, code)")
        .eq("parent_request_id", requestId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const closedSet = new Set(["received", "logistic_closed", "closed", "rejected"]);
  const openChildren = (children as any[]).filter((c) => !closedSet.has(c.status));
  const hasOpenChildren = openChildren.length > 0;
  const hasAnyChildren = (children as any[]).length > 0;

  async function confirmLocal() {
    setConfirming(true);
    try {
      const { error } = await supabase.rpc("fn_confirm_local_supply" as any, { p_request_id: requestId });
      if (error) throw error;
      toast.success("Abastecimiento local confirmado. Pedido pasa a 'Abastecido'.");
      qc.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      qc.invalidateQueries({ queryKey: ["branch-requests"] });
      onUpdate();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo confirmar abastecimiento");
    } finally {
      setConfirming(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <PackageCheck className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">En abastecimiento</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Este pedido aún no entró al flujo logístico. Resolvé el abastecimiento del stock antes de iniciar la operación.
            </p>
          </div>
        </div>

        {hasAnyChildren && (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Pedidos internos vinculados ({children.length})
            </p>
            <div className="rounded-md border border-border/60 overflow-hidden divide-y divide-border/50 bg-background">
              {(children as any[]).map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/solicitudes?detail=${c.id}`)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-semibold">#{c.request_number}</span>
                    {c.source_branch?.name && (
                      <span className="text-xs text-muted-foreground truncate">desde {c.source_branch.name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={c.status} config={REQUEST_STATUS_CONFIG} />
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
            {hasOpenChildren ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Esperando recepción de {openChildren.length} pedido(s) interno(s). Al cerrarse todos, el pedido pasa automáticamente a "Abastecido".</span>
              </div>
            ) : (
              <p className="text-xs text-success">
                Todos los pedidos internos están cerrados. El pedido debió promoverse a "Abastecido" automáticamente.
              </p>
            )}
          </div>
        )}

        {!hasAnyChildren && !isLoading && (
          <div className="rounded-md border border-border/60 bg-background p-3 space-y-2">
            <p className="text-sm font-medium">Stock completo en la sucursal ejecutora</p>
            <p className="text-xs text-muted-foreground">
              Si el stock está disponible localmente y no necesitás solicitar a otras sucursales,
              confirmá para pasar el pedido a <strong>Abastecido</strong>.
            </p>
            <Button
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={confirming}
            >
              {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Confirmar abastecimiento local
            </Button>
          </div>
        )}

        {!hasAnyChildren && (
          <Badge variant="outline" className="text-[10px]">
            Tip: si necesitás stock de otra sucursal, creá un pedido interno desde el módulo correspondiente y vinculálo a este pedido.
          </Badge>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar abastecimiento local</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a declarar que tu sucursal cuenta con el stock completo de los productos del pedido.
              Esto promueve el pedido a <strong>Abastecido</strong> y habilita el inicio de la operación logística.
              <br /><br />
              <strong>Verificá visualmente el stock antes de continuar.</strong> No vamos a poder revertir este paso una vez que la operación arranque.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLocal} disabled={confirming}>
              {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Sí, confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
