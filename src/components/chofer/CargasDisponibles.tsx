import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Package, CheckCircle2, AlertTriangle, XCircle, Truck, MapPin, Clock, FileWarning, FileCheck, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { BranchSelector } from "@/components/shared/BranchSelector";
import { DELIVERY_TARGET_LABELS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import { runDriverAction } from "@/lib/driver-actions";
import { useBranches } from "@/hooks/use-branches";

const REJECTION_REASONS = [
  { value: "no_space", label: "No entra en el móvil" },
  { value: "priority", label: "Prioricé otra carga" },
  { value: "not_ready", label: "No estaba realmente listo" },
  { value: "missing_bims", label: "Falta documento BIMS" },
  { value: "other", label: "Otro" },
];

const REQUEST_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  client: { label: "Cliente", className: "bg-primary/10 text-primary border-primary/20" },
  online: { label: "Online", className: "bg-accent/10 text-accent border-accent/20" },
  reposition: { label: "Reposición", className: "bg-muted text-muted-foreground border-border" },
  redistribution: { label: "Redistribución", className: "bg-secondary/10 text-secondary border-secondary/20" },
};

const DELIVERY_TARGET_BADGES: Record<string, { label: string; className: string }> = {
  client: { label: "Cliente", className: "bg-primary/10 text-primary border-primary/20" },
  branch: { label: "Reposición", className: "bg-muted text-muted-foreground border-border" },
};

/** Returns true if the fulfillment has at least one binding document */
function hasBindingDocument(f: any): boolean {
  return !!(f.bims_transfer_number || f.bims_invoice_number);
}

/** Returns a human-readable label for the missing document */
function missingDocLabel(f: any): string {
  const target = f.branch_request?.delivery_target;
  if (target === "client") return "Falta factura BIMS";
  return "Falta transferencia BIMS";
}

export function CargasDisponibles() {
  const queryClient = useQueryClient();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [hubModalRowId, setHubModalRowId] = useState<string | null>(null);
  const [hubBranchId, setHubBranchId] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const { data: allBranches } = useBranches();
  const hubBranches = (allBranches || []).filter((b: any) => b.is_central_warehouse);

  // ── Driver record ──
  const { data: myDriver } = useQuery({
    queryKey: ["my-driver-record"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("drivers").select("id, assigned_branch_id").eq("user_id", user.id).single();
      return data;
    },
  });

  // Set default branch once driver loads
  const effectiveBranchId = selectedBranchId || myDriver?.assigned_branch_id || "";

  // ── Active trip ──
  const { data: myActiveTrip } = useQuery({
    queryKey: ["my-active-trip", myDriver?.id],
    queryFn: async () => {
      if (!myDriver?.id) return null;
      const { data } = await supabase
        .from("trips")
        .select("id, trip_number, trip_type, origin_branch_id")
        .eq("driver_id", myDriver.id)
        .eq("status", "in_progress" as any)
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!myDriver?.id,
  });

  // ── A) Loads assigned to my trip ──
  const { data: assignedLoads } = useQuery({
    queryKey: ["assigned-loads", myActiveTrip?.id],
    queryFn: async () => {
      if (!myActiveTrip?.id) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, request_type, delivery_target)`)
        .eq("trip_id", myActiveTrip.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!myActiveTrip?.id,
  });

  // ── B) Available loads at selected branch ──
  // Trae todos los fulfillments de la sucursal sin trip asignado, y filtra en cliente
  // por estados operativos del fulfillment O por branch_request en 'ready_for_pickup'.
  const { data: availableLoads } = useQuery({
    queryKey: ["available-loads", effectiveBranchId],
    queryFn: async () => {
      if (!effectiveBranchId) return [];
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select(`*, source_branch:branches!fulfillment_orders_source_branch_id_fkey(name, code, is_central_warehouse), destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name, code), branch_request:branch_requests(request_number, request_type, delivery_target, status, flow_type)`)
        .eq("source_branch_id", effectiveBranchId)
        .is("trip_id", null)
        .in("status", ["pending", "waiting_for_cut", "waiting_for_courier", "picking"])
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      // Si status=pending, exigir branch_request.status = 'ready_for_pickup'
      // y excluir el caso hub-aware interurbano, porque debe entrar directo a consolidación.
      return (data || []).filter((f: any) => {
        const isHubOriginInterurbanReady =
          f.status === "pending" &&
          f.branch_request?.status === "ready_for_pickup" &&
          f.branch_request?.flow_type === "interurban" &&
          f.source_branch?.is_central_warehouse === true;

        if (isHubOriginInterurbanReady) return false;
        if (f.status === "pending") return f.branch_request?.status === "ready_for_pickup";
        return true;
      });
    },
    enabled: !!effectiveBranchId,
  });

  // Considera "listo para retirar" si tiene documentos BIMS O si el pedido ya fue marcado como ready_for_pickup
  const isReadyForPickup = (f: any) =>
    hasBindingDocument(f) || f.branch_request?.status === "ready_for_pickup";

  // ── B.2) Pedidos en 'ready_for_pickup' SIN fulfillment_order todavía ──
  // Algunos pedidos llegan a ready_for_pickup sin FO creado (flujos urbanos
  // desde depósitos centrales). El módulo Pedidos los muestra porque lee de
  // branch_requests; aquí los traemos para que el chofer también los vea.
  const { data: readyRequestsNoFo } = useQuery({
    queryKey: ["ready-requests-no-fo", effectiveBranchId],
    queryFn: async () => {
      if (!effectiveBranchId) return [];
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`id, request_number, request_type, delivery_target, status, flow_type, client_name, client_address, source_branch_id, requesting_branch_id, created_at, source_branch:branches!branch_requests_source_branch_id_fkey(name, code, is_central_warehouse), destination_branch:branches!branch_requests_requesting_branch_id_fkey(name, code)`)
        .eq("source_branch_id", effectiveBranchId)
        .eq("status", "ready_for_pickup" as any)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      // Excluir los que ya tienen FO (vendrán por la query principal)
      const ids = (data || []).map((r: any) => r.id);
      if (ids.length === 0) return [];
      const { data: existing } = await supabase
        .from("fulfillment_orders")
        .select("branch_request_id")
        .in("branch_request_id", ids);
      const withFo = new Set((existing || []).map((f: any) => f.branch_request_id));
      return (data || []).filter((r: any) => !withFo.has(r.id));
    },
    enabled: !!effectiveBranchId,
  });

  // Adapta un branch_request al shape que espera FulfillmentRow
  const adaptRequestToRow = (r: any) => ({
    id: `req:${r.id}`,                       // prefijo para distinguir
    __isRequestOnly: true,
    __requestId: r.id,
    status: "ready_for_pickup",
    created_at: r.created_at,
    source_branch: r.source_branch,
    destination_branch: r.destination_branch,
    destination_client_name: r.client_name,
    destination_client_address: r.client_address,
    bims_transfer_number: null,
    bims_invoice_number: null,
    package_count: 0,
    shipping_method: null,
    branch_request: {
      request_number: r.request_number,
      request_type: r.request_type,
      delivery_target: r.delivery_target,
      status: r.status,
      flow_type: r.flow_type,
    },
  });

  // Split into ready vs pending-docs
  const readyLoadsFromFo = availableLoads?.filter(isReadyForPickup) || [];
  const readyLoads = [
    ...readyLoadsFromFo,
    ...((readyRequestsNoFo || []).map(adaptRequestToRow)),
  ];
  const pendingDocsLoads = availableLoads?.filter((f: any) => !isReadyForPickup(f)) || [];

  // ── Rejection events ──
  const { data: rejectionEvents } = useQuery({
    queryKey: ["rejection-events-recent"],
    queryFn: async () => {
      const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("operational_events")
        .select("reference_id, created_at, metadata")
        .eq("event_type", "driver_pickup_rejected")
        .gte("created_at", since)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rejectionByFulfillment: Record<string, { at: string; reason: string }> = {};
  rejectionEvents?.forEach((e: any) => {
    if (!rejectionByFulfillment[e.reference_id]) {
      rejectionByFulfillment[e.reference_id] = { at: e.created_at, reason: e.metadata?.rejection_reason || "" };
    }
  });

  // ── C) Out-of-cutoff events ──
  const { data: outOfCutoffEvents } = useQuery({
    queryKey: ["out-of-cutoff-events"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("event_type", "driver_pickup")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data?.filter((e: any) => e.metadata?.out_of_cutoff === true) || [];
    },
  });

  // ── Actions ──
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["assigned-loads"] });
    queryClient.invalidateQueries({ queryKey: ["available-loads"] });
    queryClient.invalidateQueries({ queryKey: ["ready-requests-no-fo"] });
    queryClient.invalidateQueries({ queryKey: ["out-of-cutoff-events"] });
    queryClient.invalidateQueries({ queryKey: ["rejection-events-recent"] });
    queryClient.invalidateQueries({ queryKey: ["my-custody-loads"] });
    queryClient.invalidateQueries({ queryKey: ["custody-count"] });
    queryClient.invalidateQueries({ queryKey: ["hub-loads"] });
    queryClient.invalidateQueries({ queryKey: ["hub-count"] });
  };

  const pickupOutOfCutoff = async (rowId: string) => {
    try {
      // Caso A: fila proviene de un branch_request sin FO. Se transiciona el
      // pedido a in_transit (mismo flujo que el módulo Pedidos), lo cual crea
      // automáticamente el fulfillment_order. No se llama fn_driver_action.
      if (rowId.startsWith("req:")) {
        const requestId = rowId.slice(4);
        const { error } = await supabase.rpc("fn_transition_request_status", {
          p_request_id: requestId,
          p_new_status: "in_transit",
          p_reason: "Retiro realizado por chofer",
          p_rejection_reason_type: null,
          p_trip_id: myActiveTrip?.id ?? null,
        });
        if (error) throw error;
        toast.success("Retiro confirmado");
        invalidateAll();
        return;
      }

      // Caso B: fila proviene de fulfillment_orders (flujo original intacto).
      const { data, error } = await runDriverAction({
        action: "pickup",
        fulfillmentId: rowId,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.success) {
        toast.success(myActiveTrip ? "Retiro confirmado" : "Retiro confirmado (fuera de corte)");
        invalidateAll();
      } else {
        toast.error(result?.error || "Error al retirar");
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const rejectPickup = async (rowId: string, reason: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const isRequest = rowId.startsWith("req:");
      const refId = isRequest ? rowId.slice(4) : rowId;
      const refType = isRequest ? "branch_request" : "fulfillment_order";
      const reasonLabel = REJECTION_REASONS.find(r => r.value === reason)?.label || reason;

      await supabase.from("operational_events").insert({
        reference_type: refType,
        reference_id: refId,
        event_type: "driver_pickup_rejected",
        category: "logistics" as any,
        event_description: `Chofer rechazó retiro: ${reasonLabel}`,
        triggered_by: user.id,
        metadata: { rejection_reason: reason, source: refType },
      });
      await supabase.from("ai_anomalies").insert({
        anomaly_type: "driver_pickup_rejected",
        area: "logistics" as any,
        severity: "warning" as any,
        alert_level: "branch_operational" as any,
        title: "Chofer rechazó retiro de carga",
        description: `Motivo: ${reasonLabel}`,
        affected_entities: [{ type: refType, id: refId }],
      });
      toast.info("Carga rechazada — queda disponible para próximo corte");
      setRejectingId(null);
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Toma la carga y la deja en acopio en una sola acción.
  // Para request-only, primero crea el FO transicionando a in_transit,
  // luego ejecuta drop_at_hub sobre el FO recién creado.
  const sendToHub = async (rowId: string, hubId: string) => {
    try {
      let fulfillmentId = rowId;

      if (rowId.startsWith("req:")) {
        const requestId = rowId.slice(4);
        const { error: trErr } = await supabase.rpc("fn_transition_request_status", {
          p_request_id: requestId,
          p_new_status: "in_transit",
          p_reason: "Retiro hacia acopio",
          p_rejection_reason_type: null,
          p_trip_id: myActiveTrip?.id ?? null,
        });
        if (trErr) throw trErr;
        const { data: fo, error: foErr } = await supabase
          .from("fulfillment_orders")
          .select("id")
          .eq("branch_request_id", requestId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (foErr || !fo) throw foErr || new Error("No se pudo localizar la carga creada");
        fulfillmentId = fo.id;
      } else {
        const { data: pkData, error: pkErr } = await runDriverAction({
          action: "pickup",
          fulfillmentId,
          tripId: myActiveTrip?.id ?? null,
        });
        if (pkErr) throw pkErr;
        if (!(pkData as any)?.success) throw new Error((pkData as any)?.error || "Error al retirar");
      }

      const { data, error } = await runDriverAction({
        action: "drop_at_hub",
        fulfillmentId,
        tripId: myActiveTrip?.id ?? null,
        metadata: { hub_branch_id: hubId, observation: "Enviado directo a acopio" },
      });
      if (error) throw error;
      if (!(data as any)?.success) throw new Error((data as any)?.error || "Error al dejar en acopio");

      toast.success("Carga enviada a acopio");
      setHubModalRowId(null);
      setHubBranchId("");
      invalidateAll();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const isMissedCutoff = (f: any) => {
    const hoursOld = (Date.now() - new Date(f.created_at).getTime()) / (1000 * 60 * 60);
    return hoursOld > 4 && (f.status === "waiting_for_cut" || f.status === "waiting_for_courier");
  };

  const getTypeBadge = (f: any) => {
    const reqType = f.branch_request?.request_type;
    const target = f.branch_request?.delivery_target;
    if (reqType && REQUEST_TYPE_BADGES[reqType]) return REQUEST_TYPE_BADGES[reqType];
    if (target && DELIVERY_TARGET_BADGES[target]) return DELIVERY_TARGET_BADGES[target];
    return { label: "Transferencia", className: "bg-muted text-muted-foreground border-border" };
  };

  // ── Row components ──
  const FulfillmentRow = ({ f, showPickup = true }: { f: any; showPickup?: boolean }) => {
    const typeBadge = getTypeBadge(f);
    const missedCutoff = isMissedCutoff(f);
    const rejection = rejectionByFulfillment[f.id];

    return (
      <div className={`flex items-center justify-between p-3 text-sm ${missedCutoff ? "bg-destructive/5" : ""}`}>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
              <span className="text-muted-foreground">→ {f.destination_branch?.name || f.destination_client_name || "—"}</span>
              <Badge variant="outline" className={`text-xs ${typeBadge.className}`}>{typeBadge.label}</Badge>
              {missedCutoff && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="h-3 w-3" /> Perdió corte
                </Badge>
              )}
              {rejection && (
                <Badge variant="outline" className="text-xs text-destructive border-destructive/30 gap-1">
                  <XCircle className="h-3 w-3" /> Rechazado
                  <span className="text-muted-foreground ml-1">
                    {new Date(rejection.at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {f.bims_transfer_number && <Badge variant="outline" className="text-xs">T: {f.bims_transfer_number}</Badge>}
          {f.bims_invoice_number && <Badge variant="outline" className="text-xs">F: {f.bims_invoice_number}</Badge>}
          {(f.branch_request?.delivery_target === "client" || f.shipping_method === "courier") && f.package_count > 0 && (
            <Badge variant="secondary" className="text-xs">{f.package_count} bultos</Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {f.status === "waiting_for_cut" ? "Esperando corte" : f.status === "waiting_for_courier" ? "Esperando transporte" : f.status === "dispatched" ? "Retirado" : f.status === "ready_for_pickup" ? "Listo para retiro" : f.status}
          </Badge>
          {showPickup && (
            <>
              <Button size="sm" variant="outline" onClick={() => setRejectingId(f.id)} className="h-7 text-xs text-destructive">
                <XCircle className="h-3 w-3 mr-1" /> Rechazar
              </Button>
              {hubBranches.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setHubBranchId(hubBranches[0]?.id || "");
                    setHubModalRowId(f.id);
                  }}
                  className="h-7 text-xs gap-1"
                  title="Retirar y dejar en acopio"
                >
                  <Warehouse className="h-3 w-3" /> A acopio
                </Button>
              )}
              <Button size="sm" onClick={() => pickupOutOfCutoff(f.id)} className="h-7 text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" /> Retirar
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  const PendingDocRow = ({ f }: { f: any }) => {
    const typeBadge = getTypeBadge(f);
    return (
      <div className="flex items-center justify-between p-3 text-sm bg-secondary/5">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Pedido #{f.branch_request?.request_number || "—"}</span>
              <span className="text-muted-foreground">→ {f.destination_branch?.name || f.destination_client_name || "—"}</span>
              <Badge variant="outline" className={`text-xs ${typeBadge.className}`}>{typeBadge.label}</Badge>
              <Badge variant="outline" className="text-xs text-secondary border-secondary/30 gap-1">
                <FileWarning className="h-3 w-3" /> {missingDocLabel(f)}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs">
            {f.status === "waiting_for_cut" ? "Esperando corte" : f.status === "waiting_for_courier" ? "Esperando transporte" : f.status}
          </Badge>
          <Button size="sm" disabled className="h-7 text-xs gap-1 opacity-50">
            <XCircle className="h-3 w-3" /> Sin documento
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Branch selector */}
      <BranchSelector
        value={effectiveBranchId}
        onChange={setSelectedBranchId}
        label="Sucursal actual"
      />

      {!myActiveTrip && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/10 border border-secondary/20 text-sm">
          <AlertTriangle className="h-4 w-4 text-secondary shrink-0" />
          <span>Sin corte/viaje activo. Los retiros se registran como <strong>movimiento fuera de corte</strong>.</span>
        </div>
      )}

      {/* A) Assigned to my trip */}
      {myActiveTrip && (
        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" />
              Asignadas a mi viaje #{myActiveTrip.trip_number}
              <Badge variant="default" className="text-xs">{assignedLoads?.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!assignedLoads?.length ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Sin cargas asignadas a este viaje</div>
            ) : (
              <div className="divide-y divide-border/50">
                {assignedLoads.map((f: any) => <FulfillmentRow key={f.id} f={f} showPickup={false} />)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* B) Ready for pickup */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="font-display text-base flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-primary" />
            Listos para retirar
            <Badge variant="default" className="text-xs">{readyLoads.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!readyLoads.length ? (
            <div className="p-4 text-center text-muted-foreground text-sm">
              <Package className="h-6 w-6 mx-auto mb-1 opacity-50" />
              No hay cargas listas para retiro
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {readyLoads.map((f: any) => <FulfillmentRow key={f.id} f={f} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* C) Pending documents */}
      {pendingDocsLoads.length > 0 && (
        <Card className="glass-card border-secondary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-secondary" />
              Pendientes documentales
              <Badge variant="outline" className="text-xs text-secondary border-secondary/30">{pendingDocsLoads.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {pendingDocsLoads.map((f: any) => <PendingDocRow key={f.id} f={f} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* D) Out-of-cutoff events */}
      {(outOfCutoffEvents?.length ?? 0) > 0 && (
        <Card className="glass-card border-secondary/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-secondary" />
              Movimientos fuera de corte (24h)
              <Badge variant="outline" className="text-xs">{outOfCutoffEvents?.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/50">
              {outOfCutoffEvents?.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <span className="font-medium">{e.event_description}</span>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {new Date(e.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs text-secondary border-secondary/30">Fuera de corte</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rejection dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Motivo del rechazo</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {REJECTION_REASONS.map((r) => (
              <Button
                key={r.value}
                variant="outline"
                className="w-full justify-start text-sm h-auto py-3"
                onClick={() => rejectingId && rejectPickup(rejectingId, r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
