import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);
  const in15 = new Date(today); in15.setDate(in15.getDate() + 15);
  const in15ISO = in15.toISOString().slice(0, 10);

  const created: string[] = [];

  async function push(anomaly_type: string, title: string, description: string, severity: "warning" | "critical", entity: any) {
    // Avoid duplicates: don't insert if same anomaly_type + entity already exists open today
    const { data: existing } = await supabase
      .from("ai_anomalies")
      .select("id")
      .eq("anomaly_type", anomaly_type)
      .eq("is_acknowledged", false)
      .contains("affected_entities", [entity])
      .limit(1);
    if (existing && existing.length) return;
    const { error } = await supabase.from("ai_anomalies").insert({
      anomaly_type,
      area: "logistics",
      severity,
      alert_level: severity === "critical" ? "logistics_admin_decision" : "branch_operational",
      title,
      description,
      affected_entities: [entity],
    });
    if (!error) created.push(anomaly_type);
  }

  // Maintenances due / overdue
  const { data: maints } = await supabase
    .from("vehicle_maintenance")
    .select("id, scheduled_date, scheduled_km, alert_km_threshold, alert_days_threshold, maintenance_type, vehicle:vehicles(id, plate, current_mileage)")
    .in("status", ["scheduled", "in_progress"]);
  for (const m of maints ?? []) {
    const kmThr = m.alert_km_threshold ?? 500;
    const dayThr = m.alert_days_threshold ?? 7;
    let overdue = false, upcoming = false;
    if (m.scheduled_date) {
      const d = new Date(m.scheduled_date);
      const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
      if (diff < 0) overdue = true;
      else if (diff <= dayThr) upcoming = true;
    }
    if (m.scheduled_km && (m.vehicle as any)?.current_mileage) {
      const diff = m.scheduled_km - (m.vehicle as any).current_mileage;
      if (diff < 0) overdue = true;
      else if (diff <= kmThr) upcoming = true;
    }
    const plate = (m.vehicle as any)?.plate ?? "—";
    const entity = { type: "vehicle_maintenance", id: m.id };
    if (overdue) {
      await push("maintenance_overdue", `Mantenimiento vencido — ${plate}`, `${m.maintenance_type} vencido`, "critical", entity);
    } else if (upcoming) {
      await push("maintenance_upcoming", `Mantenimiento próximo — ${plate}`, `${m.maintenance_type} próximo a vencer`, "warning", entity);
    }
  }

  // Overdue pending fines
  const { data: fines } = await supabase
    .from("vehicle_fines")
    .select("id, due_date, amount, infraction_type, vehicle:vehicles(plate)")
    .eq("status", "pending")
    .lt("due_date", todayISO);
  for (const f of fines ?? []) {
    const plate = (f.vehicle as any)?.plate ?? "—";
    await push(
      "fine_overdue",
      `Multa vencida — ${plate}`,
      `${f.infraction_type} — ₲ ${Number(f.amount).toLocaleString("de-DE")}`,
      "critical",
      { type: "vehicle_fine", id: f.id }
    );
  }

  // VTV / insurance expiring in 15 days
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, plate, vtv_expiry, insurance_expiry")
    .eq("is_active", true);
  for (const v of vehicles ?? []) {
    if (v.vtv_expiry && v.vtv_expiry <= in15ISO) {
      const sev = v.vtv_expiry < todayISO ? "critical" : "warning";
      await push("vtv_expiring", `VTV ${sev === "critical" ? "vencida" : "próxima"} — ${v.plate}`, `Vence ${v.vtv_expiry}`, sev, { type: "vehicle", id: v.id, doc: "vtv" });
    }
    if (v.insurance_expiry && v.insurance_expiry <= in15ISO) {
      const sev = v.insurance_expiry < todayISO ? "critical" : "warning";
      await push("insurance_expiring", `Seguro ${sev === "critical" ? "vencido" : "próximo"} — ${v.plate}`, `Vence ${v.insurance_expiry}`, sev, { type: "vehicle", id: v.id, doc: "insurance" });
    }
  }

  // Open trips > 24h (viaje sin cerrar)
  const cutoff = new Date(today.getTime() - 24 * 3_600_000).toISOString();
  const { data: openTrips } = await supabase
    .from("vehicle_usages")
    .select("id, started_at, destination, vehicle:vehicles(plate)")
    .eq("status", "open")
    .lt("started_at", cutoff);
  for (const t of openTrips ?? []) {
    const plate = (t.vehicle as any)?.plate ?? "—";
    const hours = Math.floor((today.getTime() - new Date(t.started_at).getTime()) / 3_600_000);
    await push(
      "trip_open_overdue",
      `Viaje abierto +24h — ${plate}`,
      `Sin cerrar hace ${hours}h${t.destination ? ` · destino: ${t.destination}` : ""}`,
      "warning",
      { type: "vehicle_usage", id: t.id }
    );
  }


  return new Response(JSON.stringify({ ok: true, created: created.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
