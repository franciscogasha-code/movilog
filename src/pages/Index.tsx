import { motion } from "framer-motion";
import {
  Package, ShoppingCart, ArrowRightLeft, TrendingUp, Clock,
  AlertTriangle, CheckCircle2, Truck, ClipboardList, PackageCheck,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/hooks/use-branches";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function Index() {
  const { profile, hasRole, isOwner } = useAuth();
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();
  const { data: branches } = useBranches();
  const isAdmin = hasRole("admin") || hasRole("supervisor") || isOwner;
  const isDriver = hasRole("driver");

  // Pending requests for user's branches
  const { data: pendingRequests, isLoading: loadingRequests } = useQuery({
    queryKey: ["dashboard-pending", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("branch_requests")
        .select(`
          id, request_number, status, created_at, shipping_method,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name),
          source_branch:branches!branch_requests_source_branch_id_fkey(name)
        `)
        .in("status", ["pending", "accepted", "picking"] as any)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(`requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`);
      }
      const { data } = await query;
      return data || [];
    },
  });

  // Fulfillments needing attention
  const { data: activeFulfillments, isLoading: loadingFulfillments } = useQuery({
    queryKey: ["dashboard-fulfillments", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("fulfillment_orders")
        .select("id, status, source_branch_id, destination_branch_id")
        .not("status", "in", '("completed","cancelled","received")')
        .limit(100);

      const { data } = await query;
      return data || [];
    },
  });

  // Open incidents
  const { data: openIncidents } = useQuery({
    queryKey: ["dashboard-incidents"],
    queryFn: async () => {
      const { data } = await supabase
        .from("logistics_incidents")
        .select("id")
        .in("status", ["open", "under_review"] as any)
        .limit(100);
      return data?.length || 0;
    },
  });

  // Recent events
  const { data: recentEvents } = useQuery({
    queryKey: ["dashboard-events", isAllBranches, allowedBranchIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("operational_events")
        .select("id, event_type, event_description, created_at, new_status")
        .order("created_at", { ascending: false })
        .limit(8);
      return data || [];
    },
  });

  const pendingCount = pendingRequests?.length || 0;
  const preparingCount = activeFulfillments?.filter(f => f.status === "picking" || f.status === "pending").length || 0;
  const inTransitCount = activeFulfillments?.filter(f => f.status === "dispatched" || f.status === "in_transit").length || 0;
  const awaitingReceptionCount = activeFulfillments?.filter(f => f.status === "delivered" || f.status === "pending_physical_confirmation").length || 0;

  const isLoading = loadingRequests || loadingFulfillments;

  // Role-specific title
  const getRoleTitle = () => {
    if (isDriver) return "Panel del Chofer";
    if (isAdmin) return "Centro de Control Logístico";
    return "Mi Panel Operativo";
  };

  const kpis = isDriver
    ? [
        { title: "En tránsito", value: String(inTransitCount), icon: Truck, color: "text-primary", bg: "bg-primary/10" },
        { title: "Pendientes entrega", value: String(awaitingReceptionCount), icon: PackageCheck, color: "text-accent", bg: "bg-accent/10" },
      ]
    : [
        { title: "Pedidos pendientes", value: String(pendingCount), icon: ClipboardList, color: "text-primary", bg: "bg-primary/10" },
        { title: "En preparación", value: String(preparingCount), icon: Package, color: "text-secondary", bg: "bg-secondary/10" },
        { title: "En tránsito", value: String(inTransitCount), icon: Truck, color: "text-accent", bg: "bg-accent/10" },
        { title: "Pend. recepción", value: String(awaitingReceptionCount), icon: PackageCheck, color: "text-primary", bg: "bg-primary/10" },
      ];

  if (isAdmin) {
    kpis.push({ title: "Incidencias abiertas", value: String(openIncidents || 0), icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" });
  }

  const eventIcon = (type: string) => {
    if (type.includes("dispatch") || type.includes("pickup")) return <Truck className="h-3.5 w-3.5 text-primary" />;
    if (type.includes("reception") || type.includes("received")) return <CheckCircle2 className="h-3.5 w-3.5 text-accent" />;
    if (type.includes("incident") || type.includes("rejected")) return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">{getRoleTitle()}</h1>
        <p className="text-muted-foreground mt-1">
          {profile?.full_name} — {new Date().toLocaleDateString("es-PY", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <motion.div
            className={`grid grid-cols-1 sm:grid-cols-2 ${isDriver ? "lg:grid-cols-2" : "lg:grid-cols-4"} gap-4`}
            variants={container}
            initial="hidden"
            animate="show"
          >
            {kpis.map((kpi) => (
              <motion.div key={kpi.title} variants={item}>
                <Card className="glass-card hover:shadow-xl transition-shadow duration-300">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{kpi.title}</p>
                        <p className="text-3xl font-display font-bold mt-2 text-foreground">{kpi.value}</p>
                      </div>
                      <div className={`${kpi.bg} p-2.5 rounded-xl`}>
                        <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Pending requests */}
            <motion.div className="lg:col-span-2" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
              <Card className="glass-card">
                <CardHeader className="pb-3">
                  <CardTitle className="font-display text-lg">
                    {isDriver ? "Entregas pendientes" : "Pedidos pendientes"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!pendingRequests?.length ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Sin pedidos pendientes</p>
                  ) : (
                    <div className="space-y-1">
                      {pendingRequests.map((r: any) => (
                        <div key={r.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
                          <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-mono font-semibold text-foreground shrink-0">#{r.request_number}</span>
                          <span className="text-sm text-foreground truncate flex-1">
                            {r.source_branch?.name} → {r.requesting_branch?.name}
                          </span>
                          <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(r.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent events */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <Card className="glass-card">
                <CardHeader className="pb-3">
                  <CardTitle className="font-display text-lg">Actividad reciente</CardTitle>
                </CardHeader>
                <CardContent>
                  {!recentEvents?.length ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Sin actividad reciente</p>
                  ) : (
                    <div className="space-y-1">
                      {recentEvents.map((ev: any) => (
                        <div key={ev.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-muted/50 transition-colors">
                          {eventIcon(ev.event_type)}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground truncate">{ev.event_description || ev.event_type}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(ev.created_at).toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
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
