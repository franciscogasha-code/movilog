import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X } from "lucide-react";

interface DriverOption {
  driverId: string | null;
  userId: string;
  name: string;
  assignedVehicleId: string | null;
  hasDriverRecord: boolean;
}

interface Props {
  trip: any;
  onSuccess: () => void;
  onCancel: () => void;
}

// Convierte un timestamptz ISO a 'YYYY-MM-DDTHH:mm' usable en datetime-local
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditarViajeForm({ trip, onSuccess, onCancel }: Props) {
  // Estado inicial desde el viaje
  const initialDriverKey = trip?.driver?.id ? `d:${trip.driver.id}` : "";
  const initialVehicleId: string = trip?.vehicle_id || "";
  const initialDeparture = toLocalInput(trip?.planned_departure);
  const initialDescription: string = trip?.destination_description || "";

  const [selectedDriverKey, setSelectedDriverKey] = useState(initialDriverKey);
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [clearVehicle, setClearVehicle] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(initialDeparture);
  const [destinationDescription, setDestinationDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);

  // Si el viaje cambia (cambio de tripId), resetear campos
  useEffect(() => {
    setSelectedDriverKey(trip?.driver?.id ? `d:${trip.driver.id}` : "");
    setVehicleId(trip?.vehicle_id || "");
    setClearVehicle(false);
    setScheduledDate(toLocalInput(trip?.planned_departure));
    setDestinationDescription(trip?.destination_description || "");
  }, [trip?.id]);

  const { data: rawDriverOptions = [] } = useQuery<DriverOption[]>({
    queryKey: ["trip-eligible-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("trip-eligible-drivers");
      if (error) throw error;
      return ((data?.drivers ?? []) as DriverOption[]).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["active-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, plate, brand, model")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const driverOptions = useMemo(() => {
    const currentDriverId = trip?.driver_id || trip?.driver?.id;
    const currentUserId = trip?.driver_user_id || trip?.driver?.user_id || "";
    const currentName = trip?.driver_name;
    if (!currentDriverId || rawDriverOptions.some((d) => d.driverId === currentDriverId)) {
      return rawDriverOptions;
    }
    return [
      {
        driverId: currentDriverId,
        userId: currentUserId,
        name: currentName || "Chofer actual",
        assignedVehicleId: null,
        hasDriverRecord: true,
      },
      ...rawDriverOptions,
    ];
  }, [rawDriverOptions, trip?.driver_id, trip?.driver?.id, trip?.driver_user_id, trip?.driver?.user_id, trip?.driver_name]);

  const selectedDriver = useMemo(() => {
    return driverOptions.find(d => {
      if (selectedDriverKey.startsWith("d:")) return d.driverId === selectedDriverKey.slice(2);
      if (selectedDriverKey.startsWith("u:")) return d.userId === selectedDriverKey.slice(2);
      return false;
    });
  }, [driverOptions, selectedDriverKey]);

  const handleSave = async () => {
    if (!selectedDriver) {
      toast.error("Seleccionar chofer");
      return;
    }
    if (!scheduledDate) {
      toast.error("Indicar fecha y hora prevista de salida");
      return;
    }

    setSaving(true);
    try {
      // Asegurar driverId si el operador no tenía ficha previa
      let driverId = selectedDriver.driverId;
      if (!driverId) {
        const { data: ensuredId, error: ensureErr } = await supabase
          .rpc("fn_ensure_driver_for_user", { _user_id: selectedDriver.userId });
        if (ensureErr) throw ensureErr;
        driverId = ensuredId as string;
      }

      // Convertir datetime-local a ISO con zona local
      const newDeparture = new Date(scheduledDate).toISOString();

      const { data, error } = await supabase.rpc("fn_edit_trip" as any, {
        p_trip_id: trip.id,
        p_driver_id: driverId,
        p_vehicle_id: clearVehicle ? null : (vehicleId || null),
        p_clear_vehicle: clearVehicle,
        p_planned_departure: newDeparture,
        p_destination_description: destinationDescription.trim() || null,
      });
      if (error) throw error;

      const result = data as any;
      if (result?.changed === false) {
        toast.info("No se detectaron cambios");
      } else {
        toast.success("Viaje actualizado");
      }
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        Editás el viaje <span className="font-mono font-semibold text-foreground">#{trip.trip_number}</span>.
        Los cambios quedan registrados con tu usuario y la fecha actual.
      </div>

      {/* Sección General */}
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Chofer *</Label>
            <Select value={selectedDriverKey} onValueChange={setSelectedDriverKey}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {driverOptions.map(d => {
                  const key = d.driverId ? `d:${d.driverId}` : `u:${d.userId}`;
                  return (
                    <SelectItem key={key} value={key}>
                      {d.name}{!d.hasDriverRecord ? " (operador logístico)" : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Salida prevista *</Label>
            <Input
              type="datetime-local"
              value={scheduledDate}
              onChange={e => setScheduledDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Vehículo <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <div className="flex gap-2">
            <Select
              value={clearVehicle ? "" : vehicleId}
              onValueChange={(v) => { setVehicleId(v); setClearVehicle(false); }}
              disabled={clearVehicle}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={clearVehicle ? "Sin vehículo" : "Sin asignar"} />
              </SelectTrigger>
              <SelectContent>
                {vehicles.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.plate} {v.brand ? `— ${v.brand}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(vehicleId || trip?.vehicle_id) && !clearVehicle && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => { setClearVehicle(true); setVehicleId(""); }}
                title="Quitar vehículo del viaje"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            {clearVehicle && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setClearVehicle(false)}
              >
                Deshacer
              </Button>
            )}
          </div>
          {clearVehicle && (
            <p className="text-[10px] text-muted-foreground">
              El viaje quedará <span className="font-medium text-foreground">sin vehículo asignado</span>.
            </p>
          )}
        </div>
      </div>

      {/* Sección Operativa */}
      <div className="space-y-1.5">
        <Label className="text-xs">Ruta / Observaciones</Label>
        <Textarea
          value={destinationDescription}
          onChange={e => setDestinationDescription(e.target.value)}
          placeholder="Ej: Encarnación → Luque — Obs: pasar por Coronel Oviedo"
          className="h-24"
        />
        <p className="text-[10px] text-muted-foreground">
          Describí ruta principal y observaciones operativas relevantes.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}
