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

    const today = new Date();
    const dayOfMonth = today.getDate();

    // Only run on day 9 or 24
    if (dayOfMonth !== 9 && dayOfMonth !== 24) {
      return new Response(
        JSON.stringify({ message: "Not a reminder day", day: dayOfMonth }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reminderField = dayOfMonth === 9 ? "shipment_reminder_9th" : "shipment_reminder_24th";
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    // Find incidents with pending_shipment_to_admin = true that haven't been reminded this month
    const { data: incidents, error: fetchError } = await supabase
      .from("logistics_incidents")
      .select("id, title, branch_id, product_id, quantity_affected")
      .eq("pending_shipment_to_admin", true)
      .eq(reminderField, false)
      .in("status", ["open", "under_review"]);

    if (fetchError) throw fetchError;

    if (!incidents || incidents.length === 0) {
      return new Response(
        JSON.stringify({ message: "No incidents need reminders", day: dayOfMonth }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create alerts for each incident
    const alerts = incidents.map((inc) => ({
      anomaly_type: `shipment_reminder_day_${dayOfMonth}`,
      area: "supply" as const,
      severity: dayOfMonth === 24 ? "critical" as const : "warning" as const,
      alert_level: dayOfMonth === 24 ? "logistics_admin_decision" as const : "branch_operational" as const,
      title: `Recordatorio envío averiados — Día ${dayOfMonth}`,
      description: `Incidencia "${inc.title}" pendiente de envío a administración. ${dayOfMonth === 24 ? "URGENTE: próximo corte." : "Verificar antes del cierre."}`,
      branch_id: inc.branch_id,
      affected_entities: [{ type: "logistics_incident", id: inc.id }],
    }));

    const { error: insertError } = await supabase
      .from("ai_anomalies")
      .insert(alerts);

    if (insertError) throw insertError;

    // Mark incidents as reminded
    const incidentIds = incidents.map((i) => i.id);
    const { error: updateError } = await supabase
      .from("logistics_incidents")
      .update({ [reminderField]: true })
      .in("id", incidentIds);

    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        message: `Reminders sent for day ${dayOfMonth}`,
        count: incidents.length,
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
