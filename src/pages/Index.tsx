import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Truck, ClipboardList, PackageCheck,
  Loader2, Plus, Search, ArrowRight, Clock, FileWarning,
  XCircle, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";

// ── Priority helpers ───────────────────────────────────────
const SLA_HOURS = 24;

type Priority = "overdue" | "today" | "normal";

function getRequestPriority(createdAt: string): Priority {
  const created = new Date(createdAt);
  const now = new Date();
  const hoursElapsed = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
  if (hoursElapsed > SLA_HOURS) return "overdue";
  const isToday = created.toDateString() === now.toDateString();
  if (isToday || hoursElapsed > SLA_HOURS * 0.75) return "today";
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

const PRIORITY_ORDER: Record<Priority, number> = { overdue: 0, today: 1, normal: 2 };

const PRIORITY_BADGE: Record<Priority, { label: string; className: string }> = {
  overdue: { label: "Atrasado", className: "bg-destructive/15 text-destructive border-destructive/30" },
  today: { label: "Hoy", className: "bg-warning/15 text-warning border-warning/30" },
  normal: { label: "Normal", className: "bg-muted text-muted-foreground border-border" },
};

const PRIORITY_ROW_CLASS: Record<Priority, string> = {
  overdue: "border-l-2 border-l-destructive bg-destructive/5",
  today: "border-l-2 border-l-warning bg-warning/5",
  normal: "",
};

// ── Animation ──────────────────────────────────────────────
const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } };

// ── KPI filter type ────────────────────────────────────────
type KpiFilter = "all" | "overdue" | "today" | "active" | "awaiting";

export default function Index() {
  const { profile, hasRole, isOwner } = useAuth();
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();
  const navigate = useNavigate();
  const isAdmin = hasRole("admin") || hasRole("supervisor") || isOwner;
  const isDriver = hasRole("driver");

  const [activeFilter, setActiveFilter] = useState<KpiFilter>("all");

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

  // Attention cases: overdue, rejected, incidents, missing docs
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
      let query = supabase
        .from("logistics_incidents")
        .select("id, title, branch_request_id, status")
        .in("status", ["open", "under_review"] as any)
        .limit(10);
      const { data } = await query;
      return data || [];
    },
  });

  // ── Derived data ───────────────────────────────────────
  const enrichedRequests = useMemo(() => {
    if (!pendingRequests) return [];
    return pendingRequests.map((r: any) => ({
      ...r,
      priority: getRequestPriority(r.created_at),
    })).sort((a: any, b: any) => PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority]);
  }, [pendingRequests]);

  const overdueCount = enrichedRequests.filter((r: any) => r.priority === "overdue").length;
  const todayCount = enrichedRequests.filter((r: any) => r.priority === "today").length;
  const activeCount = enrichedRequests.length;
  const awaitingReceptionCount = activeFulfillments?.filter(
    (f) => f.status === "delivered" || f.status === "pending_physical_confirmation"
  ).length || 0;

  // Build attention cases
  const attentionCases = useMemo(() => {
    const cases: { id: string; requestNumber?: number; icon: "overdue" | "rejected" | "incident" | "no_doc"; description: string; requestId?: string }[] = [];

    // Overdue requests
    enrichedRequests
      .filter((r: any) => r.priority === "overdue")
      .slice(0, 5)
      .forEach((r: any) => {
        cases.push({
          id: `overdue-${r.id}`,
          requestNumber: r.request_number,
          icon: "overdue",
          description: `Pedido #${r.request_number} atrasado (${timeAgo(r.created_at)})`,
          requestId: r.id,
        });
      });

    // Rejected
    attentionRequests?.forEach((r: any) => {
      cases.push({
        id: `rejected-${r.id}`,
        requestNumber: r.request_number,
        icon: "rejected",
        description: `Pedido #${r.request_number} rechazado`,
        requestId: r.id,
      });
    });

    // Incidents
    openIncidents?.forEach((inc: any) => {
      cases.push({
        id: `incident-${inc.id}`,
        icon: "incident",
        description: inc.title || "Incidencia abierta",
        requestId: inc.branch_request_id,
      });
    });

    return cases.slice(0, 8);
  }, [enrichedRequests, attentionRequests, openIncidents]);

  // Filtered list based on active KPI
  const filteredRequests = useMemo(() => {
    if (activeFilter === "all") return enrichedRequests;
    if (activeFilter === "overdue") return enrichedRequests.filter((r: any) => r.priority === "overdue");
    if (activeFilter === "today") return enrichedRequests.filter((r: any) => r.priority === "today");
    return enrichedRequests;
  }, [enrichedRequests, activeFilter]);

  const isLoading = loadingRequests || loadingFulfillments;

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
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

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
          {/* KPI Cards – clickable filters */}
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
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display text-base">
                      Cola operativa
                      {activeFilter !== "all" && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          — filtro: {kpis.find(k => k.key === activeFilter)?.title}
                        </span>
                      )}
                    </CardTitle>
                    {activeFilter !== "all" && (
                      <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setActiveFilter("all")}>
                        Ver todos
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {!filteredRequests.length ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      {activeFilter !== "all" ? "Sin pedidos en esta categoría" : "Sin pedidos pendientes 🎉"}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {filteredRequests.map((r: any) => {
                        const badge = PRIORITY_BADGE[r.priority as Priority];
                        const rowClass = PRIORITY_ROW_CLASS[r.priority as Priority];
                        return (
                          <div
                            key={r.id}
                            className={`flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors ${rowClass}`}
                          >
                            <span className="text-sm font-mono font-semibold text-foreground shrink-0">
                              #{r.request_number}
                            </span>
                            <span className="text-sm text-foreground truncate flex-1">
                              {r.source_branch?.name} → {r.requesting_branch?.name}
                            </span>
                            <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                              {badge.label}
                            </span>
                            <span className="text-[11px] text-muted-foreground shrink-0 hidden sm:inline">
                              {timeAgo(r.created_at)}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs shrink-0"
                              onClick={() => navigate(`/solicitudes?detail=${r.id}`)}
                            >
                              Gestionar
                              <ArrowRight className="h-3 w-3 ml-1" />
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
                          className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          {attentionIcon(c.icon)}
                          <p className="text-xs text-foreground flex-1 truncate">{c.description}</p>
                          {c.requestId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] shrink-0"
                              onClick={() => navigate(`/solicitudes?detail=${c.requestId}`)}
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
