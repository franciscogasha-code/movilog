import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, AlertTriangle, MapPin, Truck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { branchName } from "@/lib/branch-format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  tripNumber: number;
}

const VALID_FO_STATUSES = ["pending", "at_hub", "waiting_for_cut", "waiting_for_courier", "ready_for_pickup", "dispatched"];

export function AceptarCargasViajeModal({ open, onOpenChange, tripId, tripNumber }: Props) {
  const queryClient = useQueryClient();
  const [startMileage, setStartMileage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const { data: loads, isLoading } = useQuery({
    queryKey: ["trip-loads-acceptance", tripId, open],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`
          id, status, destination_client_name, package_count, bims_transfer_number, bims_invoice_number,
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code),
          branch_request:branch_requests(request_number, request_type, delivery_target, client_name)
        `)
        .eq("trip_id", tripId);
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!tripId,
  });

  const { valid, invalid } = useMemo(() => {
    const v: any[] = [];
    const inv: any[] = [];
    (loads || []).forEach((l: any) => {
      if (VALID_FO_STATUSES.includes(l.status)) v.push(l);
      else inv.push(l);
    });
    return { valid: v, invalid: inv };
  }, [loads]);

  const acceptedIds = useMemo(
    () => valid.filter((l) => !excludedIds.has(l.id)).map((l) => l.id),
    [valid, excludedIds]
  );

  const toggleExcluded = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!startMileage || isNaN(parseInt(startMileage))) {
      toast.error("Ingresá el kilometraje inicial");
      return;
    }
    if (acceptedIds.length === 0) {
      toast.error("Debés aceptar al menos una carga");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("fn_accept_and_start_trip", {
        p_trip_id: tripId,
        p_fulfillment_ids: acceptedIds,
        p_start_mileage: parseInt(startMileage),
        p_force_empty: false,
      });
      if (error) throw error;
      const result = data as any;
      const skipped = (result?.skipped as any[]) || [];
      const accepted = result?.accepted_count || 0;
      if (skipped.length > 0) {
        toast.warning(`Viaje iniciado con ${accepted} carga(s). ${skipped.length} omitida(s) por estado inválido.`);
      } else {
        toast.success(`Viaje #${tripNumber} iniciado con ${accepted} carga(s)`);
      }
      // Invalidate everything that touches trips/fulfillments/custody
      queryClient.invalidateQueries({ queryKey: ["active-trips"] });
      queryClient.invalidateQueries({ queryKey: ["custody-count"] });
      queryClient.invalidateQueries({ queryKey: ["my-custody-loads"] });
      queryClient.invalidateQueries({ queryKey: ["trip-fulfillments"] });
      queryClient.invalidateQueries({ queryKey: ["trip-loads-acceptance"] });
      queryClient.invalidateQueries({ queryKey: ["planned-count"] });
      queryClient.invalidateQueries({ queryKey: ["in-progress-count"] });
      onOpenChange(false);
      setStartMileage("");
      setExcludedIds(new Set());
    } catch (err: any) {
      toast.error(err.message || "Error al iniciar el viaje");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            Aceptar cargas — Viaje #{tripNumber}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-2 px-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando cargas...
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div className="grid grid-cols-2 gap-2">
                <div className="op-card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aceptadas</div>
                  <div className="text-2xl font-display font-bold text-accent">{acceptedIds.length}</div>
                </div>
                <div className="op-card p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Inválidas</div>
                  <div className="text-2xl font-display font-bold text-muted-foreground">{invalid.length}</div>
                </div>
              </div>

              {/* Cargas válidas */}
              {valid.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Cargas a aceptar ({valid.length})
                  </h4>
                  <div className="space-y-2">
                    {valid.map((l: any) => {
                      const excluded = excludedIds.has(l.id);
                      const dest = l.destination_client_name || l.branch_request?.client_name || branchName(l.destination_branch);
                      return (
                        <label
                          key={l.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            excluded
                              ? "bg-muted/20 border-border/30 opacity-60"
                              : "bg-accent/5 border-accent/20 hover:bg-accent/10"
                          }`}
                        >
                          <Checkbox
                            checked={!excluded}
                            onCheckedChange={() => toggleExcluded(l.id)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-semibold text-sm">
                                Pedido #{l.branch_request?.request_number || "—"}
                              </span>
                              {l.branch_request?.request_type && (
                                <Badge variant="outline" className="text-[10px] capitalize">
                                  {l.branch_request.request_type === "client"
                                    ? "Cliente"
                                    : l.branch_request.request_type === "reposition"
                                    ? "Reposición"
                                    : l.branch_request.request_type}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">→ {dest}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mt-1.5">
                              {l.bims_transfer_number && (
                                <Badge variant="outline" className="text-[10px]">T: {l.bims_transfer_number}</Badge>
                              )}
                              {l.bims_invoice_number && (
                                <Badge variant="outline" className="text-[10px]">F: {l.bims_invoice_number}</Badge>
                              )}
                              {l.package_count > 0 && (
                                <Badge variant="secondary" className="text-[10px]">{l.package_count} bultos</Badge>
                              )}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cargas inválidas */}
              {invalid.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> No aceptables ({invalid.length})
                  </h4>
                  <div className="space-y-1.5">
                    {invalid.map((l: any) => (
                      <div key={l.id} className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/20 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Pedido #{l.branch_request?.request_number || "—"}</span>
                          <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                            Estado: {l.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {valid.length === 0 && invalid.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Este viaje no tiene cargas asignadas
                </div>
              )}

              {/* Kilometraje */}
              <div className="pt-2">
                <Label htmlFor="start-mileage" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Kilometraje inicial *
                </Label>
                <Input
                  id="start-mileage"
                  type="number"
                  inputMode="numeric"
                  value={startMileage}
                  onChange={(e) => setStartMileage(e.target.value)}
                  placeholder="Ej: 145300"
                  className="mt-1 h-11 text-base"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || acceptedIds.length === 0 || !startMileage}
            className="w-full sm:w-auto gap-2 h-11"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Truck className="h-4 w-4" />
            )}
            Confirmar e iniciar ({acceptedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
