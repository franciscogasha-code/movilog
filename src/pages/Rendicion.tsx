import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DollarSign, Fuel, Receipt, Landmark, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function Rendicion() {
  const [tab, setTab] = useState("cobranzas");
  const [addCollectionOpen, setAddCollectionOpen] = useState(false);
  const [addDepositOpen, setAddDepositOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: completedTrips } = useQuery({
    queryKey: ["completed-trips-settlement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select(`
          *,
          origin_branch:branches!trips_origin_branch_id_fkey(name, code),
          vehicle:vehicles(plate_number),
          driver:drivers(id, user_id)
        `)
        .eq("status", "completed")
        .in("settlement_status", ["pending"])
        .order("actual_arrival", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const { data: collections } = useQuery({
    queryKey: ["driver-collections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("driver_collections")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: deposits } = useQuery({
    queryKey: ["bank-deposits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_deposits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const { data: fuelRecords } = useQuery({
    queryKey: ["fuel-records-settlement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fuel_records")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const { data: perDiemRecords } = useQuery({
    queryKey: ["per-diem-settlement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("per_diem_records")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
  });

  const totalCollections = collections?.reduce((sum, c) => sum + Number(c.amount), 0) || 0;
  const totalDeposits = deposits?.reduce((sum, d) => sum + Number(d.amount), 0) || 0;
  const totalFuel = fuelRecords?.reduce((sum, f) => sum + Number(f.total_amount), 0) || 0;
  const totalPerDiem = perDiemRecords?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

  const formatGs = (n: number) => `₲ ${n.toLocaleString("es-PY")}`;

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Rendición del Chofer</h1>
        <p className="text-muted-foreground mt-1">Cobranzas, depósitos, combustible y viáticos por viaje</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Cobrado</p>
            <p className="text-xl font-display font-bold text-primary">{formatGs(totalCollections)}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Depositado</p>
            <p className="text-xl font-display font-bold text-accent">{formatGs(totalDeposits)}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Combustible</p>
            <p className="text-xl font-display font-bold text-secondary">{formatGs(totalFuel)}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase">Viáticos</p>
            <p className="text-xl font-display font-bold">{formatGs(totalPerDiem)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pending trips */}
      {completedTrips && completedTrips.length > 0 && (
        <Card className="glass-card border-secondary/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Viajes pendientes de rendición</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {completedTrips.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm">
                <div>
                  <span className="font-mono font-semibold">Viaje #{t.trip_number}</span>
                  <span className="text-muted-foreground ml-2">{t.origin_branch?.code}</span>
                  {t.start_mileage && t.end_mileage && (
                    <span className="text-muted-foreground ml-2">{t.end_mileage - t.start_mileage} km</span>
                  )}
                </div>
                <Badge variant="outline" className="text-xs">Pendiente</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="cobranzas" className="text-xs gap-1"><DollarSign className="h-3.5 w-3.5" /> Cobranzas</TabsTrigger>
          <TabsTrigger value="depositos" className="text-xs gap-1"><Landmark className="h-3.5 w-3.5" /> Depósitos</TabsTrigger>
          <TabsTrigger value="combustible" className="text-xs gap-1"><Fuel className="h-3.5 w-3.5" /> Combustible</TabsTrigger>
          <TabsTrigger value="viaticos" className="text-xs gap-1"><Receipt className="h-3.5 w-3.5" /> Viáticos</TabsTrigger>
        </TabsList>

        <TabsContent value="cobranzas" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddCollectionOpen(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Registrar cobro
            </Button>
          </div>
          <Card className="glass-card">
            <CardContent className="p-0">
              {!collections?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin cobranzas registradas</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {collections.map((c: any) => (
                    <div key={c.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">{c.client_name || "—"}</span>
                        <Badge variant="outline" className="text-xs ml-2">
                          {c.payment_method === "cash" ? "Efectivo" : c.payment_method === "check" ? "Cheque" : "Transferencia"}
                        </Badge>
                        {c.check_number && <span className="text-xs text-muted-foreground ml-1">Ch#{c.check_number}</span>}
                      </div>
                      <span className="font-mono font-bold text-primary">{formatGs(Number(c.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="depositos" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddDepositOpen(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Registrar depósito
            </Button>
          </div>
          <Card className="glass-card">
            <CardContent className="p-0">
              {!deposits?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin depósitos registrados</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {deposits.map((d: any) => (
                    <div key={d.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">{d.bank_name || "Banco"}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(d.deposit_date).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </span>
                        {d.verified_at && <Badge className="bg-accent/10 text-accent text-xs ml-2 gap-1"><CheckCircle2 className="h-3 w-3" /> Verificado</Badge>}
                      </div>
                      <span className="font-mono font-bold text-accent">{formatGs(Number(d.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="combustible" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {!fuelRecords?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin registros de combustible</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {fuelRecords.map((f: any) => (
                    <div key={f.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">{f.station_name || "Estación"}</span>
                        <span className="text-xs text-muted-foreground ml-2">{f.liters}L</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(f.date).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-secondary">{formatGs(Number(f.total_amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="viaticos" className="mt-4">
          <Card className="glass-card">
            <CardContent className="p-0">
              {!perDiemRecords?.length ? (
                <div className="p-8 text-center text-muted-foreground">Sin viáticos registrados</div>
              ) : (
                <div className="divide-y divide-border/50">
                  {perDiemRecords.map((p: any) => (
                    <div key={p.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-semibold">{p.concept}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {new Date(p.date).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </span>
                        {p.approved_at && <Badge className="bg-accent/10 text-accent text-xs ml-2">Aprobado</Badge>}
                      </div>
                      <span className="font-mono font-bold">{formatGs(Number(p.amount))}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add collection dialog */}
      <Dialog open={addCollectionOpen} onOpenChange={setAddCollectionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar cobro</DialogTitle></DialogHeader>
          <CollectionForm
            trips={completedTrips || []}
            onSuccess={() => {
              setAddCollectionOpen(false);
              queryClient.invalidateQueries({ queryKey: ["driver-collections"] });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Add deposit dialog */}
      <Dialog open={addDepositOpen} onOpenChange={setAddDepositOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar depósito bancario</DialogTitle></DialogHeader>
          <DepositForm
            onSuccess={() => {
              setAddDepositOpen(false);
              queryClient.invalidateQueries({ queryKey: ["bank-deposits"] });
            }}
          />
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function CollectionForm({ trips, onSuccess }: { trips: any[]; onSuccess: () => void }) {
  const [tripId, setTripId] = useState("");
  const [clientName, setClientName] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [checkNumber, setCheckNumber] = useState("");
  const [transferRef, setTransferRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !tripId) { toast.error("Completá monto y viaje"); return; }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase.from("drivers").select("id").eq("user_id", user.id).single();
      if (!driver) { toast.error("No registrado como chofer"); return; }

      const { error } = await supabase.from("driver_collections").insert({
        trip_id: tripId,
        driver_id: driver.id,
        client_name: clientName || null,
        amount: parseFloat(amount),
        payment_method: paymentMethod,
        check_number: paymentMethod === "check" ? checkNumber : null,
        transfer_reference: paymentMethod === "transfer" ? transferRef : null,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success("Cobro registrado");
      onSuccess();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Viaje *</Label>
        <Select value={tripId} onValueChange={setTripId}>
          <SelectTrigger><SelectValue placeholder="Seleccionar viaje..." /></SelectTrigger>
          <SelectContent>
            {trips.map((t: any) => (
              <SelectItem key={t.id} value={t.id}>Viaje #{t.trip_number} — {t.origin_branch?.code}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cliente</Label>
          <Input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nombre del cliente" />
        </div>
        <div className="space-y-2">
          <Label>Monto *</Label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Método de pago</Label>
        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Efectivo</SelectItem>
            <SelectItem value="check">Cheque</SelectItem>
            <SelectItem value="transfer">Transferencia</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {paymentMethod === "check" && (
        <div className="space-y-2">
          <Label>Nro. de cheque</Label>
          <Input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} />
        </div>
      )}
      {paymentMethod === "transfer" && (
        <div className="space-y-2">
          <Label>Referencia de transferencia</Label>
          <Input value={transferRef} onChange={e => setTransferRef(e.target.value)} />
        </div>
      )}
      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Registrando..." : "Registrar cobro"}
      </Button>
    </form>
  );
}

function DepositForm({ onSuccess }: { onSuccess: () => void }) {
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) { toast.error("Ingresá el monto"); return; }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase.from("drivers").select("id").eq("user_id", user.id).single();
      if (!driver) { toast.error("No registrado como chofer"); return; }

      const { error } = await supabase.from("bank_deposits").insert({
        driver_id: driver.id,
        amount: parseFloat(amount),
        bank_name: bankName || null,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success("Depósito registrado");
      onSuccess();
    } catch (err: any) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Monto *</Label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-2">
          <Label>Banco</Label>
          <Input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Nombre del banco" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notas</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Registrando..." : "Registrar depósito"}
      </Button>
    </form>
  );
}
