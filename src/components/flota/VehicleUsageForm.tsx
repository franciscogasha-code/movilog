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
  const { user, profile } = useAuth();

  const [vehicleId, setVehicleId] = useState<string>(presetVehicleId ?? "");
  const [categoryId, setCategoryId] = useState<string>("");
  const [destination, setDestination] = useState("");
  const [startMileage, setStartMileage] = useState<string>("");
  const [endMileage, setEndMileage] = useState<string>("");
  const [startedAt, setStartedAt] = useState<string>("");
  const [endedAt, setEndedAt] = useState<string>("");
  const [startPhoto, setStartPhoto] = useState<string>("");
  const [endPhoto, setEndPhoto] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => { if (presetVehicleId) setVehicleId(presetVehicleId); }, [presetVehicleId]);

  // Auto-fill start/end datetime when odometer photos are uploaded
  useEffect(() => {
    if (startPhoto && !startedAt) {
      setStartedAt(new Date().toISOString().slice(0, 16));
    }
  }, [startPhoto, startedAt]);

  useEffect(() => {
    if (endPhoto && !endedAt) {
      setEndedAt(new Date().toISOString().slice(0, 16));
    }
  }, [endPhoto, endedAt]);

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

  const { data: myDriver } = useQuery({
    queryKey: ["my-driver", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("drivers").select("id").eq("user_id", user!.id).eq("is_active", true).maybeSingle();
      return data;
    },
  });

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
      if (!categoryId) throw new Error("La categoría es obligatoria");
      if (!destination.trim()) throw new Error("El destino es obligatorio");
      if (!startMileage) throw new Error("Kilometraje inicial requerido");
      if (!endMileage) throw new Error("Kilometraje final requerido");
      if (!startPhoto) throw new Error("Foto del odómetro inicial requerida");
      if (!endPhoto) throw new Error("Foto del odómetro final requerida");
      if (!startedAt) throw new Error("Fecha de inicio requerida");
      if (!endedAt) throw new Error("Fecha de fin requerida");
      const payload: any = {
        vehicle_id: vehicleId,
        driver_id: myDriver?.id ?? null,
        driver_name_text: myDriver?.id ? null : (profile?.full_name ?? null),
        category_id: categoryId,
        destination: destination.trim(),
        start_mileage: startNum,
        end_mileage: endNum,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        start_odometer_photo_path: startPhoto,
        end_odometer_photo_path: endPhoto,
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
      setEndMileage(""); setStartMileage(""); setDestination(""); setNotes("");
      setStartPhoto(""); setEndPhoto(""); setStartedAt(""); setEndedAt("");
      setCategoryId("");
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
              <Label>Chofer *</Label>
              <Input value={profile?.full_name ?? ""} readOnly disabled />
              <p className="text-xs text-muted-foreground mt-1">Se asigna automáticamente al usuario en sesión</p>
            </div>

            <div>
              <Label>Categoría *</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                <SelectContent>
                  {cats?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Destino *</Label>
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
              <Label>Km final *</Label>
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
              <Label>Foto odómetro inicial *</Label>
              <FileUpload bucket="vehicle-photos" folder={`usages/${vehicleId || "unknown"}/start`} signed onUpload={setStartPhoto} />
              <p className="text-xs text-muted-foreground mt-1">La fecha de inicio se completa al subir la foto</p>
            </div>
            <div>
              <Label>Foto odómetro final *</Label>
              <FileUpload bucket="vehicle-photos" folder={`usages/${vehicleId || "unknown"}/end`} signed onUpload={setEndPhoto} />
              <p className="text-xs text-muted-foreground mt-1">La fecha de fin se completa al subir la foto</p>
            </div>

            <div>
              <Label>Inicio *</Label>
              <Input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} readOnly disabled />
            </div>
            <div>
              <Label>Fin *</Label>
              <Input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} readOnly disabled />
            </div>
          </div>

          <div>
            <Label>Observaciones</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
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
