import { useState, useMemo } from "react";
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

interface DriverOption {
  driverId: string | null;        // id en tabla drivers (si existe)
  userId: string;                 // user_id (siempre)
  name: string;
  assignedVehicleId: string | null;
  hasDriverRecord: boolean;
}

export function CrearViajeForm({ onSuccess, onCancel }: Props) {
  const [tripType, setTripType] = useState<string>("interurban_planned");
  // selectedDriverKey: prefijo "d:" para drivers, "u:" para user_roles sin ficha
  const [selectedDriverKey, setSelectedDriverKey] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [originBranchId, setOriginBranchId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [mainRoute, setMainRoute] = useState("");
  const [observations, setObservations] = useState("");
  const [creating, setCreating] = useState(false);

  // Choferes con ficha
  const { data: drivers } = useQuery({
    queryKey: ["active-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, user_id, assigned_vehicle_id, profiles:user_id(full_name)")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  // Usuarios con rol 'driver' (operador logístico) — para incluir los que aún no tienen ficha
  const { data: driverRoleUsers } = useQuery({
    queryKey: ["driver-role-users"],
    queryFn: async () => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "driver");
      if (rolesErr) throw rolesErr;
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (!ids.length) return [];
      const { data: profs, error: profsErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, is_active")
        .in("user_id", ids);
      if (profsErr) throw profsErr;
      return (profs ?? []).filter((p: any) => p.is_active !== false);
    },
  });

  const { data: vehicles } = useQuery({
    queryKey: ["active-vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, plate, brand, model")
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

  // Lista unificada de opciones de chofer (sin duplicados)
  const driverOptions = useMemo<DriverOption[]>(() => {
    const map = new Map<string, DriverOption>();
    (drivers ?? []).forEach((d: any) => {
      map.set(d.user_id, {
        driverId: d.id,
        userId: d.user_id,
        name: (d.profiles as any)?.full_name || "Sin nombre",
        assignedVehicleId: d.assigned_vehicle_id ?? null,
        hasDriverRecord: true,
      });
    });
    (driverRoleUsers ?? []).forEach((u: any) => {
      if (!map.has(u.user_id)) {
        map.set(u.user_id, {
          driverId: null,
          userId: u.user_id,
          name: u.full_name || "Sin nombre",
          assignedVehicleId: null,
          hasDriverRecord: false,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [drivers, driverRoleUsers]);

  const selectedDriver = driverOptions.find(d => {
    if (selectedDriverKey.startsWith("d:")) return d.driverId === selectedDriverKey.slice(2);
    if (selectedDriverKey.startsWith("u:")) return d.userId === selectedDriverKey.slice(2);
    return false;
  });

  // Resolución dinámica del vehículo a usar y motivo (para aviso UI)
  const vehicleResolution = useMemo(() => {
    if (vehicleId) {
      const v = vehicles?.find((x: any) => x.id === vehicleId);
      return { kind: "manual" as const, vehicle: v ?? null };
    }
    if (selectedDriver?.assignedVehicleId) {
      const v = vehicles?.find((x: any) => x.id === selectedDriver.assignedVehicleId);
      return { kind: "driver" as const, vehicle: v ?? null };
    }
    if (vehicles && vehicles.length > 0) {
      return { kind: "fallback" as const, vehicle: vehicles[0] };
    }
    return { kind: "none" as const, vehicle: null };
  }, [vehicleId, selectedDriver, vehicles]);

  const handleCreate = async () => {
    if (!selectedDriver) { toast.error("Seleccionar chofer"); return; }
    if (!originBranchId) { toast.error("Seleccionar punto de salida"); return; }
    if (!mainRoute.trim()) { toast.error("Indicar la ruta principal"); return; }
    if (!scheduledDate) { toast.error("Indicar fecha y hora prevista de salida"); return; }
    if (vehicleResolution.kind === "none") {
      toast.error("No hay vehículos activos en el sistema. Cargá al menos uno desde Flota.");
      return;
    }

    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Sesión expirada"); return; }

      // Si el chofer no tiene ficha, crearla automáticamente para no bloquear el alta
      let driverId = selectedDriver.driverId;
      if (!driverId) {
        const { data: newDriver, error: driverErr } = await supabase
          .from("drivers")
          .insert([{ user_id: selectedDriver.userId, is_active: true }])
          .select("id")
          .single();
        if (driverErr) throw driverErr;
        driverId = newDriver.id;
      }

      const effectiveVehicleId = vehicleResolution.vehicle?.id ?? null;
      if (!effectiveVehicleId) {
        toast.error("No hay vehículos activos en el sistema. Cargá al menos uno desde Flota.");
        return;
      }

      const destinationDescription = observations.trim()
        ? `${mainRoute.trim()} — Obs: ${observations.trim()}`
        : mainRoute.trim();

      const { data: trip, error } = await supabase
        .from("trips")
        .insert([{
          driver_id: driverId!,
          vehicle_id: effectiveVehicleId,
          origin_branch_id: originBranchId,
          trip_type: tripType as any,
          status: "planned",
          planned_departure: scheduledDate,
          destination_description: destinationDescription,
          created_by: user.id,
        }])
        .select()
        .single();

      if (error) throw error;

      await supabase.from("operational_events").insert({
        reference_type: "trip",
        reference_id: trip.id,
        event_type: "trip_planned",
        category: "logistics" as any,
        event_description: `Viaje #${trip.trip_number} planificado`,
        new_status: "planned",
        triggered_by: user.id,
        metadata: {
          trip_type: tripType,
          main_route: mainRoute.trim(),
          observations: observations.trim() || null,
        },
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
          <Label className="text-xs">Tipo de viaje *</Label>
          <Select value={tripType} onValueChange={setTripType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="interurban_planned">Interurbano</SelectItem>
              <SelectItem value="supplier_pickup">Retiro proveedor</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Punto de salida *</Label>
          <Select value={originBranchId} onValueChange={setOriginBranchId}>
            <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
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
          <Label className="text-xs">Ruta principal *</Label>
          <Input
            value={mainRoute}
            onChange={e => setMainRoute(e.target.value)}
            placeholder="Ej: Encarnación → Luque"
          />
          <p className="text-[10px] text-muted-foreground">
            Eje principal del recorrido (no necesariamente el único destino).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha y hora prevista de salida *</Label>
          <Input
            type="datetime-local"
            value={scheduledDate}
            onChange={e => setScheduledDate(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
          <Label className="text-xs">Vehículo <span className="text-muted-foreground">(opcional)</span></Label>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
            <SelectContent>
              {vehicles?.map((v: any) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.plate} {v.brand ? `— ${v.brand}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {vehicleResolution.kind === "driver" && vehicleResolution.vehicle && (
            <p className="text-[10px] text-muted-foreground">
              Si no seleccionás un vehículo, se usará el asignado al chofer:{" "}
              <span className="font-medium text-foreground">
                {vehicleResolution.vehicle.plate}
                {vehicleResolution.vehicle.brand ? ` — ${vehicleResolution.vehicle.brand}` : ""}
              </span>.
            </p>
          )}
          {vehicleResolution.kind === "fallback" && vehicleResolution.vehicle && (
            <p className="text-[10px] text-warning">
              ⚠ Si no seleccionás un vehículo, se asignará automáticamente:{" "}
              <span className="font-medium">
                {vehicleResolution.vehicle.plate}
                {vehicleResolution.vehicle.brand ? ` — ${vehicleResolution.vehicle.brand}` : ""}
              </span>.
            </p>
          )}
          {vehicleResolution.kind === "none" && (
            <p className="text-[10px] text-destructive">
              No hay vehículos activos disponibles. Cargá al menos uno desde Flota para crear el viaje.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Observaciones <span className="text-muted-foreground">(opcional)</span></Label>
        <Textarea
          value={observations}
          onChange={e => setObservations(e.target.value)}
          placeholder="Ej: retiro proveedor en trayecto, bajar reposición en Oviedo, entregar muestras antes de Luque..."
          className="h-20"
        />
      </div>

      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Las cargas (pedidos, transferencias, facturas) se asignan en el paso siguiente,
        desde el detalle del viaje.
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? "Creando..." : "Crear viaje"}
        </Button>
      </div>
    </div>
  );
}
