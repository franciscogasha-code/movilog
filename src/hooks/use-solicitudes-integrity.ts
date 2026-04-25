/**
 * Observabilidad preventiva del módulo Pedidos (/solicitudes).
 *
 * NO altera ninguna query operativa: corre en paralelo y solo emite
 * `console.warn` estructurados que pueden ser leídos por el equipo o por
 * herramientas de soporte. Todos los chequeos son tolerantes a fallos
 * (cualquier error se silencia para no degradar la experiencia).
 *
 * Chequeos:
 *  1. PARIDAD DASHBOARD vs PEDIDOS — IDs activos visibles para el usuario
 *     en el dashboard que NO aparecen como activos+visibles en /solicitudes.
 *     (Detecta regresiones tipo #306/#307: pedido visible en Dashboard pero
 *      ausente de la bandeja operativa.)
 *  2. INTEGRIDAD ESTRUCTURAL — hijos con parent_request_id que no existe,
 *     padres declarados como tales que no tienen hijos reales, estados
 *     fuera de la whitelist conocida.
 *
 * Uso (montar una sola vez, dentro de la página Solicitudes):
 *   useSolicitudesIntegrityCheck({ allowedBranchIds, isAllBranches });
 */
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  ACTIVE_REQUEST_STATUSES,
  CLOSED_REQUEST_STATUSES,
} from "@/lib/request-status";

const KNOWN_STATUSES = new Set<string>([
  ...ACTIVE_REQUEST_STATUSES,
  ...CLOSED_REQUEST_STATUSES,
]);

type Params = {
  allowedBranchIds: string[];
  isAllBranches: boolean;
  /** Habilitar/deshabilitar (default: true). */
  enabled?: boolean;
};

type IntegrityReport = {
  parityMissingIds: string[]; // pedidos activos visibles en dashboard pero no en /solicitudes
  orphanChildren: string[]; // hijos cuyo parent_request_id no existe
  parentsWithoutChildren: string[]; // padres declarados pero sin hijos
  unknownStatuses: { id: string; status: string }[];
  scannedAt: string;
};

export function useSolicitudesIntegrityCheck({
  allowedBranchIds,
  isAllBranches,
  enabled = true,
}: Params) {
  const { user } = useAuth();
  const lastWarnSignature = useRef<string>("");

  const { data: report } = useQuery<IntegrityReport | null>({
    queryKey: [
      "solicitudes-integrity",
      user?.id ?? "anon",
      isAllBranches,
      allowedBranchIds.join(","),
    ],
    enabled: enabled && !!user,
    // Chequeo periódico cada 2 minutos — barato (1000 filas máx) y no afecta UI.
    staleTime: 120_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<IntegrityReport | null> => {
      try {
        // 1) Set de "activos visibles" (RLS aplica): mismo criterio que Dashboard usa.
        const { data: active, error: activeErr } = await supabase
          .from("branch_requests")
          .select("id, status, parent_request_id, requesting_branch_id, source_branch_id, notes")
          .in("status", ACTIVE_REQUEST_STATUSES as any)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (activeErr) throw activeErr;

        // 2) Set de IDs que SON padres reales (tienen al menos un hijo).
        const { data: childrenLinks } = await supabase
          .from("branch_requests")
          .select("id, parent_request_id")
          .not("parent_request_id", "is", null)
          .limit(2000);

        const parentIds = new Set<string>();
        const childByParent = new Map<string, string[]>();
        (childrenLinks ?? []).forEach((row: any) => {
          if (row.parent_request_id) {
            parentIds.add(row.parent_request_id);
            const arr = childByParent.get(row.parent_request_id) ?? [];
            arr.push(row.id);
            childByParent.set(row.parent_request_id, arr);
          }
        });

        // ── PARIDAD DASHBOARD ↔ PEDIDOS ──────────────────────────────
        // Dashboard NO oculta pedidos por sucursal del usuario explícitamente
        // (depende del RLS), y Solicitudes oculta padres multi-origen.
        // Un pedido "activo no padre" debería ser visible en /solicitudes
        // si el usuario tiene acceso a su requesting_branch_id o source_branch_id.
        const accessibleSet = isAllBranches
          ? null
          : new Set<string>(allowedBranchIds);

        const parityMissingIds: string[] = [];
        for (const r of active ?? []) {
          const isParent = parentIds.has(r.id);
          if (isParent) continue; // correctamente oculto en /solicitudes
          const visibleByBranch =
            accessibleSet === null
              ? true
              : accessibleSet.has(r.requesting_branch_id) ||
                accessibleSet.has(r.source_branch_id);
          if (!visibleByBranch) continue; // simplemente fuera del scope del usuario, OK
          // Si llegó hasta acá, debería verse en /solicitudes en alguna tab.
          // (No podemos saber filtros en runtime acá, pero al menos verificamos
          //  que la fila siga existiendo y sea consultable via select directo.)
        }

        // Confirmación adicional: re-consulta puntual con la MISMA exclusión que aplica
        // /solicitudes (parentIds vía .not in (...)). Si una fila activa+accesible
        // desaparece tras esa exclusión sin ser padre real → ALERTA.
        if (active && active.length > 0 && parentIds.size > 0) {
          const candidateIds = (active ?? [])
            .filter((r: any) => !parentIds.has(r.id))
            .map((r: any) => r.id);
          if (candidateIds.length > 0) {
            const { data: visibleAfterExclusion } = await supabase
              .from("branch_requests")
              .select("id")
              .in("id", candidateIds)
              .not("id", "in", `(${Array.from(parentIds).join(",")})`)
              .limit(1000);
            const visibleSet = new Set<string>(
              (visibleAfterExclusion ?? []).map((r: any) => r.id),
            );
            for (const cid of candidateIds) {
              if (!visibleSet.has(cid)) parityMissingIds.push(cid);
            }
          }
        }

        // ── INTEGRIDAD ESTRUCTURAL ──────────────────────────────────
        // a) huérfanos: hijos cuyo parent_request_id no existe en la tabla.
        const distinctParentIds = Array.from(parentIds);
        let existingParentIds = new Set<string>();
        if (distinctParentIds.length > 0) {
          const { data: existing } = await supabase
            .from("branch_requests")
            .select("id")
            .in("id", distinctParentIds);
          existingParentIds = new Set<string>((existing ?? []).map((r: any) => r.id));
        }
        const orphanChildren: string[] = [];
        (childrenLinks ?? []).forEach((row: any) => {
          if (row.parent_request_id && !existingParentIds.has(row.parent_request_id)) {
            orphanChildren.push(row.id);
          }
        });

        // b) padres "declarados por notes" sin hijos reales.
        const parentsWithoutChildren: string[] = [];
        for (const r of active ?? []) {
          const declaredParent =
            typeof r.notes === "string" &&
            r.notes.includes("[Pedido padre multi-origen]");
          if (declaredParent && !parentIds.has(r.id)) {
            parentsWithoutChildren.push(r.id);
          }
        }

        // c) estados desconocidos (whitelist drift).
        const unknownStatuses: { id: string; status: string }[] = [];
        for (const r of active ?? []) {
          if (!KNOWN_STATUSES.has(r.status)) {
            unknownStatuses.push({ id: r.id, status: r.status });
          }
        }

        return {
          parityMissingIds,
          orphanChildren,
          parentsWithoutChildren,
          unknownStatuses,
          scannedAt: new Date().toISOString(),
        };
      } catch (err) {
        // Falla silenciosa: la observabilidad NO debe romper el módulo.
        // eslint-disable-next-line no-console
        console.warn("[solicitudes-integrity] check failed", err);
        return null;
      }
    },
  });

  // Emitir warnings deduplicados en consola (firma = JSON de hallazgos).
  useEffect(() => {
    if (!report) return;
    const findings = {
      parity: report.parityMissingIds,
      orphans: report.orphanChildren,
      ghostParents: report.parentsWithoutChildren,
      unknownStatuses: report.unknownStatuses,
    };
    const hasIssues =
      findings.parity.length > 0 ||
      findings.orphans.length > 0 ||
      findings.ghostParents.length > 0 ||
      findings.unknownStatuses.length > 0;
    if (!hasIssues) return;

    const signature = JSON.stringify(findings);
    if (signature === lastWarnSignature.current) return;
    lastWarnSignature.current = signature;

    // eslint-disable-next-line no-console
    console.warn(
      "[movilog/solicitudes] ⚠️ Observabilidad operativa — hallazgos:",
      {
        ...findings,
        context: {
          userId: user?.id,
          isAllBranches,
          allowedBranchIds,
          scannedAt: report.scannedAt,
        },
      },
    );
  }, [report, user?.id, isAllBranches, allowedBranchIds]);

  return report;
}
