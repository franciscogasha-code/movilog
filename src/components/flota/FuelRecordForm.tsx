import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

export function FuelRecordForm({
  open,
  onOpenChange,
  presetVehicleId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetVehicleId?: string | null;
}) {
  const qc = useQueryClient();
  const { user, profile, hasRole } = useAuth();
  const canPickDriver = hasRole("admin") || hasRole("supervisor") || hasRole("owner");

  const [vehicleId, setVehicleId] = useState<string>(presetVehicleId ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mileage, setMileage] = useState<string>("");
  const [liters, setLiters] = useState<string>("");
  const [pricePerLiter, setPricePerLiter] = useState<string>("");
  const [totalAmount, setTotalAmount] = useState<string>("");
  const [stationName, setStationName] = useState("");
  const [receiptPath, setReceiptPath] = useState("");
  const [notes, setNotes] = useState("");
  const [lastEditWasTotal, setLastEditWasTotal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  useEffect(() => { if (presetVehicleId) setVehicleId(presetVehicleId); }, [presetVehicleId]);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, plate, nickname").eq("is_active", true).order("plate");
      if (error) throw error;
      return data;
    },
  });

  const { data: myDriver } = useQuery({
    queryKey: ["my-driver", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("drivers").select("id").eq("user_id", user!.id).maybeSingle();
      return data;
    },
  });

  const { data: allDrivers } = useQuery({
    queryKey: ["drivers-active-list"],
    enabled: canPickDriver,
    queryFn: async () => {
      const { data: drvs, error } = await supabase.from("drivers").select("id, user_id").eq("is_active", true);
      if (error) throw error;
      const ids = (drvs ?? []).map((d) => d.user_id).filter(Boolean);
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as any[] };
      const nameById = new Map((profs ?? []).map((p: any) => [p.id, p.full_name]));
      return (drvs ?? [])
        .map((d) => ({ id: d.id, full_name: nameById.get(d.user_id) ?? "Sin nombre" }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  // Default driver: own if exists, otherwise empty (admin must choose)
  useEffect(() => {
    if (!selectedDriverId && myDriver?.id) setSelectedDriverId(myDriver.id);
  }, [myDriver?.id, selectedDriverId]);

  const driverId = selectedDriverId;

  // Bidirectional total ↔ per-liter
  useEffect(() => {
    const l = parseFloat(liters);
    if (!l || l <= 0) return;
    if (lastEditWasTotal) {
      const t = parseFloat(totalAmount);
      if (t > 0) setPricePerLiter((t / l).toFixed(2));
    } else {
      const p = parseFloat(pricePerLiter);
      if (p > 0) setTotalAmount((p * l).toFixed(0));
    }
  }, [liters, pricePerLiter, totalAmount, lastEditWasTotal]);

  // Historical average efficiency
  const { data: history } = useQuery({
    queryKey: ["fuel-history-avg", vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fuel_records")
        .select("computed_efficiency_kmpl")
        .eq("vehicle_id", vehicleId)
        .not("computed_efficiency_kmpl", "is", null)
        .order("date", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const avgKmpl = useMemo(() => {
    const arr = (history ?? []).map((h: any) => Number(h.computed_efficiency_kmpl)).filter((n) => n > 0);
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }, [history]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!vehicleId) throw new Error("Vehículo requerido");
      if (!driverId) throw new Error("El usuario en sesión no está registrado como chofer");
      if (!date) throw new Error("Fecha requerida");
      if (!mileage || Number(mileage) <= 0) throw new Error("Km al momento requerido");
      if (!liters || Number(liters) <= 0) throw new Error("Litros requeridos");
      if (!stationName.trim()) throw new Error("Estación requerida");
      if (!pricePerLiter || Number(pricePerLiter) <= 0) throw new Error("Precio por litro requerido");
      if (!totalAmount || Number(totalAmount) <= 0) throw new Error("Precio total requerido");
      if (!receiptPath) throw new Error("Foto del comprobante requerida");
      const payload: any = {
        vehicle_id: vehicleId,
        driver_id: driverId,
        date,
        liters: Number(liters),
        price_per_liter: Number(pricePerLiter),
        total_amount: Number(totalAmount),
        mileage_at_fill: Number(mileage),
        station_name: stationName.trim(),
        receipt_photo_url: receiptPath,
        notes: notes.trim() || null,
      };
      const { error } = await supabase.from("fuel_records").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fuel-records"] });
      qc.invalidateQueries({ queryKey: ["fuel-history-avg"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success("Carga registrada");
      onOpenChange(false);
      setLiters(""); setPricePerLiter(""); setTotalAmount(""); setMileage(""); setReceiptPath(""); setNotes("");
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Registrar carga de combustible</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Vehículo *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {vehicles?.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>{v.plate}{v.nickname ? ` — ${v.nickname}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Chofer *</Label>
              {myDriver?.id ? (
                <>
                  <Input value={profile?.full_name ?? ""} readOnly disabled />
                  <p className="text-xs text-muted-foreground mt-1">Se asigna al usuario en sesión</p>
                </>
              ) : canPickDriver ? (
                <>
                  <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar chofer..." /></SelectTrigger>
                    <SelectContent>
                      {allDrivers?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Carga administrativa: seleccioná el chofer real</p>
                </>
              ) : (
                <>
                  <Input value={profile?.full_name ?? ""} readOnly disabled />
                  <p className="text-xs text-destructive mt-1">El usuario en sesión no está registrado como chofer</p>
                </>
              )}
            </div>
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Km al momento *</Label>
              <Input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} />
            </div>
            <div>
              <Label>Litros *</Label>
              <Input type="number" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} />
            </div>
            <div>
              <Label>Estación *</Label>
              <Input value={stationName} onChange={(e) => setStationName(e.target.value)} />
            </div>
            <div>
              <Label>₲ por litro *</Label>
              <Input type="number" value={pricePerLiter} onChange={(e) => { setLastEditWasTotal(false); setPricePerLiter(e.target.value); }} />
            </div>
            <div>
              <Label>Total ₲ *</Label>
              <Input type="number" value={totalAmount} onChange={(e) => { setLastEditWasTotal(true); setTotalAmount(e.target.value); }} />
            </div>
          </div>

          <div>
            <Label>Foto comprobante / surtidor *</Label>
            <FileUpload bucket="vehicle-photos" folder={`fuel/${vehicleId || "unknown"}`} signed onUpload={setReceiptPath} />
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {avgKmpl !== null && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Rendimiento promedio histórico: {avgKmpl.toFixed(2)} km/L. Si esta carga cae &gt;20%, aparecerá alerta después de guardar.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Guardando..." : "Registrar carga"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
