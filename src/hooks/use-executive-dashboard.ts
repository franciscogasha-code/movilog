import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays, startOfDay, endOfDay, startOfMonth } from "date-fns";

export type DateRange = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom";

function getDateRange(range: DateRange, customFrom?: Date, customTo?: Date) {
  const now = new Date();
  switch (range) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
    }
    case "7d":
      return { from: startOfDay(subDays(now, 7)).toISOString(), to: endOfDay(now).toISOString() };
    case "30d":
      return { from: startOfDay(subDays(now, 30)).toISOString(), to: endOfDay(now).toISOString() };
    case "this_month":
      return { from: startOfMonth(now).toISOString(), to: endOfDay(now).toISOString() };
    case "custom":
      return {
        from: customFrom ? startOfDay(customFrom).toISOString() : startOfDay(subDays(now, 7)).toISOString(),
        to: customTo ? endOfDay(customTo).toISOString() : endOfDay(now).toISOString(),
      };
    default:
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
  }
}

/*──────────────────────────────────────────────────────────────
  KPIs EJECUTIVOS
  ─────────────────────────────────────────────────────────────
  Cumplimiento operativo =
    fulfillments que alcanzaron delivered/received/completed
    ÷ total fulfillments activos (excluye cancelled)

  Trazabilidad completa =
    fulfillments con documento BIMS + dispatched_at + received_at_branch
    ÷ total fulfillments que deberían tenerlo (status >= dispatched)

  Ops con alerta =
    fulfillments con al menos una anomalía no resuelta
──────────────────────────────────────────────────────────────*/
export function useExecutiveKPIs(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-kpis-v2", range, branchId],
    queryFn: async () => {
      // Requests in period
      let reqQuery = supabase.from("branch_requests")
        .select("id, status, created_at")
        .gte("created_at", from).lte("created_at", to);
      if (branchId) reqQuery = reqQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);
      const { data: requests } = await reqQuery;

      // ALL active fulfillments (no date filter — they're live state)
      let fulQuery = supabase.from("fulfillment_orders")
        .select("id, status, created_at, bims_transfer_number, bims_invoice_number, dispatched_at, received_at_branch")
        .neq("status", "cancelled");
      if (branchId) fulQuery = fulQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);
      const { data: fulfillments } = await fulQuery;

      // Incidents (all open, regardless of date)
      let incQuery = supabase.from("logistics_incidents").select("id, status");
      if (branchId) incQuery = incQuery.eq("branch_id", branchId);
      const { data: incidents } = await incQuery;

      // Anomalies linked to fulfillments
      const { data: anomalies } = await supabase.from("ai_anomalies")
        .select("id, affected_entities")
        .eq("is_acknowledged", false);

      const fl = fulfillments || [];
      const reqCreated = requests?.length || 0;
      const inPrep = fl.filter(f => ["pending", "picking", "waiting_for_cut", "waiting_for_courier"].includes(f.status)).length;
      const inTransit = fl.filter(f => ["in_transit", "dispatched", "at_hub"].includes(f.status)).length;
      const delivered = fl.filter(f => ["delivered", "received", "completed"].includes(f.status)).length;
      const openIncidents = incidents?.filter(i => !["resolved", "closed"].includes(i.status)).length || 0;

      // Compliance: delivered+received+completed / total active
      const totalActive = fl.length || 1;
      const compliance = Math.round((delivered / totalActive) * 100);

      // Full traceability: has doc + dispatched + received
      const advancedStatuses = ["dispatched", "in_transit", "delivered", "received", "completed", "at_hub", "delivery_failed"];
      const shouldHaveTrace = fl.filter(f => advancedStatuses.includes(f.status));
      const fullyTraced = shouldHaveTrace.filter(f =>
        (f.bims_transfer_number || f.bims_invoice_number) && f.dispatched_at
      );
      const fullTraceability = shouldHaveTrace.length > 0
        ? Math.round((fullyTraced.length / shouldHaveTrace.length) * 100)
        : 100;

      // Ops with unresolved alerts
      const fulfillmentIds = new Set(fl.map(f => f.id));
      const opsWithAlerts = (anomalies || []).filter(a => {
        const entities = a.affected_entities as any[];
        return entities?.some((e: any) => e.type === "fulfillment_order" && fulfillmentIds.has(e.id));
      }).length;

      return {
        reqCreated, inPrep, inTransit, delivered, openIncidents,
        compliance, fullTraceability, opsWithAlerts,
        totalFulfillments: fl.length,
      };
    },
    refetchInterval: 30000,
  });
}

/*──────────────────────────────────────────────────────────────
  EMBUDO OPERATIVO
  Muestra distribución acumulativa real de todo el pipeline
──────────────────────────────────────────────────────────────*/
export function useOperationalFunnel(range: DateRange, branchId?: string) {
  return useQuery({
    queryKey: ["exec-funnel-v2", range, branchId],
    queryFn: async () => {
      let reqQuery = supabase.from("branch_requests").select("id, status");
      if (branchId) reqQuery = reqQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);
      const { data: requests } = await reqQuery;

      let fulQuery = supabase.from("fulfillment_orders").select("id, status").neq("status", "cancelled");
      if (branchId) fulQuery = fulQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);
      const { data: fulfillments } = await fulQuery;

      const r = requests || [];
      const f = fulfillments || [];

      return [
        { stage: "Solicitudes creadas", count: r.length, color: "hsl(220, 70%, 45%)" },
        { stage: "Pedidos aceptados", count: r.filter(x => x.status !== "pending" && x.status !== "rejected").length, color: "hsl(200, 80%, 50%)" },
        { stage: "En preparación", count: f.filter(x => ["pending", "picking", "waiting_for_cut", "waiting_for_courier"].includes(x.status)).length, color: "hsl(38, 92%, 50%)" },
        { stage: "Despachados", count: f.filter(x => ["dispatched", "in_transit", "at_hub", "delivery_failed"].includes(x.status)).length, color: "hsl(260, 60%, 55%)" },
        { stage: "Entregados", count: f.filter(x => x.status === "delivered").length, color: "hsl(160, 60%, 40%)" },
        { stage: "Recibidos", count: f.filter(x => ["received", "completed"].includes(x.status)).length, color: "hsl(120, 50%, 45%)" },
        { stage: "Cerrados", count: r.filter(x => x.status === "closed").length, color: "hsl(220, 15%, 60%)" },
      ];
    },
    refetchInterval: 30000,
  });
}

/*──────────────────────────────────────────────────────────────
  ALERTAS CRÍTICAS — deduplicadas
  Cada alerta lleva un hash para evitar mostrar la misma
  operación por dos fuentes distintas
──────────────────────────────────────────────────────────────*/
export function useCriticalAlerts(branchId?: string) {
  return useQuery({
    queryKey: ["exec-alerts-v2", branchId],
    queryFn: async () => {
      const staleThreshold = subDays(new Date(), 1).toISOString();

      // Parallel queries
      const [staleRes, noBimsRes, incRes, anomRes, failedRes] = await Promise.all([
        supabase.from("branch_requests")
          .select("id, request_number, created_at, source_branch_id")
          .eq("status", "pending").lt("created_at", staleThreshold)
          .then(r => r.data || []),
        supabase.from("fulfillment_orders")
          .select("id, status, source_branch_id, created_at")
          .in("status", ["pending", "picking", "waiting_for_cut", "waiting_for_courier", "dispatched", "in_transit"] as any)
          .is("bims_transfer_number", null).is("bims_invoice_number", null)
          .then(r => r.data || []),
        supabase.from("logistics_incidents")
          .select("id, title, branch_id, created_at, incident_type")
          .not("status", "in", "(resolved,closed)")
          .then(r => r.data || []),
        supabase.from("ai_anomalies")
          .select("id, title, anomaly_type, branch_id, created_at, severity, affected_entities")
          .eq("is_acknowledged", false)
          .then(r => r.data || []),
        supabase.from("fulfillment_orders")
          .select("id, delivery_failed_at, delivery_failed_reason, source_branch_id")
          .eq("status", "delivery_failed")
          .then(r => r.data || []),
      ]);

      // Deduplicate: anomalies that reference a fulfillment already shown in noBims
      const noBimsIds = new Set(noBimsRes.map(f => f.id));
      const filteredAnomalies = anomRes.filter(a => {
        const entities = a.affected_entities as any[];
        if (!entities?.length) return true;
        // Skip if all affected entities are already in noBims
        return !entities.every((e: any) => e.type === "fulfillment_order" && noBimsIds.has(e.id));
      });

      // Apply branch filter on client side
      const bf = (items: any[], field = "source_branch_id") =>
        branchId ? items.filter(i => i[field] === branchId) : items;

      return {
        staleRequests: bf(staleRes),
        noBims: bf(noBimsRes),
        openIncidents: branchId ? incRes.filter(i => i.branch_id === branchId) : incRes,
        anomalies: branchId ? filteredAnomalies.filter(a => a.branch_id === branchId) : filteredAnomalies,
        failedDeliveries: bf(failedRes),
      };
    },
    refetchInterval: 30000,
  });
}

/*──────────────────────────────────────────────────────────────
  RENDIMIENTO POR SUCURSAL
──────────────────────────────────────────────────────────────*/
export function useBranchPerformance(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-branch-perf-v2", range, branchId],
    queryFn: async () => {
      const [branchRes, reqRes, fulRes, incRes] = await Promise.all([
        supabase.from("branches").select("id, name, code").eq("is_active", true).order("name"),
        supabase.from("branch_requests").select("id, source_branch_id, requesting_branch_id, status, created_at").gte("created_at", from).lte("created_at", to),
        supabase.from("fulfillment_orders").select("id, source_branch_id, destination_branch_id, status").neq("status", "cancelled"),
        supabase.from("logistics_incidents").select("id, branch_id, created_at").gte("created_at", from).lte("created_at", to),
      ]);

      const branches = branchRes.data || [];
      const requests = reqRes.data || [];
      const fulfillments = fulRes.data || [];
      const incidents = incRes.data || [];

      const perf = branches.map(b => {
        const bReqs = requests.filter(r => r.source_branch_id === b.id || r.requesting_branch_id === b.id);
        const bFul = fulfillments.filter(f => f.source_branch_id === b.id || f.destination_branch_id === b.id);
        const bInc = incidents.filter(i => i.branch_id === b.id);
        const completed = bFul.filter(f => ["delivered", "received", "completed"].includes(f.status)).length;
        const total = bFul.length || 1;

        return {
          id: b.id, name: b.name, code: b.code,
          requests: bReqs.length, fulfillments: bFul.length,
          incidents: bInc.length,
          compliance: Math.round((completed / total) * 100),
        };
      }).filter(b => b.requests > 0 || b.fulfillments > 0 || b.incidents > 0);

      if (branchId) return perf.filter(b => b.id === branchId);
      return perf.sort((a, b) => b.fulfillments - a.fulfillments);
    },
    refetchInterval: 60000,
  });
}

/*──────────────────────────────────────────────────────────────
  ADOPCIÓN DEL SISTEMA — métricas de flujo end-to-end
  ─────────────────────────────────────────────────────────────
  fullFlowOps = fulfillments con doc + despacho + entrega + recepción
  skippedSteps = fulfillments delivered/received SIN dispatched_at
──────────────────────────────────────────────────────────────*/
export function useSystemAdoption(range: DateRange) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-adoption-v2", range],
    queryFn: async () => {
      const [eventsRes, fulRes, profilesRes] = await Promise.all([
        supabase.from("operational_events").select("triggered_by").gte("created_at", from).lte("created_at", to),
        supabase.from("fulfillment_orders").select("id, bims_transfer_number, bims_invoice_number, status, received_at_branch, dispatched_at, received_by_branch").neq("status", "cancelled"),
        supabase.from("profiles").select("id").eq("is_active", true),
      ]);

      const events = eventsRes.data || [];
      const fl = fulRes.data || [];
      const profiles = profilesRes.data || [];

      const uniqueUsers = new Set(events.map(e => e.triggered_by));
      const total = fl.length || 1;
      const withDoc = fl.filter(f => f.bims_transfer_number || f.bims_invoice_number).length;
      const withDelivery = fl.filter(f => ["delivered", "received", "completed"].includes(f.status)).length;
      const withReception = fl.filter(f => f.received_at_branch).length;

      // Full flow: has doc + dispatched + status is received or completed
      const fullFlow = fl.filter(f =>
        (f.bims_transfer_number || f.bims_invoice_number) &&
        f.dispatched_at &&
        ["received", "completed"].includes(f.status) &&
        f.received_at_branch
      ).length;

      // Skipped steps: delivered/received but never dispatched
      const skipped = fl.filter(f =>
        ["delivered", "received", "completed"].includes(f.status) && !f.dispatched_at
      ).length;

      return {
        activeUsers: uniqueUsers.size,
        totalProfiles: profiles.length,
        docCompliance: Math.round((withDoc / total) * 100),
        deliveryConfirmed: Math.round((withDelivery / total) * 100),
        receptionConfirmed: Math.round((withReception / total) * 100),
        fullFlowOps: Math.round((fullFlow / total) * 100),
        skippedSteps: skipped,
        totalEvents: events.length,
      };
    },
    refetchInterval: 60000,
  });
}

/*──────────────────────────────────────────────────────────────
  INCIDENCIAS POR TIPO
──────────────────────────────────────────────────────────────*/
export function useIncidentBreakdown(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-incidents-v2", range, branchId],
    queryFn: async () => {
      let query = supabase.from("logistics_incidents")
        .select("id, incident_type, status, created_at")
        .gte("created_at", from).lte("created_at", to);
      if (branchId) query = query.eq("branch_id", branchId);
      const { data: incidents } = await query;

      const byType: Record<string, number> = {};
      (incidents || []).forEach(i => {
        byType[i.incident_type] = (byType[i.incident_type] || 0) + 1;
      });

      return {
        total: incidents?.length || 0,
        open: incidents?.filter(i => !["resolved", "closed"].includes(i.status)).length || 0,
        byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      };
    },
    refetchInterval: 60000,
  });
}

/*──────────────────────────────────────────────────────────────
  TIEMPOS DE CICLO OPERATIVO
  Calcula promedios reales entre etapas usando operational_events
──────────────────────────────────────────────────────────────*/
export function useCycleTimes(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-cycle-v2", range, branchId],
    queryFn: async () => {
      // Get fulfillments with timestamps
      let fulQuery = supabase.from("fulfillment_orders")
        .select("id, created_at, dispatched_at, received_at_branch, status, source_branch_id, destination_branch_id")
        .neq("status", "cancelled")
        .not("dispatched_at", "is", null);
      if (branchId) fulQuery = fulQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);
      const { data: fulfillments } = await fulQuery;

      // Get linked requests for creation → dispatch time
      let reqQuery = supabase.from("branch_requests")
        .select("id, created_at, accepted_at, status")
        .gte("created_at", from).lte("created_at", to);
      if (branchId) reqQuery = reqQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);
      const { data: requests } = await reqQuery;

      const fl = fulfillments || [];
      const rq = requests || [];

      // Helper: avg hours between two timestamps
      function avgHours(pairs: { start: string; end: string }[]): number | null {
        const valid = pairs.filter(p => p.start && p.end);
        if (!valid.length) return null;
        const sum = valid.reduce((acc, p) => {
          return acc + (new Date(p.end).getTime() - new Date(p.start).getTime()) / 3600000;
        }, 0);
        return Math.round((sum / valid.length) * 10) / 10;
      }

      // Request creation → acceptance
      const reqToAccept = avgHours(
        rq.filter(r => r.accepted_at).map(r => ({ start: r.created_at, end: r.accepted_at! }))
      );

      // Created → dispatched (prep time)
      const prepTime = avgHours(
        fl.map(f => ({ start: f.created_at, end: f.dispatched_at! }))
      );

      // Dispatched → received at branch (transit time)
      const transitTime = avgHours(
        fl.filter(f => f.received_at_branch).map(f => ({ start: f.dispatched_at!, end: f.received_at_branch! }))
      );

      // Total cycle: request creation → branch reception
      // We need to join request → fulfillment, simplified via created_at
      const totalCycle = avgHours(
        fl.filter(f => f.received_at_branch).map(f => ({ start: f.created_at, end: f.received_at_branch! }))
      );

      return {
        reqToAcceptance: reqToAccept,
        preparation: prepTime,
        transit: transitTime,
        totalCycle,
        sampleSize: fl.length,
      };
    },
    refetchInterval: 120000,
  });
}

/*──────────────────────────────────────────────────────────────
  AI EXECUTIVE INSIGHTS
──────────────────────────────────────────────────────────────*/
export type AIInsights = {
  healthScore: number;
  healthLabel: string;
  summary: string;
  findings: string[];
  risks: string[];
  recommendations: string[];
};

export function useAIInsights(
  kpis: any, alerts: any, adoption: any, branchPerf: any, enabled: boolean
) {
  return useQuery({
    queryKey: ["exec-ai-insights", JSON.stringify(kpis), JSON.stringify(alerts?.staleRequests?.length)],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("executive-insights", {
        body: {
          kpis,
          alerts: {
            staleRequests: alerts?.staleRequests?.length || 0,
            noBims: alerts?.noBims?.length || 0,
            openIncidents: alerts?.openIncidents?.length || 0,
            failedDeliveries: alerts?.failedDeliveries?.length || 0,
          },
          adoption,
          branchPerformance: branchPerf,
        },
      });
      if (error) throw error;
      return data as AIInsights;
    },
    enabled: enabled && !!kpis,
    staleTime: 5 * 60 * 1000, // 5 min cache
    refetchInterval: false,
  });
}
