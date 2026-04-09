import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Authenticate caller
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

    // Verify caller is admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub;

    // Check admin role using service role client
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Solo administradores pueden crear usuarios" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse and validate body
    const body = await req.json();
    const { email, password, full_name, role, default_branch_id, all_branches_access, additional_branch_ids, modules } = body;

    if (!email || !password || !full_name || !role) {
      return new Response(
        JSON.stringify({ error: "email, password, full_name y role son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Create auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // 4. Wait for trigger to create profile (fn_handle_new_user)
    let profileId: string | null = null;
    for (let i = 0; i < 10; i++) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (profile) {
        profileId = profile.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (!profileId) {
      return new Response(
        JSON.stringify({ error: "Profile not created by trigger in time" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Update profile with operational data
    await adminClient
      .from("profiles")
      .update({
        full_name,
        default_branch_id: all_branches_access ? null : (default_branch_id || null),
        all_branches_access: !!all_branches_access,
      })
      .eq("id", profileId);

    // 6. Assign role
    await adminClient.from("user_roles").insert({ user_id: userId, role });

    // 7. Module access
    if (modules && Array.isArray(modules) && modules.length > 0) {
      const accessRows = modules.map((key: string) => ({
        profile_id: profileId,
        module_key: key,
        is_enabled: true,
      }));
      await adminClient.from("user_module_access").insert(accessRows);
    }

    // 8. Branch access
    if (!all_branches_access) {
      const branchIds = Array.from(
        new Set([default_branch_id, ...(additional_branch_ids || [])].filter(Boolean))
      );
      if (branchIds.length > 0) {
        await adminClient
          .from("profile_branch_access")
          .insert(branchIds.map((bid: string) => ({ profile_id: profileId, branch_id: bid })));
      }
    }

    return new Response(
      JSON.stringify({ success: true, profile_id: profileId, user_id: userId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
