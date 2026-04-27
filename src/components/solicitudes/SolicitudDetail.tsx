import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { RequestProgressBar } from "@/components/solicitudes/RequestProgressBar";
import { RequestDocuments } from "@/components/solicitudes/RequestDocuments";
import { DemandAlert } from "@/components/solicitudes/DemandAlert";
import { useLiveStock } from "@/hooks/use-live-stock";
import {
  REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS,
  ITEM_PURPOSE_LABELS, REJECTION_REASONS, REQUEST_TYPE_LABELS, FULFILLMENT_STATUS_CONFIG,
} from "@/lib/constants";
import { proxyImageUrl } from "@/lib/image-utils";
import { Package, ImageOff, AlertTriangle, Check, X, Loader2, Truck, ClipboardList, FileSpreadsheet, Download, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ParentRequestSummary } from "@/components/solicitudes/ParentRequestSummary";
import { useNavigate } from "react-router-dom";

// Small helper to resolve operational responsible name
function OperationalResponsibleName({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["profile-name", userId],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
      return data?.full_name || "—";
    },
  });
  return (
    <div>
      <span className="text-muted-foreground">Resp. operativo:</span>{" "}
      <span className="font-medium">{data || "..."}</span>
    </div>
  );
}

// Miniatura de producto: imagen real con fallback discreto
function ProductThumb({ url, alt }: { url?: string | null; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const safeUrl = url ? proxyImageUrl(url) : null;
  if (!safeUrl || failed) {
    return (
      <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-md bg-muted/60 border border-border/40 flex items-center justify-center shrink-0">
        <ImageOff className="h-4 w-4 text-muted-foreground/60" aria-hidden />
      </div>
    );
  }
  return (
    <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-md bg-muted/30 border border-border/40 overflow-hidden shrink-0">
      <img
        src={safeUrl}
        alt={alt || "Producto"}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

// ─── Action definitions per status ───────────────────────────────────
type ActionDef = {
  label: string;
  newStatus: string;
  variant: "default" | "destructive" | "outline";
  icon: React.ReactNode;
  actor: "origin" | "destination" | "admin" | "driver";
  requiresReason?: boolean;
};

function getStatusActions(status: string, flowType?: string | null): ActionDef[] {
  // Common: pending actions for all flows
  // "Aceptar" ejecuta atómicamente pending → accepted → in_preparation (una sola acción visible).
  if (status === "pending") {
    return [
      { label: "Aceptar", newStatus: "in_preparation", variant: "default", icon: <Check className="h-4 w-4" />, actor: "origin" },
      { label: "Rechazar", newStatus: "rejected", variant: "destructive", icon: <X className="h-4 w-4" />, actor: "origin", requiresReason: true },
    ];
  }

  // Fallback: si por algún motivo quedó en accepted, permitir avanzar manualmente.
  if (status === "accepted") {
    return [
      { label: "Preparar", newStatus: "in_preparation", variant: "default", icon: <Package className="h-4 w-4" />, actor: "origin" },
    ];
  }

  // Legacy flow (no flow_type)
  if (!flowType) {
    switch (status) {
      case "in_preparation":
        return [{ label: "Enviar a tránsito", newStatus: "in_transit", variant: "default", icon: <Truck className="h-4 w-4" />, actor: "origin" }];
      case "in_transit":
        return [{ label: "Confirmar entrega", newStatus: "delivered", variant: "default", icon: <Check className="h-4 w-4" />, actor: "driver" }];
      case "delivered":
        return [{ label: "Confirmar recepción", newStatus: "received", variant: "default", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      case "received":
        return [{ label: "Cierre logístico", newStatus: "logistic_closed", variant: "outline", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      default:
        return [];
    }
  }

  // client_delivery flow
  if (flowType === "client_delivery") {
    switch (status) {
      case "in_preparation":
        return [{ label: "Listo para entrega", newStatus: "ready_for_delivery", variant: "default", icon: <Package className="h-4 w-4" />, actor: "origin" }];
      case "ready_for_delivery":
        return [{ label: "Confirmar entrega a tercero", newStatus: "delivered_to_third_party", variant: "default", icon: <Check className="h-4 w-4" />, actor: "origin" }];
      default:
        return [];
    }
  }

  // urban flow
  if (flowType === "urban") {
    switch (status) {
      case "in_preparation":
        return [{ label: "Listo para retiro", newStatus: "ready_for_pickup", variant: "default", icon: <Package className="h-4 w-4" />, actor: "origin" }];
      // ready_for_pickup → in_transit handled by driver (fn_driver_action)
      case "in_transit":
        return [{ label: "Confirmar entrega", newStatus: "delivered", variant: "default", icon: <Check className="h-4 w-4" />, actor: "driver" }];
      case "delivered":
        return [{ label: "Confirmar recepción", newStatus: "received", variant: "default", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      case "received":
        return [{ label: "Cierre logístico", newStatus: "logistic_closed", variant: "outline", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      default:
        return [];
    }
  }

  // interurban flow
  if (flowType === "interurban") {
    switch (status) {
      case "in_preparation":
        return [{ label: "Listo para retiro", newStatus: "ready_for_pickup", variant: "default", icon: <Package className="h-4 w-4" />, actor: "origin" }];
      // ready_for_pickup → in_consolidation handled by driver (fn_driver_action)
      case "in_consolidation":
        return [{ label: "Asignar a viaje", newStatus: "assigned_to_trip", variant: "default", icon: <Truck className="h-4 w-4" />, actor: "admin" }];
      case "assigned_to_trip":
        return [{ label: "Iniciar tránsito", newStatus: "in_transit", variant: "default", icon: <Truck className="h-4 w-4" />, actor: "driver" }];
      case "in_transit":
        return [{ label: "Confirmar entrega", newStatus: "delivered", variant: "default", icon: <Check className="h-4 w-4" />, actor: "driver" }];
      case "delivered":
        return [{ label: "Confirmar recepción", newStatus: "received", variant: "default", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      case "received":
        return [{ label: "Cierre logístico", newStatus: "logistic_closed", variant: "outline", icon: <Check className="h-4 w-4" />, actor: "destination" }];
      default:
        return [];
    }
  }

  return [];
}

export function SolicitudDetail({ requestId, onUpdate }: { requestId: string; onUpdate: () => void }) {
  const { hasBranch, hasRole, isOwner } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [transitioning, setTransitioning] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionReasonType, setRejectionReasonType] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showTripSelector, setShowTripSelector] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState("");

  // Detección formal de padre: tiene hijos apuntándolo (parent_request_id).
  // Si es padre, no se exponen acciones operativas (defensa frontend; backend ya bloquea via RPC).
  const { data: childCount = 0 } = useQuery({
    queryKey: ["request-child-count", requestId],
    queryFn: async () => {
      const { count } = await supabase
        .from("branch_requests")
        .select("id", { count: "exact", head: true })
        .eq("parent_request_id", requestId);
      return count ?? 0;
    },
  });

  const { data: request, isLoading } = useQuery({
    queryKey: ["branch-request-detail", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select(`
          *,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code, logistic_group),
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code, logistic_group, is_central_warehouse)
        `)
        .eq("id", requestId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["branch-request-items", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_request_items")
        .select(`*, product:products(name, sku, bims_code, image_url)`)
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: fulfillments } = useQuery({
    queryKey: ["request-fulfillments", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fulfillment_orders")
        .select("id, status, bims_transfer_number, bims_invoice_number, shipping_method, dispatched_at, received_at")
        .eq("branch_request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  const { data: events } = useQuery({
    queryKey: ["request-events", requestId, request?.status, request?.updated_at],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operational_events")
        .select("*")
        .eq("reference_id", requestId)
        .eq("reference_type", "branch_request")
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Fallback sintético: si no hay (o muy pocos) eventos persistidos pero el pedido
      // avanzó por estados, reconstruimos hitos reales a partir de branch_requests.
      const r: any = request;
      const synthetic: any[] = [];
      if (r) {
        if (r.created_at && r.created_by) {
          synthetic.push({
            id: `syn-created-${r.id}`,
            created_at: r.created_at,
            triggered_by: r.created_by,
            new_status: "pending",
            previous_status: null,
            event_description: "Pedido creado",
            __synthetic: true,
          });
        }
        if (r.accepted_at) {
          synthetic.push({
            id: `syn-accepted-${r.id}`,
            created_at: r.accepted_at,
            triggered_by: r.accepted_by,
            new_status: "accepted",
            previous_status: "pending",
            __synthetic: true,
          });
        }
        if (r.rejected_at) {
          synthetic.push({
            id: `syn-rejected-${r.id}`,
            created_at: r.rejected_at,
            triggered_by: r.rejected_by,
            new_status: "rejected",
            event_description: r.rejection_reason || "Pedido rechazado",
            __synthetic: true,
          });
        }
        if (r.logistic_closed_at) {
          synthetic.push({
            id: `syn-logclosed-${r.id}`,
            created_at: r.logistic_closed_at,
            triggered_by: r.logistic_closed_by,
            new_status: "logistic_closed",
            __synthetic: true,
          });
        }
        if (r.admin_closed_at) {
          synthetic.push({
            id: `syn-adminclosed-${r.id}`,
            created_at: r.admin_closed_at,
            triggered_by: r.admin_closed_by,
            new_status: "closed",
            __synthetic: true,
          });
        }
        // Hito "Estado actual" si no hay evento persistido para el status vigente
        const persistedStatuses = new Set(
          (data || []).map((e: any) => e.new_status).filter(Boolean)
        );
        const syntheticStatuses = new Set(synthetic.map((e) => e.new_status));
        const intermediateStatuses = [
          "pending",
          "accepted",
          "rejected",
          "logistic_closed",
          "closed",
        ];
        if (
          r.status &&
          !intermediateStatuses.includes(r.status) &&
          !persistedStatuses.has(r.status) &&
          !syntheticStatuses.has(r.status)
        ) {
          synthetic.push({
            id: `syn-current-${r.id}`,
            created_at: r.updated_at || r.created_at,
            triggered_by: null,
            new_status: r.status,
            event_description: "Última actualización registrada",
            __synthetic: true,
          });
        }
      }

      // Combinar reales + sintéticos sin duplicar transiciones por status
      const realByStatus = new Set(
        (data || []).map((e: any) => e.new_status).filter(Boolean)
      );
      const merged = [
        ...(data || []),
        ...synthetic.filter((s) => !realByStatus.has(s.new_status)),
      ].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      const actorIds = Array.from(
        new Set(merged.map((e: any) => e.triggered_by).filter(Boolean))
      ) as string[];
      let nameMap: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", actorIds);
        nameMap = Object.fromEntries(
          (profs || []).map((p: any) => [p.user_id, p.full_name || ""])
        );
      }
      return merged.map((ev: any) => ({
        ...ev,
        actor_name: ev.triggered_by
          ? nameMap[ev.triggered_by] || "Usuario interno"
          : "Sistema",
      }));
    },
    enabled: !!requestId && !!request,
  });

  const { data: documents } = useQuery({
    queryKey: ["request-bims-documents", requestId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("request_bims_documents")
        .select("*")
        .eq("request_id", requestId);
      if (error) throw error;
      return data;
    },
    enabled: !!requestId,
  });

  // Live stock from BIMS for source branch (informational, read-only)
  const itemsBimsCodes = (items || [])
    .map((it: any) => it.product?.bims_code)
    .filter(Boolean) as string[];
  const { liveStock: itemsLiveStock } = useLiveStock(itemsBimsCodes);

  // Available trips for assignment (active or planned)
  const { data: availableTrips } = useQuery({
    queryKey: ["available-trips-for-assignment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trips")
        .select("id, status, driver_id, created_at, drivers!inner(user_id, profiles:profiles!inner(full_name))")
        .in("status", ["planned", "in_progress"] as any[])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!request && (request as any).status === "in_consolidation",
  });

  const { data: rejectedByProfile } = useQuery({
    queryKey: ["profile-name-rejected", request?.rejected_by],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", request!.rejected_by!)
        .maybeSingle();
      return data?.full_name || "Usuario desconocido";
    },
    enabled: !!request && request.status === "rejected" && !!request.rejected_by,
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando...</div>;
  if (!request) return <div className="p-4 text-muted-foreground">No encontrada</div>;

  const r = request as any;

  // Si es pedido padre (tiene hijos), mostrar vista resumen sin acciones operativas.
  const isParentRequest = childCount > 0;
  if (isParentRequest) {
    return (
      <ParentRequestSummary
        parent={r}
        onOpenChild={(childId) => navigate(`/solicitudes?detail=${childId}`)}
      />
    );
  }

  // Derivar flow_type efectivo si el registro aún no lo tiene persistido
  // (replica la lógica de fn_transition_request_status para evitar exponer
  // transiciones que el backend rechazará).
  const computeEffectiveFlow = (): string | null => {
    if (r.flow_type) return r.flow_type;
    if (r.delivery_target === "client") return "client_delivery";
    if (r.source_branch_id === r.requesting_branch_id) return "urban";
    const srcGroup = r.source_branch?.logistic_group ?? null;
    const dstGroup = r.requesting_branch?.logistic_group ?? null;
    if (srcGroup && dstGroup && srcGroup === dstGroup) return "urban";
    return "interurban";
  };
  const effectiveFlowType = computeEffectiveFlow();

  // ─── Determine actor permissions ────────────────────────────────
  const isAdmin = hasRole("admin") || hasRole("supervisor") || isOwner;
  const isOrigin = hasBranch(r.source_branch_id);
  const isDestination = hasBranch(r.requesting_branch_id);

  const availableActions = getStatusActions(r.status, effectiveFlowType).filter((action) => {
    if (isAdmin) return true;
    if (action.actor === "origin") return isOrigin;
    if (action.actor === "destination") return isDestination;
    if (action.actor === "driver") return hasRole("driver") || hasRole("warehouse_operator") || hasRole("jefe_logistica") || hasRole("admin") || hasRole("supervisor");
    if (action.actor === "admin") return false;
    return false;
  });

  // Block "in_transit" transition if no documents
  const hasDocuments = (documents?.length || 0) > 0;
  const isAdvanceBlocked = r.status === "in_preparation" && !hasDocuments;

  // ─── Transition handler ─────────────────────────────────────────
  const handleTransition = async (newStatus: string, reason?: string, reasonType?: string, tripId?: string) => {
    setTransitioning(true);
    try {
      // Caso especial: "Aceptar" desde pending debe encadenar pending → accepted → in_preparation
      // en una sola acción operativa visible. El estado intermedio 'accepted' queda en auditoría.
      const isAcceptToPrep = r.status === "pending" && newStatus === "in_preparation";

      if (isAcceptToPrep) {
        const { error: e1 } = await supabase.rpc("fn_transition_request_status", {
          p_request_id: requestId,
          p_new_status: "accepted",
          p_reason: reason || "Aceptación de pedido",
          p_rejection_reason_type: null,
          p_trip_id: null,
        } as any);
        if (e1) throw e1;
      }

      const { data, error } = await supabase.rpc("fn_transition_request_status", {
        p_request_id: requestId,
        p_new_status: newStatus,
        p_reason: reason || null,
        p_rejection_reason_type: reasonType || null,
        p_trip_id: tripId || null,
      } as any);
      if (error) throw error;

      const result = data as any;
      toast.success(`Pedido #${result.request_number ?? ""}: ${isAcceptToPrep ? "pending" : result.old_status} → ${result.new_status}`);

      queryClient.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-fulfillments", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-events", requestId] });
      queryClient.invalidateQueries({ queryKey: ["request-bims-documents", requestId] });
      onUpdate();
      setShowRejectForm(false);
      setShowTripSelector(false);
      setSelectedTripId("");
      setRejectionReason("");
      setRejectionReasonType("");
    } catch (err: any) {
      // Si falló el segundo paso, refrescamos para que la UI muestre 'accepted' y el botón 'Preparar' aparezca como fallback.
      queryClient.invalidateQueries({ queryKey: ["branch-request-detail", requestId] });
      onUpdate();
      toast.error(err.message || "Error al cambiar estado");
    } finally {
      setTransitioning(false);
    }
  };

  // ─── Build progress bar events ─────────────────────────────────
  const progressEvents = (events || [])
    .filter((ev: any) => ev.new_status)
    .map((ev: any) => ({
      status: ev.new_status,
      date: new Date(ev.created_at).toLocaleString("es-PY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    }));

  // ─── Warnings ───────────────────────────────────────────────────
  const warnings: string[] = [];
  if (isAdvanceBlocked && r.status === "in_preparation") {
    warnings.push("Se requiere al menos un documento BIMS para avanzar");
  }
  const hasQtyMismatch = items?.some((item: any) =>
    item.quantity_accepted != null && item.quantity_accepted > 0 &&
    item.quantity_accepted !== item.quantity_requested
  );
  if (hasQtyMismatch) warnings.push("Diferencia entre cantidad solicitada y enviada");

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <RequestProgressBar currentStatus={r.status} events={progressEvents} flowType={effectiveFlowType} />

      {/* Warning panel */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <span className="text-foreground font-medium">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Header — integrado: #N + estado + tipo, fecha, origen → destino */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl font-bold leading-tight">Pedido #{r.request_number}</h3>
          <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
          <Badge variant="outline" className="capitalize">
            {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {new Date(r.created_at).toLocaleString("es-PY")}
        </p>
        {(r.source_branch?.name || r.requesting_branch?.name) && (
          <p className="text-xs sm:text-sm text-foreground/80">
            <span className="text-muted-foreground">De:</span>{" "}
            <span className="font-medium">{r.source_branch?.name || "—"}</span>
            <span className="text-muted-foreground mx-1.5">→</span>
            <span className="text-muted-foreground">Para:</span>{" "}
            <span className="font-medium">
              {r.delivery_target === "client"
                ? (r.client_name || "Cliente")
                : (r.requesting_branch?.name || "—")}
            </span>
          </p>
        )}
      </div>

      {/* ─── REJECTION INFO BLOCK ──────────────────────────────────── */}
      {r.status === "rejected" && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive/70" />
            <h4 className="font-semibold text-foreground">Motivo del rechazo</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Motivo:</span>{" "}
              <span className="font-medium">
                {r.rejection_reason_type
                  ? (REJECTION_REASONS as Record<string, string>)[r.rejection_reason_type] || r.rejection_reason_type
                  : "No especificado"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Rechazado por:</span>{" "}
              <span className="font-medium">{rejectedByProfile || "Usuario desconocido"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Fecha:</span>{" "}
              <span className="font-medium">
                {r.rejected_at
                  ? new Date(r.rejected_at).toLocaleString("es-PY")
                  : "Sin fecha"}
              </span>
            </div>
            {r.rejection_reason && (
              <div className="col-span-1 sm:col-span-2">
                <span className="text-muted-foreground">Observación:</span>{" "}
                <span className="font-medium">{r.rejection_reason}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ACTION PANEL ──────────────────────────────────────────── */}
      {availableActions.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Acciones disponibles</p>
            {showRejectForm ? (
              <div className="space-y-3">
                <Select value={rejectionReasonType} onValueChange={setRejectionReasonType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Motivo de rechazo" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(REJECTION_REASONS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Detalle del rechazo (opcional)"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={!rejectionReasonType || transitioning}
                    onClick={() => handleTransition("rejected", rejectionReason, rejectionReasonType)}
                  >
                    {transitioning && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Confirmar rechazo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowRejectForm(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : showTripSelector ? (
              <div className="space-y-3">
                <p className="text-sm font-medium">Seleccionar viaje para asignar:</p>
                <Select value={selectedTripId} onValueChange={setSelectedTripId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione un viaje" />
                  </SelectTrigger>
                  <SelectContent>
                    {(availableTrips || []).map((trip: any) => {
                      const driverName = trip.drivers?.profiles?.full_name || "Chofer";
                      const statusLabel = trip.status === "in_progress" ? "En curso" : "Planificado";
                      return (
                        <SelectItem key={trip.id} value={trip.id}>
                          {driverName} — {statusLabel} ({new Date(trip.created_at).toLocaleDateString("es-PY")})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {(!availableTrips || availableTrips.length === 0) && (
                  <p className="text-xs text-muted-foreground">No hay viajes disponibles. Cree uno primero desde el módulo de Distribución.</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!selectedTripId || transitioning}
                    onClick={() => handleTransition("assigned_to_trip", undefined, undefined, selectedTripId)}
                  >
                    {transitioning && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                    Confirmar asignación
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setShowTripSelector(false); setSelectedTripId(""); }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableActions.map((action) => {
                  const isBlocked = (action.newStatus === "in_transit" || action.newStatus === "ready_for_pickup" || action.newStatus === "ready_for_delivery") && isAdvanceBlocked;
                  return (
                    <Button
                      key={action.newStatus}
                      variant={action.variant}
                      size="sm"
                      disabled={transitioning || isBlocked}
                      title={isBlocked ? "Vincule un documento BIMS primero" : undefined}
                      onClick={() => {
                        if (action.requiresReason) {
                          setShowRejectForm(true);
                        } else if (action.newStatus === "assigned_to_trip") {
                          setShowTripSelector(true);
                        } else {
                          handleTransition(action.newStatus);
                        }
                      }}
                    >
                      {transitioning ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : action.icon}
                      <span className="ml-1">{action.label}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Route info — Solicitante (necesita stock) → Abastecedora (provee stock) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Sucursal solicitante</p>
            <p className="font-semibold">{r.requesting_branch?.name}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Quien necesita el stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Sucursal abastecedora</p>
            <p className="font-semibold">{r.source_branch?.name}</p>
            <p className="text-[11px] text-muted-foreground mt-1">Quien provee el stock</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Destino:</span>{" "}
          <span className="font-medium">{DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Envío:</span>{" "}
          <span className="font-medium">{SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}</span>
        </div>
        {r.client_name && (
          <div>
            <span className="text-muted-foreground">Cliente:</span>{" "}
            <span className="font-medium">{r.client_name}</span>
          </div>
        )}
        {r.delivery_payer && (
          <div>
            <span className="text-muted-foreground">Paga envío:</span>{" "}
            <span className="font-medium">{r.delivery_payer === "company" ? "Empresa" : "Cliente"}</span>
          </div>
        )}
        {r.shipping_cost != null && r.shipping_cost > 0 && (
          <div>
            <span className="text-muted-foreground">Costo envío:</span>{" "}
            <span className="font-medium">Gs. {Number(r.shipping_cost).toLocaleString("es-PY")}</span>
          </div>
        )}
        {r.courier_billing_mode && (
          <div>
            <span className="text-muted-foreground">Cobro encomienda:</span>{" "}
            <span className="font-medium">{r.courier_billing_mode === "on_invoice" ? "En factura" : "Cobro en destino"}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Cierre logístico:</span>{" "}
          <span className="font-medium">{r.logistic_closed_at ? "✓" : "Pendiente"}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Cierre admin:</span>{" "}
          <span className="font-medium">{r.admin_closed_at ? "✓" : r.request_type === "reposition" ? "N/A" : "Pendiente"}</span>
        </div>
        {r.attached_file_path && (isOrigin || isAdmin) && (
          <div className="col-span-2 sm:col-span-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={async () => {
                try {
                  const { data, error } = await supabase.storage
                    .from("request-attachments")
                    .download(r.attached_file_path);
                  if (error) throw error;
                  const fileName = r.attached_file_path.split("/").pop() || "archivo.xlsx";
                  const url = URL.createObjectURL(data);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = fileName;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err: any) {
                  console.error("Download error:", err);
                  toast.error("No se pudo descargar el archivo");
                }
              }}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Descargar Excel
              <Download className="h-3 w-3" />
            </Button>
          </div>
        )}
        {r.operational_responsible_id && (
          <OperationalResponsibleName userId={r.operational_responsible_id} />
        )}
      </div>

      {/* BIMS Documents */}
      <RequestDocuments
        requestId={requestId}
        requestType={r.request_type}
        deliveryTarget={r.delivery_target}
        currentStatus={r.status}
        isOrigin={isOrigin}
        isAdmin={isAdmin}
      />

      {/* Items */}
      <div>
        <h4 className="font-display font-semibold mb-3">Ítems ({items?.length || 0})</h4>
        <div className="space-y-2">
          {items?.map((item: any) => {
            const sourceCode = r.source_branch?.code as string | undefined;
            const sourceName = r.source_branch?.name as string | undefined;
            const bimsCode = item.product?.bims_code as string | undefined;
            const liveEntry = bimsCode && itemsLiveStock?.[bimsCode];
            const stockMap = (liveEntry?.stock_by_warehouse ?? null) as Record<string, number> | null;
            const stockAtSource = stockMap && sourceCode ? Math.floor(stockMap[sourceCode] ?? 0) : null;
            const reqQty = Number(item.quantity_requested ?? 0);
            const missing = stockAtSource != null ? Math.max(0, reqQty - stockAtSource) : 0;
            const showStockBlock = stockAtSource != null && !!sourceName;

            return (
              <div key={item.id} className="flex flex-col gap-2 p-3 rounded-lg bg-muted/30 border border-border/30 text-sm">
                {/* Fila principal: producto + cantidad + estado de envío */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex items-start gap-2 sm:gap-3 sm:flex-1 min-w-0">
                    <ProductThumb url={item.product?.image_url} alt={item.product?.name} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium break-words">{item.product?.name}</p>
                      <p className="text-xs text-muted-foreground break-all">{item.product?.sku || item.product?.bims_code}</p>
                    </div>
                    {/* Cantidad solicitada SIEMPRE visible (junto al nombre en mobile) */}
                    <div className="text-right shrink-0 sm:hidden">
                      <span className="font-mono font-bold text-base text-foreground">{item.quantity_requested}</span>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">solicitado</p>
                    </div>
                  </div>

                  {/* Metadatos: badges propios del ítem + cantidades enviadas/aceptadas
                      NOTA: el tipo global (Cliente/Reposición) NO se repite acá; ya está en el encabezado. */}
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:shrink-0 pl-12 sm:pl-0">
                    {item.rejection_reason_type && (
                      <Badge variant="destructive" className="text-xs">
                        {REJECTION_REASONS[item.rejection_reason_type] || item.rejection_reason_type}
                      </Badge>
                    )}
                    {/* Cantidad solicitada en sm+ (oculta en mobile porque ya se mostró arriba) */}
                    <div className="hidden sm:block text-right sm:min-w-[120px]">
                      <span className="font-mono font-semibold">{item.quantity_requested}</span>
                      {item.quantity_shipped != null && item.quantity_shipped > 0 && item.quantity_shipped !== item.quantity_requested && (
                        <span className="text-xs ml-1 text-destructive font-semibold">
                          / {item.quantity_shipped} enviados
                        </span>
                      )}
                      {item.quantity_accepted != null && item.quantity_accepted > 0 && (
                        <span className={`text-xs ml-1 ${item.quantity_accepted !== item.quantity_requested ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                          / {item.quantity_accepted} aceptados
                        </span>
                      )}
                    </div>
                    {/* En mobile, mostrar enviados/aceptados como chips si difieren */}
                    <div className="sm:hidden flex flex-wrap gap-1.5 text-[11px]">
                      {item.quantity_shipped != null && item.quantity_shipped > 0 && item.quantity_shipped !== item.quantity_requested && (
                        <span className="font-mono px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-semibold">
                          {item.quantity_shipped} enviados
                        </span>
                      )}
                      {item.quantity_accepted != null && item.quantity_accepted > 0 && (
                        <span className={`font-mono px-1.5 py-0.5 rounded ${item.quantity_accepted !== item.quantity_requested ? "bg-destructive/10 text-destructive font-semibold" : "bg-muted text-muted-foreground"}`}>
                          {item.quantity_accepted} aceptados
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stock actual en sucursal abastecedora (informativo, lectura BIMS) */}
                {showStockBlock && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 sm:pl-[60px] text-xs">
                    <span className="text-muted-foreground">
                      Stock actual {sourceName}:{" "}
                      <span className={`font-mono font-semibold ${stockAtSource < reqQty ? "text-destructive" : "text-foreground"}`}>
                        {stockAtSource.toLocaleString("de-DE")}
                      </span>
                    </span>
                    {missing > 0 && (
                      <span className="font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                        Faltante informativo: {missing.toLocaleString("de-DE")}
                      </span>
                    )}
                  </div>
                )}

                {/* Alerta de otras solicitudes pendientes para este producto (reuso de DemandAlert) */}
                {item.product?.id && (
                  <div className="pl-12 sm:pl-[60px]">
                    <DemandAlert productId={item.product.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── FULFILLMENT / LOGISTICS EXECUTION ─────────────────────── */}
      {fulfillments && fulfillments.length > 0 && (
        <div>
          <h4 className="font-display font-semibold mb-3">Ejecución logística</h4>
          <div className="space-y-2">
            {fulfillments.map((f: any) => (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/20 border border-border/30 text-sm">
                <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${FULFILLMENT_STATUS_CONFIG[f.status]?.color || "bg-muted text-muted-foreground"}`}>
                      {FULFILLMENT_STATUS_CONFIG[f.status]?.label || f.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {SHIPPING_METHOD_LABELS[f.shipping_method] || f.shipping_method}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h4 className="font-display font-semibold mb-3">Línea de tiempo</h4>
        {!events?.length ? (
          <p className="text-sm text-muted-foreground">Sin eventos registrados</p>
        ) : (
          <ol className="relative border-l border-border/60 ml-1.5 space-y-4">
            {events.map((ev: any) => {
              const newLabel = ev.new_status
                ? (REQUEST_STATUS_CONFIG[ev.new_status]?.label || ev.new_status)
                : null;
              const oldLabel = ev.previous_status
                ? (REQUEST_STATUS_CONFIG[ev.previous_status]?.label || ev.previous_status)
                : null;
              const title = newLabel
                ? (oldLabel ? `${oldLabel} → ${newLabel}` : newLabel)
                : (ev.event_description || "Evento");
              return (
                <li key={ev.id} className="pl-4 relative">
                  <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />
                  <p className="text-sm font-medium leading-tight">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    por <span className="font-medium text-foreground/80">{ev.actor_name || "Sistema"}</span>
                    <span className="mx-1.5">·</span>
                    {new Date(ev.created_at).toLocaleString("es-PY", {
                      day: "2-digit", month: "2-digit", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                  {ev.event_description && newLabel && ev.event_description !== title && (
                    <p className="text-xs text-muted-foreground/80 mt-1 italic">{ev.event_description}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {r.notes && (
        <div>
          <h4 className="font-display font-semibold mb-1">Notas</h4>
          <p className="text-sm text-muted-foreground">{r.notes}</p>
        </div>
      )}
    </div>
  );
}
