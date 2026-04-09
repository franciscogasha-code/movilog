import { corsHeaders } from "@supabase/supabase-js/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const imageUrl = url.searchParams.get("url");

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only allow proxying from the known BIMS image server
  const ALLOWED_HOST = "190.128.128.182";
  try {
    const parsed = new URL(imageUrl);
    if (parsed.hostname !== ALLOWED_HOST) {
      return new Response(JSON.stringify({ error: "Host not allowed" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: { "Accept": "image/*" },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Upstream error", status: response.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const body = await response.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch image", details: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
