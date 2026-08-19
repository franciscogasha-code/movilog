const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const imageUrl = url.searchParams.get("url");
  const pdfMode = url.searchParams.get("mode") === "pdf";

  if (!imageUrl) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only allow proxying from the known BIMS image server
  const ALLOWED_HOST = "190.128.128.182";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
    if (parsedUrl.hostname !== ALLOWED_HOST) {
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

  // Nombre de archivo vacío (ej. ".../tims2_"): la ficha BIMS no tiene foto.
  const fileName = parsedUrl.pathname.split("/").pop() ?? "";
  if (!fileName || !/\.[a-z0-9]+$/i.test(fileName)) {
    return new Response(JSON.stringify({ error: "No image on file" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // El servidor BIMS corta conexiones bajo carga: reintentamos una vez.
  let lastError = "unknown";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(imageUrl, { headers: { "Accept": "image/*" } });

      if (!response.ok) {
        // 404/410 = no hay foto en BIMS; no es un fallo del proxy.
        return new Response(
          JSON.stringify({ error: "Upstream error", status: response.status }),
          {
            status: response.status === 404 || response.status === 410 ? 404 : 503,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (!contentType.toLowerCase().startsWith("image/")) {
        return new Response(JSON.stringify({ error: "Upstream did not return an image" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      const body = await response.arrayBuffer();

      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": pdfMode
            ? "no-store, no-cache, must-revalidate"
            : "public, max-age=86400, s-maxage=86400",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (err) {
      lastError = String(err);
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return new Response(JSON.stringify({ error: "Failed to fetch image", details: lastError }), {
    status: 503,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});

