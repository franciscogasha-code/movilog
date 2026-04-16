import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface Props {
  onSuccess: (tripId: string) => void;
  onCancel: () => void;
}

export function CrearViajeForm({ onSuccess, onCancel }: Props) {
  const [tripType, setTripType] = useState<string>("interurban_planned");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [originBranchId, setOriginBranchId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [destDescription, setDestDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: drivers } = useQuery({
    queryKey: ["active-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, user_id, assigned_vehicle_id, assigned_branch_id, profiles:user_id(full_name)")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: vehicles } = useQuery({
    queryKey: ["active-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, plate_number, brand, model")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: branches } = useQuery({
    queryKey: ["all-branches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-fill vehicle when driver selected
  const selectedDriver = drivers?.find(d => d.id === driverId);

  const handleCreate = async () => {
    if (!driverId) { toast.error("Seleccionar chofer"); return; }
    if (!originBranchId) { toast.error("Seleccionar sucursal de origen"); return; }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sesión expirada"); return; }

      const effectiveVehicleId = vehicleId || selectedDriver?.assigned_vehicle_id;

      const { data: trip, error } = await supabase
        .from("trips")
        .insert({
          driver_id: driverId,
          vehicle_id: effectiveVehicleId || null,
          origin_branch_id: originBranchId,
          trip_type: tripType as any,
          status: "planned" as any,
          scheduled_departure: scheduledDate || null,
          destination_description: destDescription || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Log event
      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: trip.id,
        event_type: "trip_planned",
        category: "logistics" as any,
        event_description: `Viaje #${trip.trip_number} planificado`,
        new_status: "planned",
        triggered_by: user.id,
        metadata: { trip_type: tripType, destination_description: destDescription },
      });

      toast.success(`Viaje #${trip.trip_number} creado`);
      onSuccess(trip.id);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de viaje</Label>
          <Select value={tripType} onValueChange={setTripType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="interurban_planned">Interurbano</SelectItem>
              <SelectItem value="supplier_pickup">Retiro proveedor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Origen</Label>
          <Select value={originBranchId} onValueChange={setOriginBranchId}>
            <SelectTrigger><SelectValue placeholder="Sucursal..." /></SelectTrigger>
            <SelectContent>
              {branches?.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Chofer</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
            <SelectContent>
              {drivers?.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>
                  {(d.profiles as any)?.full_name || "Sin nombre"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Vehículo</Label>
          <Select value={vehicleId || selectedDriver?.assigned_vehicle_id || ""} onValueChange={setVehicleId}>
            <SelectTrigger><SelectValue placeholder="Automático..." /></SelectTrigger>
            <SelectContent>
              {vehicles?.map((v: any) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.plate_number} {v.brand ? `— ${v.brand}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha/hora prevista</Label>
          <Input type="datetime-local" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Destino / Descripción</Label>
          <Input value={destDescription} onChange={e => setDestDescription(e.target.value)} placeholder="Proveedor, ciudad..." />
        </div>
      </div>

      {tripType === "supplier_pickup" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Detalle del retiro</Label>
          <Textarea placeholder="Dirección del proveedor, contacto, instrucciones..." className="h-20" />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? "Creando..." : "Crear viaje"}
        </Button>
      </div>
    </div>
  );
}
