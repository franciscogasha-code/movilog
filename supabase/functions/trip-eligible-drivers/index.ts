import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DriverOption = {
  driverId: string | null;
  userId: string;
  name: string;
  assignedVehicleId: string | null;
  hasDriverRecord: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (callerRolesError) throw callerRolesError;

    const canManageTrips = (callerRoles ?? []).some((row) =>
      ["admin", "supervisor", "jefe_logistica", "owner"].includes(row.role),
    );

    if (!canManageTrips) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRows, error: roleRowsError } = await adminClient
      .from("user_roles")
      .select("user_id")
      .eq("role", "warehouse_operator");

    if (roleRowsError) throw roleRowsError;

    const operatorIds = Array.from(new Set((roleRows ?? []).map((row) => row.user_id)));

    if (operatorIds.length === 0) {
      return new Response(JSON.stringify({ drivers: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: excludedRows, error: excludedRowsError } = await adminClient
      .from("user_roles")
      .select("user_id")
      .in("user_id", operatorIds)
      .in("role", ["owner", "admin"]);

    if (excludedRowsError) throw excludedRowsError;

    const excludedIds = new Set((excludedRows ?? []).map((row) => row.user_id));
    const filteredIds = operatorIds.filter((id) => !excludedIds.has(id));

    if (filteredIds.length === 0) {
      return new Response(JSON.stringify({ drivers: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: profiles, error: profilesError }, { data: drivers, error: driversError }] = await Promise.all([
      adminClient
        .from("profiles")
        .select("user_id, full_name, is_active")
        .in("user_id", filteredIds)
        .eq("is_active", true),
      adminClient
        .from("drivers")
        .select("id, user_id, assigned_vehicle_id, is_active")
        .in("user_id", filteredIds),
    ]);

    if (profilesError) throw profilesError;
    if (driversError) throw driversError;

    const driversByUserId = new Map(
      (drivers ?? []).map((driver) => [driver.user_id, driver]),
    );

    const payload: DriverOption[] = (profiles ?? [])
      .map((profile) => {
        const driver = driversByUserId.get(profile.user_id);
        return {
          driverId: driver?.id ?? null,
          userId: profile.user_id,
          name: profile.full_name || "Sin nombre",
          assignedVehicleId: driver?.assigned_vehicle_id ?? null,
          hasDriverRecord: !!driver,
        } satisfies DriverOption;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return new Response(JSON.stringify({ drivers: payload }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});