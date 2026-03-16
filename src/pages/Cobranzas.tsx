import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  DollarSign, CheckCircle2, Clock, FileText, AlertTriangle, Users,
} from "lucide-react";
import { toast } from "sonner";

const SETTLEMENT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-secondary/10 text-secondary" },
  reviewed: { label: "Revisado", color: "bg-info/10 text-info" },
  approved: { label: "Aprobado", color: "bg-accent/10 text-accent" },
  closed: { label: "Cerrado", color: "bg-muted text-muted-foreground" },
};

export default function Cobranzas() {
  const [tab, setTab] = useState("pendientes");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Settlements pending review
  const { data: settlements, isLoading } = useQuery({
    queryKey: ["admin-settlements", tab],
    queryFn: async () => {
      let query = supabase
        .from("driver_settlements")
        .select(`
          *,
          driver:drivers(id, user_id, assigned_branch_id),
          trip:trips(trip_number, trip_type, origin_branch_id, start_mileage, end_mileage,
            actual_departure, actual_arrival,
            origin_branch:branches!trips_origin_branch_id_fkey(name, code))
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (tab === "pendientes") {
        query = query.in("status", ["pending"]);
      } else if (tab === "revisados") {
        query = query.in("status", ["reviewed", "approved"]);
      } else {
        query = query.eq("status", "closed");
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Trips with pending settlement (no settlement record yet)
  const { data: unsettledTrips } = useQuery({
    queryKey: ["unsettled-trips"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number)
        `)
        .eq("status", "completed" as any)
        .eq("settlement_status", "pending")
        .order("actual_arrival", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  // Collections & deposits for review detail
  const { data: detailCollections } = useQuery({
    queryKey: ["settlement-collections", reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const settlement = settlements?.find(s => s.id === reviewId);
      if (!settlement) return [];
      const { data, error } = await supabase
        .from("driver_collections")
        .select("*")
        .eq("trip_id", settlement.trip_id)
        .eq("driver_id", settlement.driver_id);
      if (error) throw error;
      return data;
    },
  });

  const { data: detailDeposits } = useQuery({
    queryKey: ["settlement-deposits", reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const settlement = settlements?.find(s => s.id === reviewId);
      if (!settlement) return [];
      const { data, error } = await supabase
        .from("bank_deposits")
        .select("*")
        .eq("trip_id", settlement.trip_id)
        .eq("driver_id", settlement.driver_id);
      if (error) throw error;
      return data;
    },
  });

  const { data: detailFuel } = useQuery({
    queryKey: ["settlement-fuel", reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const settlement = settlements?.find(s => s.id === reviewId);
      if (!settlement) return [];
      const { data, error } = await supabase
        .from("fuel_records")
        .select("*")
        .eq("trip_id", settlement.trip_id)
        .eq("driver_id", settlement.driver_id);
      if (error) throw error;
      return data;
    },
  });

  const { data: detailPerDiem } = useQuery({
    queryKey: ["settlement-perdiem", reviewId],
    enabled: !!reviewId,
    queryFn: async () => {
      const settlement = settlements?.find(s => s.id === reviewId);
      if (!settlement) return [];
      const { data, error } = await supabase
        .from("per_diem_records")
        .select("*")
        .eq("trip_id", settlement.trip_id)
        .eq("driver_id", settlement.driver_id);
      if (error) throw error;
      return data;
    },
  });

  const formatGs = (n: number) => `₲ ${n.toLocaleString("es-PY")}`;

  const updateSettlementStatus = async (id: string, newStatus: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const payload: any = { status: newStatus };
      if (newStatus === "approved" || newStatus === "closed") {
        payload.reviewed_by = user.id;
        payload.reviewed_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("driver_settlements")
        .update(payload)
        .eq("id", id);
      if (error) throw error;

      // If closing, also update trip settlement_status
      if (newStatus === "closed") {
        const settlement = settlements?.find(s => s.id === id);
        if (settlement) {
          await supabase
            .from("trips")
            .update({ settlement_status: "closed", settled_at: new Date().toISOString(), settled_by: user.id })
            .eq("id", settlement.trip_id);
        }
      }

      toast.success(newStatus === "closed" ? "Rendición cerrada" : "Estado actualizado");
      queryClient.invalidateQueries({ queryKey: ["admin-settlements"] });
      queryClient.invalidateQueries({ queryKey: ["unsettled-trips"] });
      setReviewId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const currentSettlement = settlements?.find(s => s.id === reviewId);
  const totalCollected = detailCollections?.reduce((s, c) => s + Number(c.amount), 0) || 0;
  const totalDeposited = detailDeposits?.reduce((s, d) => s + Number(d.amount), 0) || 0;
  const totalFuelCost = detailFuel?.reduce((s, f) => s + Number(f.total_amount), 0) || 0;
  const totalPerDiemCost = detailPerDiem?.reduce((s, p) => s + Number(p.amount), 0) || 0;
  const netBalance = totalCollected - totalDeposited - totalFuelCost - totalPerDiemCost;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Cobranzas y Conciliación</h1>
        <p className="text-muted-foreground mt-1">Revisión administrativa de rendiciones, adelantos vs cobranzas</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Rendiciones pendientes</p>
            <p className="text-2xl font-display font-bold text-secondary">
              {settlements?.filter(s => s.status === "pending").length || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Viajes sin rendición</p>
            <p className="text-2xl font-display font-bold text-destructive">
              {unsettledTrips?.length || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Revisados</p>
            <p className="text-2xl font-display font-bold text-info">
              {settlements?.filter(s => s.status === "reviewed").length || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Cerrados hoy</p>
            <p className="text-2xl font-display font-bold text-accent">
              {settlements?.filter(s => s.status === "closed" && s.reviewed_at && new Date(s.reviewed_at).toDateString() === new Date().toDateString()).length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Unsettled trips alert */}
      {unsettledTrips && unsettledTrips.length > 0 && (
        <Card className="glass-card border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Viajes completados sin rendición
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {unsettledTrips.slice(0, 5).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-2 rounded bg-destructive/5 text-sm">
                <div>
                  <span className="font-mono font-semibold">Viaje #{t.trip_number}</span>
                  <span className="text-muted-foreground ml-2">{(t as any).origin_branch?.code}</span>
                  <span className="text-muted-foreground ml-2">
                    {t.actual_arrival ? new Date(t.actual_arrival).toLocaleDateString("es-PY", { day: "2-digit", month: "short" }) : ""}
                  </span>
                </div>
                <Badge variant="destructive" className="text-xs">Sin rendición</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pendientes" className="text-xs gap-1"><Clock className="h-3.5 w-3.5" /> Pendientes</TabsTrigger>
          <TabsTrigger value="revisados" className="text-xs gap-1"><FileText className="h-3.5 w-3.5" /> Revisados</TabsTrigger>
          <TabsTrigger value="cerrados" className="text-xs gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Cerrados</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Cargando...</div>
              ) : !settlements?.length ? (
                <div className="p-8 text-center text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Sin rendiciones en esta bandeja</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {settlements.map((s: any) => {
                    const statusConfig = SETTLEMENT_STATUS_LABELS[s.status] || SETTLEMENT_STATUS_LABELS.pending;
                    return (
                      <div key={s.id}
                        className="p-4 hover:bg-muted/20 transition-colors cursor-pointer"
                        onClick={() => setReviewId(s.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <span className="font-mono font-semibold text-sm">
                                Viaje #{(s.trip as any)?.trip_number || "—"}
                              </span>
                              <span className="text-muted-foreground text-xs ml-2">
                                {(s.trip as any)?.origin_branch?.code || ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <p className="font-mono font-bold text-sm">
                                {formatGs(Number(s.total_collections || 0))}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Neto: {formatGs(Number(s.net_amount || 0))}
                              </p>
                            </div>
                            <Badge className={`text-xs ${statusConfig.color}`}>
                              {statusConfig.label}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review dialog */}
      <Dialog open={!!reviewId} onOpenChange={(o) => !o && setReviewId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              Revisión de Rendición — Viaje #{(currentSettlement?.trip as any)?.trip_number || "—"}
            </DialogTitle>
          </DialogHeader>

          {currentSettlement && (
            <div className="space-y-5">
              {/* Balance summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/15">
                  <p className="text-xs text-muted-foreground">Cobrado</p>
                  <p className="font-mono font-bold text-primary">{formatGs(totalCollected)}</p>
                </div>
                <div className="p-3 rounded-lg bg-accent/5 border border-accent/15">
                  <p className="text-xs text-muted-foreground">Depositado</p>
                  <p className="font-mono font-bold text-accent">{formatGs(totalDeposited)}</p>
                </div>
                <div className="p-3 rounded-lg bg-secondary/5 border border-secondary/15">
                  <p className="text-xs text-muted-foreground">Gastos</p>
                  <p className="font-mono font-bold text-secondary">{formatGs(totalFuelCost + totalPerDiemCost)}</p>
                </div>
                <div className={`p-3 rounded-lg border ${netBalance >= 0 ? "bg-destructive/5 border-destructive/15" : "bg-accent/5 border-accent/15"}`}>
                  <p className="text-xs text-muted-foreground">Saldo chofer</p>
                  <p className={`font-mono font-bold ${netBalance >= 0 ? "text-destructive" : "text-accent"}`}>
                    {formatGs(Math.abs(netBalance))}
                    <span className="text-xs font-normal ml-1">{netBalance >= 0 ? "a rendir" : "a favor"}</span>
                  </p>
                </div>
              </div>

              {/* Collections detail */}
              {detailCollections && detailCollections.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Cobranzas</h4>
                  <div className="space-y-1">
                    {detailCollections.map((c: any) => (
                      <div key={c.id} className="flex justify-between text-sm p-2 bg-muted/20 rounded">
                        <div>
                          <span>{c.client_name || "—"}</span>
                          <Badge variant="outline" className="text-xs ml-2">
                            {c.payment_method === "cash" ? "Efectivo" : c.payment_method === "check" ? "Cheque" : "Transfer."}
                          </Badge>
                        </div>
                        <span className="font-mono">{formatGs(Number(c.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deposits detail */}
              {detailDeposits && detailDeposits.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Depósitos</h4>
                  <div className="space-y-1">
                    {detailDeposits.map((d: any) => (
                      <div key={d.id} className="flex justify-between text-sm p-2 bg-muted/20 rounded">
                        <div>
                          <span>{d.bank_name || "Banco"}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {new Date(d.deposit_date).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                          </span>
                          {d.verified_at && <Badge className="bg-accent/10 text-accent text-xs ml-2">✓</Badge>}
                        </div>
                        <span className="font-mono">{formatGs(Number(d.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fuel & per diem */}
              {detailFuel && detailFuel.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Combustible</h4>
                  <div className="space-y-1">
                    {detailFuel.map((f: any) => (
                      <div key={f.id} className="flex justify-between text-sm p-2 bg-muted/20 rounded">
                        <span>{f.station_name || "Estación"} — {f.liters}L</span>
                        <span className="font-mono">{formatGs(Number(f.total_amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailPerDiem && detailPerDiem.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Viáticos</h4>
                  <div className="space-y-1">
                    {detailPerDiem.map((p: any) => (
                      <div key={p.id} className="flex justify-between text-sm p-2 bg-muted/20 rounded">
                        <span>{p.concept}</span>
                        <span className="font-mono">{formatGs(Number(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {currentSettlement.notes && (
                <div className="p-3 rounded-lg bg-muted/30 text-sm">
                  <p className="text-xs text-muted-foreground mb-1">Notas:</p>
                  <p>{currentSettlement.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                {currentSettlement.status === "pending" && (
                  <>
                    <Button onClick={() => updateSettlementStatus(reviewId!, "reviewed")} className="gap-2 flex-1">
                      <FileText className="h-4 w-4" /> Marcar revisado
                    </Button>
                    <Button variant="outline" onClick={() => updateSettlementStatus(reviewId!, "approved")} className="gap-2 flex-1">
                      <CheckCircle2 className="h-4 w-4" /> Aprobar directamente
                    </Button>
                  </>
                )}
                {currentSettlement.status === "reviewed" && (
                  <Button onClick={() => updateSettlementStatus(reviewId!, "approved")} className="gap-2 flex-1">
                    <CheckCircle2 className="h-4 w-4" /> Aprobar
                  </Button>
                )}
                {(currentSettlement.status === "approved" || currentSettlement.status === "reviewed") && (
                  <Button variant="destructive" onClick={() => updateSettlementStatus(reviewId!, "closed")} className="gap-2 flex-1">
                    <DollarSign className="h-4 w-4" /> Cerrar rendición
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
