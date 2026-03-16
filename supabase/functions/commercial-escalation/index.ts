import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find fulfillment orders with unresolved commercial exceptions older than 24h
    const { data: overdue, error: fetchError } = await supabase
      .from("fulfillment_orders")
      .select("id, source_branch_id, destination_branch_id, destination_client_name, commercial_exception_at, branch_request:branch_requests(request_number, client_name)")
      .eq("commercial_exception_status", "pending_commercial")
      .lt("commercial_exception_at", twentyFourHoursAgo);

    if (fetchError) throw fetchError;

    if (!overdue || overdue.length === 0) {
      return new Response(
        JSON.stringify({ message: "No overdue commercial exceptions", escalated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For each overdue case, check if an escalation alert already exists
    let escalatedCount = 0;

    for (const fo of overdue) {
      const entityFilter = JSON.stringify([{ type: "fulfillment_order", id: fo.id }]);

      // Check if escalation alert already exists for this fulfillment
      const { data: existing } = await supabase
        .from("ai_anomalies")
        .select("id")
        .eq("anomaly_type", "commercial_exception_escalated")
        .contains("affected_entities", [{ type: "fulfillment_order", id: fo.id }])
        .limit(1);

      if (existing && existing.length > 0) {
        // Already escalated, skip
        continue;
      }

      const hoursElapsed = Math.floor(
        (Date.now() - new Date(fo.commercial_exception_at!).getTime()) / (1000 * 60 * 60)
      );

      const clientName = fo.destination_client_name || (fo.branch_request as any)?.client_name || "Cliente";
      const reqNum = (fo.branch_request as any)?.request_number;

      // Create visibility escalation alert — does NOT change fulfillment status or custody
      const { error: insertError } = await supabase
        .from("ai_anomalies")
        .insert({
          anomaly_type: "commercial_exception_escalated",
          area: "logistics" as const,
          severity: "critical" as const,
          alert_level: "logistics_admin_decision" as const,
          title: `Excepción comercial +${hoursElapsed}h sin resolver`,
          description: `Cliente "${clientName}"${reqNum ? ` (Ped. #${reqNum})` : ""} — excepción comercial pendiente hace ${hoursElapsed} horas. Requiere visibilidad de logística/admin.`,
          branch_id: fo.destination_branch_id || fo.source_branch_id,
          affected_entities: [{ type: "fulfillment_order", id: fo.id }],
          supporting_data: {
            escalation_type: "visibility_only",
            commercial_exception_at: fo.commercial_exception_at,
            hours_elapsed: hoursElapsed,
          },
        });

      if (insertError) throw insertError;

      // Status remains pending_commercial — escalation is visibility only
      // Tracked via the ai_anomalies alert record, not via fulfillment status

      escalatedCount++;
    }

    return new Response(
      JSON.stringify({
        message: `Commercial escalation complete`,
        checked: overdue.length,
        escalated: escalatedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
