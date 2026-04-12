import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, ClipboardList, PackageCheck,
  Loader2, Plus, Search, ArrowRight, Clock, FileWarning,
  XCircle, AlertCircle, MessageSquare, Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

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
  overdue_critical: { label: "Crítico", className: "bg-destructive/20 text-destructive border-destructive/40" },
  overdue: { label: "Atrasado", className: "bg-destructive/15 text-destructive border-destructive/30" },
  today: { label: "Hoy", className: "bg-warning/15 text-warning border-warning/30" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
};

const PRIORITY_ROW_CLASS: Record<Priority, string> = {
  overdue_critical: "border-l-2 border-l-destructive bg-destructive/10",
  overdue: "border-l-2 border-l-destructive bg-destructive/5",
  today: "border-l-2 border-l-warning bg-warning/5",
  normal: "",
};

// ── Types ──────────────────────────────────────────────────
type ItemType = "pedido" | "consulta";
type KpiFilter = "all" | "overdue" | "today" | "active" | "awaiting";
type TypeFilter = "all" | "pedido" | "consulta";

interface QueueItem {
  id: string;
  itemType: ItemType;
  number: number | null;
  label: string;
  status: string;
  priority: Priority;
  createdAt: string;
  // consultation-specific
  consultationStatus?: string;
  hasResponses?: boolean;
  isRequester?: boolean;
  navigateTo: string;
}

// Consultation status config for StatusBadge
const CONSULTATION_STATUS_CONFIG: Record<string, { label: string; variant: string }> = {
  open: { label: "Abierta", variant: "default" },
  responded: { label: "Respondida", variant: "secondary" },
  converted: { label: "Convertida", variant: "outline" },
  closed: { label: "Cerrada", variant: "outline" },
};

// ── Animation ──────────────────────────────────────────────
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

export default function Index() {
  const { profile, hasRole, isOwner } = useAuth();
  const { isAllBranches, allowedBranchIds, defaultBranchId } = useUserBranchFilter();
  const navigate = useNavigate();
  const isDriver = hasRole("driver");

  const [activeFilter, setActiveFilter] = useState<KpiFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // ── Queries ────────────────────────────────────────────
  const { data: pendingRequests, isLoading: loadingRequests } = useQuery({
    queryKey: ["dashboard-pending", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("branch_requests")
        .select(`
          id, request_number, status, created_at, shipping_method, notes,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name),
          source_branch:branches!branch_requests_source_branch_id_fkey(name)
        `)
        .in("status", ["pending", "accepted", "picking", "in_preparation"] as any)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(
          `requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`
        );
      }
      const { data } = await query;
      return data || [];
    },
  });

  const { data: activeFulfillments, isLoading: loadingFulfillments } = useQuery({
    queryKey: ["dashboard-fulfillments", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      const query = supabase
        .from("fulfillment_orders")
        .select("id, status, source_branch_id, destination_branch_id")
        .not("status", "in", '("completed","cancelled","received")')
        .limit(100);
      const { data } = await query;
      return data || [];
    },
  });

  // Active consultations
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
  });

  // Attention: rejected requests
  const { data: attentionRequests } = useQuery({
    queryKey: ["dashboard-attention", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("branch_requests")
        .select(`
          id, request_number, status, created_at,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name),
          source_branch:branches!branch_requests_source_branch_id_fkey(name)
        `)
        .in("status", ["rejected"] as any)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(
          `requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`
        );
      }
      const { data } = await query;
      return data || [];
    },
  });

  const { data: openIncidents } = useQuery({
    queryKey: ["dashboard-incidents"],
    queryFn: async () => {
      const query = supabase
        .from("logistics_incidents")
        .select("id, title, branch_request_id, status")
        .in("status", ["open", "under_review"] as any)
        .limit(10);
      const { data } = await query;
      return data || [];
    },
  });

  // ── Build unified queue ────────────────────────────────
  const queueItems = useMemo(() => {
    const items: QueueItem[] = [];

    // Requests
    pendingRequests?.forEach((r: any) => {
      items.push({
        id: r.id,
        itemType: "pedido",
        number: r.request_number,
        label: `${r.source_branch?.name ?? "?"} → ${r.requesting_branch?.name ?? "?"}`,
        status: r.status,
        priority: getRequestPriority(r.created_at),
        createdAt: r.created_at,
        navigateTo: `/solicitudes?detail=${r.id}`,
      });
    });

    // Consultations
    activeConsultations?.forEach((c: any) => {
      const targets = c.consultation_targets || [];
      const hasResponses = targets.some((t: any) => t.responded_at);
      const isRequester = defaultBranchId === c.requesting_branch_id;
      const targetNames = targets.map((t: any) => t.branch?.name).filter(Boolean).join(", ");
      const label = `${c.requesting_branch?.name ?? "?"} → ${targetNames || "Sin destino"}`;

      items.push({
        id: c.id,
        itemType: "consulta",
        number: null,
        label,
        status: c.status,
        priority: getRequestPriority(c.created_at),
        createdAt: c.created_at,
        consultationStatus: c.status,
        hasResponses,
        isRequester,
        navigateTo: `/consultas?detail=${c.id}`,
      });
    });

    items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return items;
  }, [pendingRequests, activeConsultations, defaultBranchId]);

  // ── Counts ─────────────────────────────────────────────
  const isOverdue = (p: Priority) => p === "overdue" || p === "overdue_critical";
  const overdueCount = queueItems.filter(i => isOverdue(i.priority)).length;
  const todayCount = queueItems.filter(i => i.priority === "today").length;
  const activeCount = queueItems.length;
  const awaitingReceptionCount = activeFulfillments?.filter(
    (f) => f.status === "delivered" || f.status === "pending_physical_confirmation"
  ).length || 0;

  // ── Attention cases ────────────────────────────────────
  const attentionCases = useMemo(() => {
    const cases: { id: string; icon: string; itemType: ItemType; description: string; navigateTo?: string }[] = [];

    // Overdue requests
    queueItems
      .filter(i => isOverdue(i.priority) && i.itemType === "pedido")
      .slice(0, 4)
      .forEach(i => {
        cases.push({
          id: `overdue-${i.id}`,
          icon: "overdue",
          itemType: "pedido",
          description: `Pedido #${i.number} atrasado (${timeAgo(i.createdAt)})`,
          navigateTo: i.navigateTo,
        });
      });

    // Rejected requests
    attentionRequests?.forEach((r: any) => {
      cases.push({
        id: `rejected-${r.id}`,
        icon: "rejected",
        itemType: "pedido",
        description: `Pedido #${r.request_number} rechazado`,
        navigateTo: `/solicitudes?detail=${r.id}`,
      });
    });

    // Unanswered consultations (open, no responses yet)
    queueItems
      .filter(i => i.itemType === "consulta" && i.consultationStatus === "open" && !i.hasResponses)
      .slice(0, 3)
      .forEach(i => {
        cases.push({
          id: `consul-open-${i.id}`,
          icon: "no_doc",
          itemType: "consulta",
          description: `Consulta sin responder (${timeAgo(i.createdAt)})`,
          navigateTo: i.navigateTo,
        });
      });

    // Consultations ready for order (responded + user is requester)
    queueItems
      .filter(i => i.itemType === "consulta" && i.hasResponses && i.isRequester)
      .slice(0, 3)
      .forEach(i => {
        cases.push({
          id: `consul-ready-${i.id}`,
          icon: "ready",
          itemType: "consulta",
          description: `Consulta lista para pedido`,
          navigateTo: i.navigateTo,
        });
      });

    // Incidents
    openIncidents?.forEach((inc: any) => {
      cases.push({
        id: `incident-${inc.id}`,
        icon: "incident",
        itemType: "pedido",
        description: inc.title || "Incidencia abierta",
        navigateTo: inc.branch_request_id ? `/solicitudes?detail=${inc.branch_request_id}` : undefined,
      });
    });

    return cases.slice(0, 8);
  }, [queueItems, attentionRequests, openIncidents]);

  // ── Filtered queue ─────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = queueItems;
    // KPI filter
    if (activeFilter === "overdue") list = list.filter(i => isOverdue(i.priority));
    else if (activeFilter === "today") list = list.filter(i => i.priority === "today");
    // Type filter
    if (typeFilter !== "all") list = list.filter(i => i.itemType === typeFilter);
    return list;
  }, [queueItems, activeFilter, typeFilter]);

  const isLoading = loadingRequests || loadingFulfillments || loadingConsultations;

  // ── KPI definitions ────────────────────────────────────
  const kpis: { key: KpiFilter; title: string; value: number; icon: any; colorClass: string; bgClass: string }[] = [
    { key: "overdue", title: "Atrasados", value: overdueCount, icon: AlertTriangle, colorClass: "text-destructive", bgClass: "bg-destructive/10" },
    { key: "today", title: "Urgentes hoy", value: todayCount, icon: Clock, colorClass: "text-warning", bgClass: "bg-warning/10" },
    { key: "active", title: "En curso", value: activeCount, icon: ClipboardList, colorClass: "text-primary", bgClass: "bg-primary/10" },
    { key: "awaiting", title: "Pend. recepción", value: awaitingReceptionCount, icon: PackageCheck, colorClass: "text-accent", bgClass: "bg-accent/10" },
  ];

  const attentionIcon = (type: string) => {
    switch (type) {
      case "overdue": return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
      case "rejected": return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
      case "incident": return <AlertCircle className="h-4 w-4 text-warning shrink-0" />;
      case "no_doc": return <FileWarning className="h-4 w-4 text-warning shrink-0" />;
      case "ready": return <PackageCheck className="h-4 w-4 text-primary shrink-0" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  // ── Type filter tabs ───────────────────────────────────
  const typeFilters: { key: TypeFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "pedido", label: "📦 Pedidos" },
    { key: "consulta", label: "💬 Consultas" },
  ];

  // Count items by type for filter badges
  const pedidoCount = useMemo(() => {
    let list = queueItems.filter(i => i.itemType === "pedido");
    if (activeFilter === "overdue") list = list.filter(i => isOverdue(i.priority));
    else if (activeFilter === "today") list = list.filter(i => i.priority === "today");
    return list.length;
  }, [queueItems, activeFilter]);

  const consultaCount = useMemo(() => {
    let list = queueItems.filter(i => i.itemType === "consulta");
    if (activeFilter === "overdue") list = list.filter(i => isOverdue(i.priority));
    else if (activeFilter === "today") list = list.filter(i => i.priority === "today");
    return list.length;
  }, [queueItems, activeFilter]);

  return (
    <div className="space-y-6">
      {/* Header + Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {isDriver ? "Panel del Chofer" : "Mi Panel Operativo"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {profile?.full_name} — {new Date().toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        {!isDriver && (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate("/solicitudes?action=new")}>
              <Plus className="h-4 w-4" />
              Nuevo pedido
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/consultas?action=new")}>
              <Search className="h-4 w-4" />
              Nueva consulta
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
                      isActive ? "ring-2 ring-primary shadow-md" : "glass-card"
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Main: Prioritized Queue */}
            <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="font-display text-base">
                      Cola operativa
                      {activeFilter !== "all" && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          — {kpis.find(k => k.key === activeFilter)?.title}
                        </span>
                      )}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      {(activeFilter !== "all" || typeFilter !== "all") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => { setActiveFilter("all"); setTypeFilter("all"); }}
                        >
                          Limpiar filtros
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Type filter tabs */}
                  <div className="flex gap-1.5 mt-2">
                    {typeFilters.map((tf) => {
                      const count = tf.key === "all"
                        ? filteredItems.length
                        : tf.key === "pedido" ? pedidoCount : consultaCount;
                      const isActive = typeFilter === tf.key;
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
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      {activeFilter !== "all" || typeFilter !== "all"
                        ? "Sin ítems en esta categoría"
                        : "Sin pedidos ni consultas pendientes 🎉"}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredItems.map((qi) => {
                        const badge = PRIORITY_BADGE[qi.priority];
                        const rowClass = PRIORITY_ROW_CLASS[qi.priority];
                        const isPedido = qi.itemType === "pedido";

                        // Determine action label
                        let actionLabel = "Gestionar";
                        let actionIcon = <ArrowRight className="h-3 w-3 ml-1" />;
                        if (!isPedido) {
                          if (qi.hasResponses && qi.isRequester) {
                            actionLabel = "Crear pedido";
                            actionIcon = <Plus className="h-3 w-3 ml-1" />;
                          } else if (qi.isRequester) {
                            actionLabel = "Revisar";
                          } else {
                            actionLabel = "Responder";
                          }
                        }

                        // For consultations: navigate to create order
                        const handleAction = () => {
                          if (!isPedido && qi.hasResponses && qi.isRequester) {
                            navigate(`/solicitudes?action=new&from_consultation=${qi.id}`);
                          } else {
                            navigate(qi.navigateTo);
                          }
                        };

                        return (
                          <div
                            key={`${qi.itemType}-${qi.id}`}
                            className={`flex items-center gap-2 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors ${rowClass}`}
                          >
                            {/* Type badge */}
                            {isPedido ? (
                              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 shrink-0">
                                <Package className="h-3 w-3" />
                                Pedido
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-secondary/80 text-secondary-foreground border border-secondary shrink-0">
                                <MessageSquare className="h-3 w-3" />
                                Consulta
                              </span>
                            )}

                            {/* Number */}
                            {qi.number && (
                              <span className="text-sm font-mono font-semibold text-foreground shrink-0">
                                #{qi.number}
                              </span>
                            )}

                            {/* Label */}
                            <span className="text-sm text-foreground truncate flex-1">
                              {qi.label}
                            </span>

                            {/* Status badge */}
                            {isPedido ? (
                              <StatusBadge status={qi.status} config={REQUEST_STATUS_CONFIG} />
                            ) : (
                              <StatusBadge status={qi.status} config={CONSULTATION_STATUS_CONFIG} />
                            )}

                            {/* Priority badge */}
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 hidden md:inline-flex ${badge.className}`}>
                              {badge.label}
                            </span>

                            {/* Time */}
                            <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                              {timeAgo(qi.createdAt)}
                            </span>

                            {/* Action */}
                            <Button
                              variant={!isPedido && qi.hasResponses && qi.isRequester ? "default" : "ghost"}
                              size="sm"
                              className="h-7 px-2 text-xs shrink-0"
                              onClick={handleAction}
                            >
                              {actionLabel}
                              {actionIcon}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Side: Attention Cases */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="glass-card">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-warning" />
                    Requieren atención
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!attentionCases.length ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      Sin alertas activas ✅
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {attentionCases.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          {attentionIcon(c.icon)}
                          {/* Type mini-badge */}
                          <span className={`text-[9px] font-bold uppercase shrink-0 ${
                            c.itemType === "pedido" ? "text-primary" : "text-secondary-foreground"
                          }`}>
                            {c.itemType === "pedido" ? "📦" : "💬"}
                          </span>
                          <p className="text-xs text-foreground flex-1 truncate">{c.description}</p>
                          {c.navigateTo && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] shrink-0"
                              onClick={() => navigate(c.navigateTo!)}
                            >
                              Ver
                            </Button>
                          )}
                        </div>
                      ))}
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
