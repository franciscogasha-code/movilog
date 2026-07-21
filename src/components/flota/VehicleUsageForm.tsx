import { useState, useMemo, useEffect } from "react";
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

export function VehicleUsageForm({
  open,
  onOpenChange,
  presetVehicleId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presetVehicleId?: string | null;
}) {
  const qc = useQueryClient();
  const { user, isOwner, hasRole } = useAuth();
  const isPrivileged = isOwner || hasRole("admin") || hasRole("supervisor");

  const [vehicleId, setVehicleId] = useState<string>(presetVehicleId ?? "");
  const [driverId, setDriverId] = useState<string>("");
  const [driverNameText, setDriverNameText] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [destination, setDestination] = useState("");
  const [startMileage, setStartMileage] = useState<string>("");
  const [endMileage, setEndMileage] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [endedAt, setEndedAt] = useState<string>("");
  const [startPhoto, setStartPhoto] = useState<string>("");
  const [endPhoto, setEndPhoto] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => { if (presetVehicleId) setVehicleId(presetVehicleId); }, [presetVehicleId]);

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("id, plate, nickname, current_mileage").eq("is_active", true).order("plate");
      if (error) throw error;
      return data;
    },
  });

  const { data: cats } = useQuery({
    queryKey: ["vehicle-usage-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_usage_categories").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: drivers } = useQuery({
    queryKey: ["drivers-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, user_id, profile:profiles!drivers_user_id_fkey(full_name)")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: myDriver } = useQuery({
    queryKey: ["my-driver", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("drivers").select("id").eq("user_id", user!.id).eq("is_active", true).maybeSingle();
      return data;
    },
  });

  // Default driver: current user if is driver
  useEffect(() => { if (!driverId && myDriver?.id && !isPrivileged) setDriverId(myDriver.id); }, [myDriver, isPrivileged, driverId]);

  const { data: lastUsage } = useQuery({
    queryKey: ["last-vehicle-usage", vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_usages")
        .select("end_mileage, start_mileage, km_traveled")
        .eq("vehicle_id", vehicleId)
        .order("started_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const lastKm = useMemo(() => {
    if (!lastUsage?.length) {
      const v = vehicles?.find((x: any) => x.id === vehicleId);
      return v?.current_mileage ?? null;
    }
    return lastUsage[0]?.end_mileage ?? lastUsage[0]?.start_mileage ?? null;
  }, [lastUsage, vehicles, vehicleId]);

  const avgKm = useMemo(() => {
    const arr = (lastUsage ?? []).map((u: any) => u.km_traveled).filter((n: number) => n > 0);
    if (!arr.length) return null;
    return arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
  }, [lastUsage]);

  const startNum = Number(startMileage);
  const endNum = Number(endMileage);
  const kmRecorridos = endMileage && startMileage ? Math.max(0, endNum - startNum) : null;

  const warnStart = lastKm !== null && startMileage && startNum < lastKm;
  const warnHigh = avgKm !== null && kmRecorridos !== null && kmRecorridos > avgKm * 2 && avgKm > 0;

  const submit = useMutation({
    mutationFn: async () => {
      if (!vehicleId) throw new Error("Seleccioná un vehículo");
      if (!startMileage) throw new Error("Kilometraje inicial requerido");
      if (!driverId && !driverNameText.trim()) throw new Error("Indicá el chofer (usuario o nombre)");
      const payload: any = {
        vehicle_id: vehicleId,
        driver_id: driverId || null,
        driver_name_text: driverId ? null : driverNameText.trim() || null,
        category_id: categoryId || null,
        destination: destination.trim() || null,
        start_mileage: startNum,
        end_mileage: endMileage ? endNum : null,
        started_at: new Date(startedAt).toISOString(),
        ended_at: endedAt ? new Date(endedAt).toISOString() : null,
        start_odometer_photo_path: startPhoto || null,
        end_odometer_photo_path: endPhoto || null,
        notes: notes.trim() || null,
        created_by: user?.id ?? null,
      };
      const { error } = await supabase.from("vehicle_usages").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-usages"] });
      qc.invalidateQueries({ queryKey: ["vehicles"] });
      qc.invalidateQueries({ queryKey: ["vehicles-active"] });
      toast.success("Uso registrado");
      onOpenChange(false);
      // reset
      setEndMileage(""); setStartMileage(""); setDestination(""); setNotes(""); setStartPhoto(""); setEndPhoto("");
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Registrar uso de vehículo</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Vehículo *</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                <SelectContent>
                  {vehicles?.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.plate}{v.nickname ? ` — ${v.nickname}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lastKm !== null && <p className="text-xs text-muted-foreground mt-1">Último km registrado: {lastKm.toLocaleString("de-DE")}</p>}
            </div>

            <div>
              <Label>Chofer</Label>
              <Select value={driverId || "__text"} onValueChange={(v) => setDriverId(v === "__text" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Elegir chofer..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__text">Otro (nombre libre)</SelectItem>
                  {drivers?.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.profile?.full_name || "Chofer"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!driverId && (
                <Input className="mt-1" placeholder="Nombre del chofer" value={driverNameText} onChange={(e) => setDriverNameText(e.target.value)} />
              )}
            </div>

            <div>
              <Label>Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Sin categoría" /></SelectTrigger>
                <SelectContent>
                  {cats?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Destino</Label>
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="A dónde va" />
            </div>

            <div>
              <Label>Km inicial *</Label>
              <Input type="number" value={startMileage} onChange={(e) => setStartMileage(e.target.value)} />
              {warnStart && (
                <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" /> Menor al último km ({lastKm?.toLocaleString("de-DE")})
                </p>
              )}
            </div>

            <div>
              <Label>Km final</Label>
              <Input type="number" value={endMileage} onChange={(e) => setEndMileage(e.target.value)} />
              {kmRecorridos !== null && (
                <p className="text-xs text-muted-foreground mt-1">Recorridos: {kmRecorridos.toLocaleString("de-DE")} km</p>
              )}
              {warnHigh && (
                <p className="text-xs text-secondary flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" /> Recorrido inusualmente alto vs promedio ({Math.round(avgKm!).toLocaleString("de-DE")})
                </p>
              )}
            </div>

            <div>
              <Label>Inicio</Label>
              <Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div>
              <Label>Fin</Label>
              <Input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
            </div>

            <div>
              <Label>Foto odómetro inicial</Label>
              <FileUpload bucket="vehicle-photos" folder={`usages/${vehicleId || "unknown"}/start`} signed onUpload={setStartPhoto} />
            </div>
            <div>
              <Label>Foto odómetro final</Label>
              <FileUpload bucket="vehicle-photos" folder={`usages/${vehicleId || "unknown"}/end`} signed onUpload={setEndPhoto} />
            </div>
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? "Guardando..." : "Registrar uso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
