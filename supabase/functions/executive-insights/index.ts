import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { kpis, alerts, adoption, branchPerformance } = await req.json();

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Eres un analista de operaciones logísticas senior. Analiza los siguientes datos operativos de MoviLog y genera un diagnóstico ejecutivo breve y accionable.

DATOS ACTUALES:
- Solicitudes en período: ${kpis?.reqCreated || 0}
- Cargas en preparación: ${kpis?.inPrep || 0}
- Cargas en tránsito: ${kpis?.inTransit || 0}
- Entregas completadas: ${kpis?.deliveredToday || 0}
- Incidencias abiertas: ${kpis?.openIncidents || 0}
- Cumplimiento operativo: ${kpis?.compliance || 0}%
- Trazabilidad completa: ${kpis?.fullTraceability || 0}%
- Operaciones con alerta: ${kpis?.opsWithAlerts || 0}

ALERTAS CRÍTICAS:
- Pedidos demorados (>24h): ${alerts?.staleRequests || 0}
- Sin documento BIMS: ${alerts?.noBims || 0}
- Incidencias sin resolver: ${alerts?.openIncidents || 0}
- Entregas fallidas: ${alerts?.failedDeliveries || 0}

ADOPCIÓN:
- Usuarios activos: ${adoption?.activeUsers || 0} de ${adoption?.totalProfiles || 0}
- Documentación correcta: ${adoption?.docCompliance || 0}%
- Operaciones con flujo completo: ${adoption?.fullFlowOps || 0}%
- Operaciones con pasos omitidos: ${adoption?.skippedSteps || 0}

SUCURSALES (top 5 por volumen):
${(branchPerformance || []).slice(0, 5).map((b: any) => `- ${b.name}: ${b.fulfillments} ops, ${b.incidents} incidencias, ${b.compliance}% cumplimiento`).join("\n")}

Responde en español con exactamente este formato JSON:
{
  "healthScore": <número 0-100>,
  "healthLabel": "<Crítico|Requiere atención|Aceptable|Bueno|Excelente>",
  "summary": "<1 oración sobre el estado general>",
  "findings": ["<hallazgo 1>", "<hallazgo 2>", "<hallazgo 3>"],
  "risks": ["<riesgo 1>", "<riesgo 2>"],
  "recommendations": ["<recomendación accionable 1>", "<recomendación accionable 2>", "<recomendación accionable 3>"]
}

Solo devuelve el JSON, sin markdown ni texto adicional.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`AI Gateway error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (strip potential markdown fences)
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const insights = JSON.parse(jsonStr);

    return new Response(JSON.stringify(insights), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Executive insights error:", error);
    return new Response(
      JSON.stringify({ error: error.message, healthScore: null }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
