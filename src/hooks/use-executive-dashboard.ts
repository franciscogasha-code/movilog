import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { subDays, startOfDay, endOfDay, startOfWeek, startOfMonth, subWeeks, subMonths, format } from "date-fns";

export type DateRange = "today" | "yesterday" | "7d" | "30d" | "this_month" | "custom";

function getDateRange(range: DateRange, customFrom?: Date, customTo?: Date) {
  const now = new Date();
  switch (range) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "yesterday":
      const y = subDays(now, 1);
      return { from: startOfDay(y).toISOString(), to: endOfDay(y).toISOString() };
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

export function useExecutiveKPIs(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-kpis", range, branchId],
    queryFn: async () => {
      // Requests created in range
      let reqQuery = supabase.from("branch_requests").select("id, status, created_at", { count: "exact", head: false });
      reqQuery = reqQuery.gte("created_at", from).lte("created_at", to);
      if (branchId) reqQuery = reqQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);

      const { data: requests } = await reqQuery;

      // Fulfillments in range
      let fulQuery = supabase.from("fulfillment_orders").select("id, status, created_at, bims_transfer_number, bims_invoice_number");
      if (branchId) fulQuery = fulQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);

      const { data: fulfillments } = await fulQuery;

      // Incidents
      let incQuery = supabase.from("logistics_incidents").select("id, status, created_at");
      if (branchId) incQuery = incQuery.eq("branch_id", branchId);

      const { data: incidents } = await incQuery;

      const reqCreated = requests?.length || 0;
      const inPrep = fulfillments?.filter(f => ["pending", "picking", "waiting_for_cut", "waiting_for_courier"].includes(f.status)).length || 0;
      const inTransit = fulfillments?.filter(f => ["in_transit", "dispatched"].includes(f.status)).length || 0;
      const deliveredToday = fulfillments?.filter(f => f.status === "delivered" && f.created_at >= from).length || 0;
      const openIncidents = incidents?.filter(i => !["resolved", "closed"].includes(i.status)).length || 0;

      const totalOps = fulfillments?.length || 1;
      const completedOps = fulfillments?.filter(f => ["delivered", "received", "completed"].includes(f.status)).length || 0;
      const compliance = totalOps > 0 ? Math.round((completedOps / totalOps) * 100) : 0;

      return { reqCreated, inPrep, inTransit, deliveredToday, openIncidents, compliance, totalFulfillments: fulfillments?.length || 0 };
    },
    refetchInterval: 30000,
  });
}

export function useOperationalFunnel(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-funnel", range, branchId],
    queryFn: async () => {
      let reqQuery = supabase.from("branch_requests").select("id, status");
      if (branchId) reqQuery = reqQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);
      const { data: requests } = await reqQuery;

      let fulQuery = supabase.from("fulfillment_orders").select("id, status");
      if (branchId) fulQuery = fulQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);
      const { data: fulfillments } = await fulQuery;

      const totalReqs = requests?.length || 0;
      const pending = requests?.filter(r => r.status === "pending").length || 0;
      const inPrep = requests?.filter(r => r.status === "in_preparation").length || 0;
      const dispatched = fulfillments?.filter(f => ["dispatched", "in_transit"].includes(f.status)).length || 0;
      const delivered = fulfillments?.filter(f => f.status === "delivered").length || 0;
      const received = fulfillments?.filter(f => ["received", "completed"].includes(f.status)).length || 0;
      const closed = requests?.filter(r => r.status === "closed").length || 0;

      return [
        { stage: "Solicitudes", count: totalReqs, color: "hsl(220, 70%, 45%)" },
        { stage: "Pendientes", count: pending, color: "hsl(38, 92%, 50%)" },
        { stage: "En preparación", count: inPrep, color: "hsl(200, 80%, 50%)" },
        { stage: "Despachados", count: dispatched, color: "hsl(260, 60%, 55%)" },
        { stage: "Entregados", count: delivered, color: "hsl(160, 60%, 40%)" },
        { stage: "Recibidos", count: received, color: "hsl(120, 50%, 45%)" },
        { stage: "Cerrados", count: closed, color: "hsl(220, 15%, 60%)" },
      ];
    },
    refetchInterval: 30000,
  });
}

export function useCriticalAlerts(branchId?: string) {
  return useQuery({
    queryKey: ["exec-alerts", branchId],
    queryFn: async () => {
      // Stale pending requests (>24h)
      const staleThreshold = subDays(new Date(), 1).toISOString();
      let staleQuery = supabase.from("branch_requests").select("id, request_number, created_at, status, source_branch_id, requesting_branch_id").eq("status", "pending").lt("created_at", staleThreshold);
      if (branchId) staleQuery = staleQuery.or(`requesting_branch_id.eq.${branchId},source_branch_id.eq.${branchId}`);
      const { data: staleRequests } = await staleQuery;

      // Fulfillments without BIMS docs
      let noBimsQuery = supabase.from("fulfillment_orders").select("id, status, source_branch_id, created_at")
        .in("status", ["pending", "picking", "waiting_for_cut", "waiting_for_courier", "dispatched", "in_transit"] as any)
        .is("bims_transfer_number", null)
        .is("bims_invoice_number", null);
      if (branchId) noBimsQuery = noBimsQuery.eq("source_branch_id", branchId);
      const { data: noBims } = await noBimsQuery;

      // Open incidents
      let incQuery = supabase.from("logistics_incidents").select("id, title, branch_id, created_at, status, incident_type").not("status", "in", "(resolved,closed)");
      if (branchId) incQuery = incQuery.eq("branch_id", branchId);
      const { data: openIncidents } = await incQuery;

      // Unacknowledged anomalies
      let anomQuery = supabase.from("ai_anomalies").select("id, title, anomaly_type, branch_id, created_at, severity, alert_level").eq("is_acknowledged", false);
      if (branchId) anomQuery = anomQuery.eq("branch_id", branchId);
      const { data: anomalies } = await anomQuery;

      // Delivery failed
      let failedQuery = supabase.from("fulfillment_orders").select("id, delivery_failed_at, delivery_failed_reason, source_branch_id, destination_branch_id").eq("status", "delivery_failed");
      if (branchId) failedQuery = failedQuery.or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`);
      const { data: failed } = await failedQuery;

      return {
        staleRequests: staleRequests || [],
        noBims: noBims || [],
        openIncidents: openIncidents || [],
        anomalies: anomalies || [],
        failedDeliveries: failed || [],
      };
    },
    refetchInterval: 30000,
  });
}

export function useBranchPerformance(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-branch-perf", range, branchId],
    queryFn: async () => {
      // Get all branches
      const { data: branches } = await supabase.from("branches").select("id, name, code").eq("is_active", true).order("name");

      // Get requests per branch
      let reqQuery = supabase.from("branch_requests").select("id, source_branch_id, requesting_branch_id, status, created_at").gte("created_at", from).lte("created_at", to);
      const { data: requests } = await reqQuery;

      // Get fulfillments
      let fulQuery = supabase.from("fulfillment_orders").select("id, source_branch_id, destination_branch_id, status, created_at");
      const { data: fulfillments } = await fulQuery;

      // Get incidents
      let incQuery = supabase.from("logistics_incidents").select("id, branch_id, status, created_at").gte("created_at", from).lte("created_at", to);
      const { data: incidents } = await incQuery;

      const branchPerf = (branches || []).map(b => {
        const branchReqs = requests?.filter(r => r.source_branch_id === b.id || r.requesting_branch_id === b.id) || [];
        const branchFul = fulfillments?.filter(f => f.source_branch_id === b.id || f.destination_branch_id === b.id) || [];
        const branchInc = incidents?.filter(i => i.branch_id === b.id) || [];
        const completed = branchFul.filter(f => ["delivered", "received", "completed"].includes(f.status)).length;
        const total = branchFul.length || 1;

        return {
          id: b.id,
          name: b.name,
          code: b.code,
          requests: branchReqs.length,
          fulfillments: branchFul.length,
          incidents: branchInc.length,
          compliance: Math.round((completed / total) * 100),
        };
      }).filter(b => b.requests > 0 || b.fulfillments > 0 || b.incidents > 0);

      if (branchId) return branchPerf.filter(b => b.id === branchId);
      return branchPerf.sort((a, b) => b.fulfillments - a.fulfillments);
    },
    refetchInterval: 60000,
  });
}

export function useSystemAdoption(range: DateRange) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-adoption", range],
    queryFn: async () => {
      // Active users from events
      const { data: events } = await supabase.from("operational_events").select("triggered_by, created_at").gte("created_at", from).lte("created_at", to);

      const uniqueUsers = new Set(events?.map(e => e.triggered_by) || []);

      // Fulfillments with complete traceability
      const { data: allFul } = await supabase.from("fulfillment_orders").select("id, bims_transfer_number, bims_invoice_number, status, received_at_branch, dispatched_at");

      const total = allFul?.length || 1;
      const withDoc = allFul?.filter(f => f.bims_transfer_number || f.bims_invoice_number).length || 0;
      const withDelivery = allFul?.filter(f => ["delivered", "received", "completed"].includes(f.status)).length || 0;
      const withReception = allFul?.filter(f => f.received_at_branch).length || 0;

      // Active profiles
      const { data: profiles } = await supabase.from("profiles").select("id, is_active").eq("is_active", true);

      return {
        activeUsers: uniqueUsers.size,
        totalProfiles: profiles?.length || 0,
        docCompliance: Math.round((withDoc / total) * 100),
        deliveryConfirmed: Math.round((withDelivery / total) * 100),
        receptionConfirmed: Math.round((withReception / total) * 100),
        totalEvents: events?.length || 0,
      };
    },
    refetchInterval: 60000,
  });
}

export function useIncidentBreakdown(range: DateRange, branchId?: string) {
  const { from, to } = getDateRange(range);

  return useQuery({
    queryKey: ["exec-incidents", range, branchId],
    queryFn: async () => {
      let query = supabase.from("logistics_incidents").select("id, incident_type, status, branch_id, created_at").gte("created_at", from).lte("created_at", to);
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
