import { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, ClipboardList, PackageCheck,
  Loader2, Plus, Search, ArrowRight, Clock,
  MessageSquare, Package, Truck, ArrowUpFromLine, MapPin,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { useQuery, useIsFetching, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

const DASHBOARD_REFETCH_MS = 60_000;

// ── Priority helpers ───────────────────────────────────────
const SLA_HOURS = 24;
const CRITICAL_HOURS = 48;

type Priority = "overdue_critical" | "overdue" | "today" | "normal";

function getRequestPriority(createdAt: string): Priority {
  const hoursElapsed = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  if (hoursElapsed > CRITICAL_HOURS) return "overdue_critical";
  if (hoursElapsed > SLA_HOURS) return "overdue";
  if (hoursElapsed > SLA_HOURS * 0.75 || new Date(createdAt).toDateString() === new Date().toDateString()) return "today";
  return "normal";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

const PRIORITY_ORDER: Record<Priority, number> = { overdue_critical: 0, overdue: 1, today: 2, normal: 3 };

const PRIORITY_BADGE: Record<Priority, { label: string; className: string }> = {
  overdue_critical: { label: "Crítico", className: "bg-destructive/15 text-destructive border-destructive/30" },
  overdue: { label: "Atrasado", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
  today: { label: "Hoy", className: "bg-warning/15 text-warning border-warning/30" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
};

// Acento sutil a la izquierda — sin fondo de color para evitar "alerta repetida".
// El header de sección ya comunica la urgencia; cada fila solo lleva una marca discreta.
const PRIORITY_ROW_CLASS: Record<Priority, string> = {
  overdue_critical: "border-l-2 border-l-destructive/70",
  overdue: "border-l-2 border-l-orange-500/70",
  today: "border-l-2 border-l-warning/70",
  normal: "border-l-2 border-l-transparent",
};

// ── Order mode classification ──────────────────────────────
type OrderMode = "pickup" | "delivery" | "encomienda" | "reposicion";

function classifyOrderMode(shippingMethod?: string, deliveryTarget?: string, requestType?: string): OrderMode {
  if (shippingMethod === "pickup") return "pickup";
  if (shippingMethod === "delivery") return "delivery";
  if (shippingMethod === "courier") return "encomienda";
  if (deliveryTarget === "client" || requestType === "client" || requestType === "online") return "delivery";
  return "reposicion";
}

const ORDER_MODE_CONFIG: Record<OrderMode, { label: string; emoji: string; className: string; actionLabel: string }> = {
  pickup: { label: "Retiro", emoji: "🟣", className: "bg-purple-500/10 text-purple-600 border-purple-500/20", actionLabel: "Preparar retiro" },
  delivery: { label: "Delivery", emoji: "🔵", className: "bg-blue-500/10 text-blue-600 border-blue-500/20", actionLabel: "Despachar delivery" },
  encomienda: { label: "Encomienda", emoji: "🟢", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", actionLabel: "Preparar envío" },
  reposicion: { label: "Reposición", emoji: "⚪", className: "bg-muted text-muted-foreground border-border", actionLabel: "Gestionar" },
};

/** A pedido qualifies for "Pedidos con cliente" only if mode is client-facing AND there's real client evidence */
function hasClientEvidence(clientName?: string | null, deliveryTarget?: string | null, clientAddress?: string | null): boolean {
  const validTarget = deliveryTarget && deliveryTarget !== "branch" && deliveryTarget.trim() !== "";
  const validName = clientName && clientName.trim() !== "";
  const validAddress = clientAddress && clientAddress.trim() !== "";
  return !!(validName || validTarget || validAddress);
}

const isClientMode = (m: OrderMode) => m !== "reposicion";

// ── Types ──────────────────────────────────────────────────
type ItemType = "pedido" | "consulta" | "tarea";
type TaskKind = "preparar" | "despachar" | "retirar" | "en_transito" | "recepcionar" | "entregar";
type KpiFilter = "all" | "overdue" | "today" | "active" | "awaiting";
type TypeFilter = "all" | "pedido" | "consulta" | "preparacion" | "transporte" | "recepcion";
type ClientFilter = "all" | "client_only";

interface QueueItem {
  id: string;
  itemType: ItemType;
  number: number | null;
  routeLabel: string;
  status: string;
  priority: Priority;
  createdAt: string;
  orderMode?: OrderMode;
  clientEvidence?: boolean;
  // consultation-specific
  consultationStatus?: string;
  hasResponses?: boolean;
  isRequester?: boolean;
  // task-specific
  taskKind?: TaskKind;
  navigateTo: string;
}

// ── Task kind config ───────────────────────────────────────
const TASK_KIND_CONFIG: Record<TaskKind, { label: string; icon: any; className: string; actionLabel: string }> = {
  preparar: { label: "Preparar", icon: Package, className: "bg-blue-500/10 text-blue-600 border-blue-500/20", actionLabel: "Preparar" },
  despachar: { label: "Despachar", icon: ArrowUpFromLine, className: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20", actionLabel: "Despachar" },
  retirar: { label: "Retirar", icon: Truck, className: "bg-orange-500/10 text-orange-600 border-orange-500/20", actionLabel: "Retirar" },
  en_transito: { label: "En tránsito", icon: Truck, className: "bg-amber-500/10 text-amber-600 border-amber-500/20", actionLabel: "Continuar viaje" },
  recepcionar: { label: "Recepcionar", icon: PackageCheck, className: "bg-teal-500/10 text-teal-600 border-teal-500/20", actionLabel: "Recepcionar" },
  entregar: { label: "Entregar", icon: MapPin, className: "bg-green-500/10 text-green-600 border-green-500/20", actionLabel: "Reintentar" },
};

// Consultation status config for StatusBadge
const CONSULTATION_STATUS_CONFIG: Record<string, { label: string; variant: string }> = {
  open: { label: "Abierta", variant: "default" },
  responded: { label: "Respondida", variant: "secondary" },
  converted: { label: "Convertida", variant: "outline" },
  closed: { label: "Cerrada", variant: "outline" },
};

// Fulfillment status config for StatusBadge
const FULFILLMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  picking: { label: "Preparando", color: "bg-blue-500/10 text-blue-600" },
  waiting_for_cut: { label: "Esperando corte", color: "bg-indigo-500/10 text-indigo-600" },
  waiting_for_courier: { label: "Esperando courier", color: "bg-indigo-500/10 text-indigo-600" },
  dispatched: { label: "Despachado", color: "bg-orange-500/10 text-orange-600" },
  in_transit: { label: "En tránsito", color: "bg-amber-500/10 text-amber-600" },
  at_hub: { label: "En acopio", color: "bg-orange-500/10 text-orange-600" },
  delivered: { label: "Entregado", color: "bg-teal-500/10 text-teal-600" },
  pending_physical_confirmation: { label: "Pend. confirmación", color: "bg-teal-500/10 text-teal-600" },
  delivery_failed: { label: "Entrega fallida", color: "bg-destructive/10 text-destructive" },
};

// ── Animation ──────────────────────────────────────────────
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

// ── Helper: determine taskKind from fulfillment context ────
function getTaskKind(
  status: string,
  isOrigin: boolean,
  isDestination: boolean,
  isCustodian: boolean,
  isAdmin: boolean
): TaskKind | null {
  if (isCustodian || isAdmin) {
    if (status === "in_transit") return "en_transito";
    if (status === "delivery_failed") return "entregar";
  }
  if ((isCustodian || isAdmin) && (status === "dispatched" || status === "at_hub")) return "retirar";

  if (isOrigin || isAdmin) {
    if (status === "pending" || status === "picking") return "preparar";
    if (status === "waiting_for_cut" || status === "waiting_for_courier") return "despachar";
  }

  if (isDestination || isAdmin) {
    if (status === "delivered" || status === "pending_physical_confirmation") return "recepcionar";
  }

  return null;
}

function getTaskAction(taskKind: TaskKind, requestId: string | null): { label: string; navigateTo: string } {
  const cfg = TASK_KIND_CONFIG[taskKind];
  switch (taskKind) {
    case "preparar":
    case "despachar":
      return { label: cfg.actionLabel, navigateTo: requestId ? `/solicitudes?detail=${requestId}` : "/solicitudes" };
    case "retirar":
    case "en_transito":
    case "entregar":
      return { label: cfg.actionLabel, navigateTo: "/chofer" };
    case "recepcionar":
      return { label: cfg.actionLabel, navigateTo: "/recepcion" };
  }
}

/** Build contextual route label using De:/Para: based on user's branch */
function buildRouteLabel(
  sourceName: string,
  destName: string,
  userBranchIds: string[],
  sourceBranchId: string | null,
  destBranchId: string | null,
  isAllBranches: boolean
): string {
  if (isAllBranches) {
    return `De: ${sourceName} → Para: ${destName}`;
  }
  const isSource = sourceBranchId ? userBranchIds.includes(sourceBranchId) : false;
  const isDest = destBranchId ? userBranchIds.includes(destBranchId) : false;
  
  if (isSource && !isDest) return `Para: ${destName}`;
  if (isDest && !isSource) return `De: ${sourceName}`;
  return `De: ${sourceName} → Para: ${destName}`;
}

/** Extract first name from full name */
function firstName(fullName?: string | null): string {
  if (!fullName) return "";
  return fullName.split(" ")[0];
}

export default function Index() {
  const { user, profile, hasRole, isOwner } = useAuth();
  const { isAllBranches, allowedBranchIds, defaultBranchId } = useUserBranchFilter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isDriver = hasRole("driver");
  const isLogisticsOp = hasRole("warehouse_operator") || hasRole("jefe_logistica");
  // jefe_logistica tiene visión global a nivel RLS; lo tratamos como admin para que el dashboard no lo limite
  const isAdmin = isAllBranches || isOwner || hasRole("admin") || hasRole("supervisor") || hasRole("jefe_logistica");
  const isViewer = hasRole("viewer") || hasRole("auditor");

  const [activeFilter, setActiveFilter] = useState<KpiFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [clientFilter, setClientFilter] = useState<ClientFilter>("all");
  const [lastRefreshAt, setLastRefreshAt] = useState<Date>(new Date());
  const [nowTick, setNowTick] = useState<number>(Date.now());

  const canAccessBranch = (branchId: string | null) => {
    if (!branchId) return false;
    if (isAllBranches) return true;
    return allowedBranchIds.includes(branchId);
  };

  // ── Queries ────────────────────────────────────────────
  const { data: pendingRequests, isLoading: loadingRequests } = useQuery({
    queryKey: ["dashboard-pending", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("branch_requests")
        .select(`
          id, request_number, status, created_at, shipping_method, notes,
          delivery_target, request_type, client_name, client_address,
          requesting_branch_id, source_branch_id,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name),
          source_branch:branches!branch_requests_source_branch_id_fkey(name)
        `)
        .in("status", ["pending", "accepted", "picking", "in_preparation", "ready_for_pickup", "ready_for_delivery"] as any)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        const branchFilter = `requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`;
        if (user?.id) {
          query = query.or(`${branchFilter},operational_responsible_id.eq.${user.id}`);
        } else {
          query = query.or(branchFilter);
        }
      }
      const { data } = await query;
      return data || [];
    },
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const { data: activeFulfillments, isLoading: loadingFulfillments } = useQuery({
    queryKey: ["dashboard-fulfillments", isAllBranches, allowedBranchIds, user?.id],
    queryFn: async () => {
      let query = supabase
        .from("fulfillment_orders")
        .select(`
          id, status, source_branch_id, destination_branch_id,
          current_custody_holder_id, created_at, updated_at,
          branch_request:branch_requests!fulfillment_orders_branch_request_id_fkey(
            id, request_number, request_type
          ),
          source_branch:branches!fulfillment_orders_source_branch_id_fkey(name),
          destination_branch:branches!fulfillment_orders_destination_branch_id_fkey(name)
        `)
        .not("status", "in", '("completed","cancelled","received","logistic_closed")');

      if (!isAllBranches && allowedBranchIds.length > 0) {
        const branchFilter = `source_branch_id.in.(${allowedBranchIds.join(",")}),destination_branch_id.in.(${allowedBranchIds.join(",")})`;
        if (user?.id) {
          query = query.or(`${branchFilter},current_custody_holder_id.eq.${user.id}`);
        } else {
          query = query.or(branchFilter);
        }
      }

      query = query.order("created_at", { ascending: false }).limit(200);
      const { data } = await query;
      return data || [];
    },
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const { data: activeConsultations, isLoading: loadingConsultations } = useQuery({
    queryKey: ["dashboard-consultations", isAllBranches, allowedBranchIds, defaultBranchId],
    queryFn: async () => {
      const query = supabase
        .from("availability_consultations")
        .select(`
          id, status, created_at, requesting_branch_id,
          requesting_branch:branches!availability_consultations_requesting_branch_id_fkey(name),
          consultation_targets(id, branch_id, responded_at, response_quantity,
            branch:branches!consultation_targets_branch_id_fkey(name))
        `)
        .in("status", ["open", "responded"] as any)
        .order("created_at", { ascending: false })
        .limit(30);
      const { data } = await query;
      return data || [];
    },
    refetchInterval: DASHBOARD_REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  // Indicador de "actualizado hace X" + reloj que tickea cada 15s
  const isFetchingDashboard = useIsFetching({ predicate: (q) =>
    Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("dashboard-")
  });
  useEffect(() => {
    if (isFetchingDashboard === 0) setLastRefreshAt(new Date());
  }, [isFetchingDashboard]);
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const refreshSecondsAgo = Math.max(0, Math.floor((nowTick - lastRefreshAt.getTime()) / 1000));
  const refreshLabel = refreshSecondsAgo < 60
    ? `hace ${refreshSecondsAgo}s`
    : `hace ${Math.floor(refreshSecondsAgo / 60)}m`;
  const handleManualRefresh = () => {
    queryClient.invalidateQueries({ predicate: (q) =>
      Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("dashboard-")
    });
  };


  // ── Build unified queue ────────────────────────────────
  const queueItems = useMemo(() => {
    const items: QueueItem[] = [];

    pendingRequests?.forEach((r: any) => {
      if (r.notes && r.notes.includes("[Pedido padre multi-origen]")) return;
      const routeLabel = buildRouteLabel(
        r.source_branch?.name ?? "?", r.requesting_branch?.name ?? "?",
        allowedBranchIds, r.source_branch_id, r.requesting_branch_id, isAllBranches
      );
      const mode = classifyOrderMode(r.shipping_method, r.delivery_target, r.request_type);
      const evidence = hasClientEvidence(r.client_name, r.delivery_target, r.client_address);
      items.push({
        id: r.id,
        itemType: "pedido",
        number: r.request_number,
        routeLabel,
        status: r.status,
        priority: getRequestPriority(r.created_at),
        createdAt: r.created_at,
        orderMode: mode,
        clientEvidence: evidence,
        navigateTo: `/solicitudes?detail=${r.id}`,
      });
    });

    activeConsultations?.forEach((c: any) => {
      const targets = c.consultation_targets || [];
      const hasResponses = targets.some((t: any) => t.responded_at);
      const isRequester = defaultBranchId === c.requesting_branch_id;
      const targetNames = targets.map((t: any) => t.branch?.name).filter(Boolean).join(", ");
      
      // Use De:/Para: for consultations too
      const routeLabel = isRequester
        ? `Para: ${targetNames || "Sin destino"}`
        : `De: ${c.requesting_branch?.name ?? "?"}`;

      items.push({
        id: c.id,
        itemType: "consulta",
        number: null,
        routeLabel,
        status: c.status,
        priority: getRequestPriority(c.created_at),
        createdAt: c.created_at,
        consultationStatus: c.status,
        hasResponses,
        isRequester,
        navigateTo: `/consultas?detail=${c.id}`,
      });
    });

    activeFulfillments?.forEach((f: any) => {
      if (f.source_branch_id === f.destination_branch_id) return;

      const isOrigin = canAccessBranch(f.source_branch_id);
      const isDestination = canAccessBranch(f.destination_branch_id);
      const isCustodian = f.current_custody_holder_id === user?.id;

      const taskKind = getTaskKind(f.status, isOrigin, isDestination, isCustodian, isAdmin);
      if (!taskKind) return;

      if (!isAdmin && !isOrigin && !isDestination && !isCustodian) return;

      const requestId = f.branch_request?.id || null;
      const requestNumber = f.branch_request?.request_number || null;
      const { navigateTo } = getTaskAction(taskKind, requestId);

      const routeLabel = buildRouteLabel(
        f.source_branch?.name ?? "?", f.destination_branch?.name ?? "?",
        allowedBranchIds, f.source_branch_id, f.destination_branch_id, isAllBranches
      );

      items.push({
        id: f.id,
        itemType: "tarea",
        number: requestNumber,
        routeLabel,
        status: f.status,
        priority: getRequestPriority(f.created_at),
        createdAt: f.created_at,
        taskKind,
        navigateTo,
      });
    });

    items.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;

      if (isLogisticsOp) {
        const TYPE_ORDER: Record<string, number> = { consulta: 0, pedido: 1, tarea: 2 };
        const TASK_ORDER: Record<string, number> = {
          preparar: 0, despachar: 1, retirar: 2, en_transito: 3, entregar: 4, recepcionar: 5,
        };
        const tDiff = (TYPE_ORDER[a.itemType] ?? 9) - (TYPE_ORDER[b.itemType] ?? 9);
        if (tDiff !== 0) return tDiff;
        if (a.itemType === "tarea" && b.itemType === "tarea") {
          return (TASK_ORDER[a.taskKind ?? ""] ?? 9) - (TASK_ORDER[b.taskKind ?? ""] ?? 9);
        }
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return items;
  }, [pendingRequests, activeConsultations, activeFulfillments, defaultBranchId, user?.id, isAdmin, isAllBranches, allowedBranchIds, isLogisticsOp]);

  // ── Counts ─────────────────────────────────────────────
  const isOverdue = (p: Priority) => p === "overdue" || p === "overdue_critical";
  const overdueCount = queueItems.filter(i => isOverdue(i.priority)).length;
  const todayCount = queueItems.filter(i => i.priority === "today").length;
  const activeCount = queueItems.length;
  const awaitingReceptionCount = queueItems.filter(i => i.itemType === "tarea" && i.taskKind === "recepcionar").length
    || activeFulfillments?.filter(
      (f) => f.status === "delivered" || f.status === "pending_physical_confirmation"
    ).length || 0;


  // ── Filtered queue ─────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = queueItems;
    if (activeFilter === "overdue") list = list.filter(i => isOverdue(i.priority));
    else if (activeFilter === "today") list = list.filter(i => i.priority === "today");
    else if (activeFilter === "awaiting") list = list.filter(i => i.itemType === "tarea" && i.taskKind === "recepcionar");
    if (typeFilter === "pedido") list = list.filter(i => i.itemType === "pedido");
    else if (typeFilter === "consulta") list = list.filter(i => i.itemType === "consulta");
    else if (typeFilter === "preparacion") list = list.filter(i => i.itemType === "tarea" && (i.taskKind === "preparar" || i.taskKind === "despachar"));
    else if (typeFilter === "transporte") list = list.filter(i => i.itemType === "tarea" && (i.taskKind === "retirar" || i.taskKind === "en_transito" || i.taskKind === "entregar"));
    else if (typeFilter === "recepcion") list = list.filter(i => i.itemType === "tarea" && i.taskKind === "recepcionar");
    if (clientFilter === "client_only") {
      list = list.filter(i => i.itemType === "pedido" && i.orderMode && isClientMode(i.orderMode) && i.clientEvidence === true);
    }
    return list;
  }, [queueItems, activeFilter, typeFilter, clientFilter]);

  const isLoading = loadingRequests || loadingFulfillments || loadingConsultations;

  // ── KPI definitions ────────────────────────────────────
  const kpis: { key: KpiFilter; title: string; value: number; icon: any; colorClass: string; bgClass: string }[] = [
    { key: "overdue", title: "Atrasados", value: overdueCount, icon: AlertTriangle, colorClass: "text-orange-600", bgClass: "bg-orange-500/10" },
    { key: "today", title: "Urgentes hoy", value: todayCount, icon: Clock, colorClass: "text-warning", bgClass: "bg-warning/10" },
    { key: "active", title: "En curso", value: activeCount, icon: ClipboardList, colorClass: "text-primary", bgClass: "bg-primary/10" },
    { key: "awaiting", title: "Pend. recepción", value: awaitingReceptionCount, icon: PackageCheck, colorClass: "text-accent", bgClass: "bg-accent/10" },
  ];


  // ── Type filter tabs ───────────────────────────────────
  const typeFilters: { key: TypeFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "pedido", label: "📦 Pedidos" },
    { key: "consulta", label: "💬 Consultas" },
    { key: "preparacion", label: "🔧 Preparación" },
    { key: "transporte", label: "🚚 Transporte" },
    { key: "recepcion", label: "📥 Recepción" },
  ];

  const filterCounts = useMemo(() => {
    const base = (() => {
      let list = queueItems;
      if (activeFilter === "overdue") list = list.filter(i => isOverdue(i.priority));
      else if (activeFilter === "today") list = list.filter(i => i.priority === "today");
      else if (activeFilter === "awaiting") list = list.filter(i => i.itemType === "tarea" && i.taskKind === "recepcionar");
      return list;
    })();

    return {
      all: base.length,
      pedido: base.filter(i => i.itemType === "pedido").length,
      consulta: base.filter(i => i.itemType === "consulta").length,
      preparacion: base.filter(i => i.itemType === "tarea" && (i.taskKind === "preparar" || i.taskKind === "despachar")).length,
      transporte: base.filter(i => i.itemType === "tarea" && (i.taskKind === "retirar" || i.taskKind === "en_transito" || i.taskKind === "entregar")).length,
      recepcion: base.filter(i => i.itemType === "tarea" && i.taskKind === "recepcionar").length,
    } as Record<TypeFilter, number>;
  }, [queueItems, activeFilter]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header + Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">
            {isViewer ? "Panel de Seguimiento" : isLogisticsOp ? "Panel Logístico" : isDriver ? "Panel del Chofer" : "Mi Panel Operativo"}
          </h1>
          <p className="page-subtitle mt-0.5">
            {firstName(profile?.full_name)} — {new Date().toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${isFetchingDashboard > 0 ? "bg-primary animate-pulse" : "bg-success"}`} />
              Actualizado {refreshLabel}
            </span>
            <button
              type="button"
              onClick={handleManualRefresh}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              aria-label="Actualizar ahora"
            >
              <RefreshCw className={`h-3 w-3 ${isFetchingDashboard > 0 ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>
        </div>
        {!isDriver && !isViewer && (
          <div className="flex gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
            {isLogisticsOp && (
              <Button size="sm" variant="secondary" onClick={() => navigate("/chofer")} className="flex-1 sm:flex-none">
                <Truck className="h-4 w-4" />
                <span className="hidden xs:inline">Ir a</span> Transporte
              </Button>
            )}
            <Button size="sm" onClick={() => navigate("/solicitudes?action=new")} className="flex-1 sm:flex-none">
              <Plus className="h-4 w-4" />
              <span className="hidden xs:inline">Nuevo</span> pedido
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/consultas?action=new")} className="flex-1 sm:flex-none">
              <Search className="h-4 w-4" />
              <span className="hidden xs:inline">Nueva</span> consulta
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <motion.div
            className="grid grid-cols-2 lg:grid-cols-4 gap-3"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {kpis.map((kpi) => {
              const isActive = activeFilter === kpi.key;
              return (
                <motion.div key={kpi.key} variants={item}>
                  <Card
                    className={`cursor-pointer transition-all duration-200 hover:shadow-md ${
                      isActive ? "ring-2 ring-primary shadow-md bg-primary/5" : "glass-card"
                    }`}
                    onClick={() => setActiveFilter(isActive ? "all" : kpi.key)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{kpi.title}</p>
                          <p className="text-2xl font-display font-bold mt-1 text-foreground">{kpi.value}</p>
                        </div>
                        <div className={`${kpi.bgClass} p-2 rounded-lg`}>
                          <kpi.icon className={`h-4 w-4 ${kpi.colorClass}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>

          <div>
            {/* Main: Prioritized Queue — Full Width */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="font-display text-base">
                      Cola operativa
                    </CardTitle>
                    {activeFilter !== "all" && (
                      <Badge variant="secondary" className="text-xs font-normal ml-2">
                        Mostrando: {kpis.find(k => k.key === activeFilter)?.title}
                      </Badge>
                    )}
                    <div className="flex items-center gap-1">
                      {(activeFilter !== "all" || typeFilter !== "all" || clientFilter !== "all") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => { setActiveFilter("all"); setTypeFilter("all"); setClientFilter("all"); }}
                        >
                          Limpiar filtros
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Type filter tabs */}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {typeFilters.map((tf) => {
                      const count = filterCounts[tf.key];
                      const isActive = typeFilter === tf.key;
                      if (tf.key !== "all" && count === 0) return null;
                      return (
                        <button
                          key={tf.key}
                          onClick={() => setTypeFilter(isActive ? "all" : tf.key)}
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                            isActive
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {tf.label}
                          <span className={`text-[10px] ${isActive ? "text-primary-foreground/70" : "text-muted-foreground/60"}`}>
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </CardHeader>
                <CardContent>
                  {!filteredItems.length ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <PackageCheck className="h-10 w-10 text-muted-foreground/30 mb-3" />
                      <p className="text-sm font-medium text-muted-foreground">
                        {activeFilter !== "all" || typeFilter !== "all"
                          ? "Sin ítems en esta categoría"
                          : "No tienes tareas pendientes 🎉"}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {activeFilter !== "all" || typeFilter !== "all"
                          ? "Prueba cambiando los filtros"
                          : "Todo al día — buen trabajo"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {(() => {
                        // Separate client orders from the rest
                        const isClientOrder = (i: QueueItem) => i.itemType === "pedido" && i.orderMode && isClientMode(i.orderMode) && i.clientEvidence === true;
                        const clientItems = filteredItems.filter(isClientOrder);
                        const restItems = filteredItems.filter(i => !isClientOrder(i));

                        // Render a single queue item row
                        const renderQueueRow = (qi: QueueItem) => {
                          const badge = PRIORITY_BADGE[qi.priority];
                          const rowClass = PRIORITY_ROW_CLASS[qi.priority];
                          const isPedido = qi.itemType === "pedido";
                          const isConsulta = qi.itemType === "consulta";
                          const isTarea = qi.itemType === "tarea";

                          let actionLabel = isViewer ? "Ver" : "Gestionar";
                          const actionIcon = <ArrowRight className="h-3 w-3 ml-1" />;
                          const handleAction = () => navigate(qi.navigateTo);

                          if (!isViewer) {
                            if (isPedido && qi.orderMode && qi.orderMode !== "reposicion") {
                              actionLabel = ORDER_MODE_CONFIG[qi.orderMode].actionLabel;
                            } else if (isConsulta) {
                              actionLabel = qi.isRequester ? "Ver consulta" : "Responder";
                            } else if (isTarea && qi.taskKind) {
                              actionLabel = TASK_KIND_CONFIG[qi.taskKind].actionLabel;
                            }
                          }

                          const renderTypeBadge = () => {
                            if (isPedido) {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                                  <Package className="h-3 w-3" />
                                  Pedido
                                </span>
                              );
                            }
                            if (isConsulta) {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-secondary/80 text-secondary-foreground border border-secondary shrink-0">
                                  <MessageSquare className="h-3 w-3" />
                                  Consulta
                                </span>
                              );
                            }
                            if (isTarea && qi.taskKind) {
                              const taskCfg = TASK_KIND_CONFIG[qi.taskKind];
                              const TaskIcon = taskCfg.icon;
                              return (
                                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border shrink-0 ${taskCfg.className}`}>
                                  <TaskIcon className="h-3 w-3" />
                                  {taskCfg.label}
                                </span>
                              );
                            }
                            return null;
                          };

                          const renderModeBadge = () => {
                            if (!isPedido || !qi.orderMode) return null;
                            const cfg = ORDER_MODE_CONFIG[qi.orderMode];
                            return (
                              <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border shrink-0 ${cfg.className}`}>
                                {cfg.emoji} {cfg.label}
                              </span>
                            );
                          };

                          const renderStatusBadge = () => {
                            if (isPedido) return <StatusBadge status={qi.status} config={REQUEST_STATUS_CONFIG} />;
                            if (isConsulta) return <StatusBadge status={qi.status} config={CONSULTATION_STATUS_CONFIG} />;
                            if (isTarea) return <StatusBadge status={qi.status} config={FULFILLMENT_STATUS_CONFIG} />;
                            return null;
                          };

                          return (
                            <div
                              key={`${qi.itemType}-${qi.id}`}
                              className={`flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-muted/40 active:bg-muted/60 transition-all duration-150 ${rowClass}`}
                              onClick={handleAction}
                            >
                              {/* Línea 1: tipo + modo + #número + ruta */}
                              <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap lg:flex-nowrap">
                                {renderTypeBadge()}
                                {renderModeBadge()}
                                {qi.number && (
                                  <span className="text-sm font-mono font-semibold text-foreground shrink-0">
                                    #{qi.number}
                                  </span>
                                )}
                                <span className="text-sm text-muted-foreground truncate min-w-0">
                                  {qi.routeLabel}
                                </span>
                                {qi.routeLabel.includes("→") && qi.routeLabel.split("→").length === 2 && (() => {
                                  const parts = qi.routeLabel.split("→").map(s => s.replace(/^(De:|Para:)\s*/, "").trim());
                                  return parts[0] === parts[1] ? (
                                    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border shrink-0">
                                      Interno
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                              {/* Línea 2: estado + prioridad + tiempo + CTA */}
                              <div className="flex items-center gap-2 lg:shrink-0 w-full lg:w-auto justify-between lg:justify-end">
                                <div className="flex items-center gap-2 min-w-0">
                                  {renderStatusBadge()}
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 ${badge.className}`}>
                                    {badge.label}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground shrink-0 hidden xs:inline">
                                    {timeAgo(qi.createdAt)}
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-3 text-xs shrink-0"
                                  onClick={(e) => { e.stopPropagation(); handleAction(); }}
                                >
                                  {actionLabel}
                                  {actionIcon}
                                </Button>
                              </div>
                            </div>
                          );
                        };

                        // Build priority sections for a set of items
                        const buildSections = (items: QueueItem[]) => {
                          const sections: { key: string; title: string; items: QueueItem[] }[] = [];
                          const immediate = items.filter(i => i.priority === "overdue_critical" || i.priority === "overdue");
                          const todayItems = items.filter(i => i.priority === "today");
                          const normalItems = items.filter(i => i.priority === "normal");
                          if (immediate.length) sections.push({ key: "immediate", title: "Requiere atención inmediata", items: immediate });
                          if (todayItems.length) sections.push({ key: "today", title: "Para hoy", items: todayItems });
                          if (normalItems.length) sections.push({ key: "normal", title: "En curso", items: normalItems });
                          return sections;
                        };

                        const renderSections = (sections: ReturnType<typeof buildSections>, showHeaders: boolean) =>
                          sections.map((section, sIdx) => (
                            <div key={section.key} className={sIdx > 0 ? "mt-4" : ""}>
                              {showHeaders && (
                                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md ${
                                  section.key === "immediate" ? "text-destructive bg-destructive/5" : section.key === "today" ? "text-orange-600" : "text-muted-foreground"
                                }`}>
                                  {section.key === "immediate" && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                                  <p className="text-[11px] font-semibold uppercase tracking-wider">
                                    {section.title}
                                  </p>
                                </div>
                              )}
                              {section.items.map(renderQueueRow)}
                            </div>
                          ));

                        return (
                          <>
                            {/* Client orders section - clickable filter */}
                            {(() => {
                              const allClientItems = filteredItems.filter(isClientOrder);
                              const isClientFilterActive = clientFilter === "client_only";

                              if (allClientItems.length === 0 && !isClientFilterActive) return null;

                              return (
                                <div className="mb-4">
                                  <div
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md border mb-2 cursor-pointer transition-all duration-200 ${
                                      isClientFilterActive
                                        ? "bg-purple-500/15 border-purple-500/30 ring-2 ring-purple-500/20"
                                        : "bg-purple-500/5 border-purple-500/10 hover:bg-purple-500/10"
                                    }`}
                                    onClick={() => setClientFilter(isClientFilterActive ? "all" : "client_only")}
                                  >
                                    <Truck className="h-4 w-4 text-purple-600 shrink-0" />
                                    <div>
                                      <p className="text-xs font-semibold uppercase tracking-wider text-purple-600">
                                        Pedidos con cliente
                                      </p>
                                      <p className="text-[10px] text-purple-500/70 font-normal normal-case tracking-normal">
                                        {isClientFilterActive ? "Click para ver todos" : "Pickup, delivery y encomienda con cliente identificado"}
                                      </p>
                                    </div>
                                    <Badge variant={isClientFilterActive ? "default" : "secondary"} className="text-[10px] ml-auto">
                                      {allClientItems.length}
                                    </Badge>
                                  </div>
                                  {/* When filter active, show all client items with priority sections */}
                                  {isClientFilterActive && allClientItems.length > 0 && (
                                    renderSections(buildSections(allClientItems), true)
                                  )}
                                  {/* When NOT active, show inline preview */}
                                  {!isClientFilterActive && clientItems.length > 0 && (
                                    renderSections(buildSections(clientItems), true)
                                  )}
                                </div>
                              );
                            })()}
                            {/* Regular queue - hidden when client filter active */}
                            {clientFilter !== "client_only" && (
                              <>
                                {restItems.length > 0 ? (
                                  renderSections(buildSections(restItems), buildSections(restItems).length > 1 && activeFilter === "all")
                                ) : clientItems.length === 0 ? null : (
                                  <p className="text-xs text-muted-foreground text-center py-4">Sin reposiciones internas pendientes</p>
                                )}
                              </>
                            )}
                            {/* Cierre visual de lista */}
                            {filteredItems.length > 0 && (
                              <div className="flex items-center justify-center gap-2 pt-4 mt-2 border-t border-dashed border-border/60">
                                <PackageCheck className="h-3.5 w-3.5 text-muted-foreground/60" />
                                <p className="text-[11px] text-muted-foreground/70">
                                  Fin de tareas · {filteredItems.length} {filteredItems.length === 1 ? "ítem" : "ítems"}
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

          </div>
        </>
      )}
    </div>
  );
}
