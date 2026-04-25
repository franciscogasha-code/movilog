import { useState, useEffect, useMemo, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Search, Building2, ArrowRightLeft, FileSpreadsheet, Layers, ArrowDownLeft, ArrowUpRight, Repeat } from "lucide-react";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import {
  ACTIVE_REQUEST_STATUSES as ACTIVE_STATUSES,
  CLOSED_REQUEST_STATUSES as CLOSED_STATUSES,
} from "@/lib/request-status";
import { useParentRequestIds } from "@/hooks/use-parent-request-ids";
import { StatusBadge } from "@/components/StatusBadge";
import { SolicitudCreateForm } from "@/components/solicitudes/SolicitudCreateForm";
import { SolicitudDetail } from "@/components/solicitudes/SolicitudDetail";
import { AdminReposicionForm } from "@/components/solicitudes/AdminReposicionForm";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { useBranches } from "@/hooks/use-branches";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationBar } from "@/components/shared/PaginationBar";
import { cn } from "@/lib/utils";

/**
 * MÓDULO PEDIDOS — Bandeja operativa
 *
 * Tabs:
 *  - "activos":      pedidos abiertos que requieren acción/seguimiento.
 *  - "mios":         "Mis pedidos" — solicitados POR mi sucursal (yo pedí).
 *  - "otros":        "Otros pedidos" — impactan mi sucursal pero no los pedí yo:
 *                    soy origen (otros me piden) O cualquier participación
 *                    de mi sucursal sin haber sido el solicitante.
 *  - "cerrados":     histórico finalizado.
 *
 * Notas:
 *  - "activos" e "mios" pueden solaparse (un pedido mío activo aparece en ambos).
 *  - Para usuarios con `isAllBranches`, se ocultan tabs "mios"/"otros" (no aplican).
 *  - Persistencia de filtros por usuario en localStorage.
 *  - No tocamos: RPC, RLS, RequestProgressBar, SolicitudDetail, SolicitudCreateForm,
 *    AdminReposicionForm, lógica flow_type, integración choferes, deep-links.
 */

// Estados activos / cerrados: importados desde @/lib/request-status (single source of truth).
// NO redefinir localmente — la divergencia entre módulos causó la regresión #306/#307.

type TabKey = "activos" | "mios" | "otros" | "cerrados";

const TAB_LABELS: Record<TabKey, string> = {
  activos: "Activos",
  mios: "Mis pedidos",
  otros: "Otros pedidos",
  cerrados: "Cerrados",
};

const FILTERS_STORAGE_PREFIX = "movilog:pedidos:filters:";

type PersistedFilters = {
  tab: TabKey;
  branch: string; // "all" | branch_id
  status: string; // "all" | status_key
};

function loadFilters(userId: string | null): Partial<PersistedFilters> {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_PREFIX + userId);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveFilters(userId: string | null, filters: PersistedFilters) {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_PREFIX + userId, JSON.stringify(filters));
  } catch {
    /* noop */
  }
}

/** Antigüedad operativa corta (Hoy / Ayer / Nd). */
function formatAge(dateStr: string): string {
  const created = new Date(dateStr);
  const now = new Date();
  const startCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((startNow.getTime() - startCreated.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}m`;
  return `${Math.floor(diffDays / 365)}a`;
}

/** Fecha completa para tooltip / auditoría. */
function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
/**
 * Detecta pedido padre multi-origen.
 * Detección estructural: el pedido es padre si su id aparece en el set
 * de `parent_request_id` (existe al menos un hijo apuntándolo).
 *
 * Se conserva la detección por substring únicamente como fallback defensivo
 * para datos en tránsito de migración. La fuente de verdad es la FK.
 */
function isParentMultiOrigin(r: any, parentIds?: Set<string>): boolean {
  if (parentIds && r?.id && parentIds.has(r.id)) return true;
  return typeof r?.notes === "string" && r.notes.includes("[Pedido padre multi-origen]");
}

/** Detecta padres legacy de un solo hijo (saneamiento marca con esta tag). */
function isLegacySingleChildParent(r: any): boolean {
  return typeof r?.notes === "string" && r.notes.includes("[LEGACY 1-hijo]");
}

export default function Solicitudes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasRole, isOwner, user, profile } = useAuth();
  const isViewer = hasRole("viewer") || hasRole("auditor");
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();
  const { data: branches = [] } = useBranches();
  const { data: parentIdsList = [] } = useParentRequestIds();
  const parentIdsSet = useMemo(() => new Set(parentIdsList), [parentIdsList]);

  // Default tab por rol
  const defaultTab: TabKey = "activos";
  const defaultBranch: string = useMemo(() => {
    if (isAllBranches) return "all";
    if (profile?.default_branch_id && allowedBranchIds.includes(profile.default_branch_id)) {
      return profile.default_branch_id;
    }
    return allowedBranchIds.length === 1 ? allowedBranchIds[0] : "all";
  }, [isAllBranches, profile?.default_branch_id, allowedBranchIds]);

  // Carga inicial desde localStorage (una sola vez por user)
  const initial = useMemo(() => loadFilters(user?.id ?? null), [user?.id]);
  const [tab, setTab] = useState<TabKey>((initial.tab as TabKey) ?? defaultTab);
  const [branchFilter, setBranchFilter] = useState<string>(initial.branch ?? defaultBranch);
  const [statusFilter, setStatusFilter] = useState<string>(initial.status ?? "all");
  const [search, setSearch] = useState("");

  // Si el filtro persistido apunta a una sucursal que ya no existe/está inactiva → reset.
  // Importante: NO se debe resetear por permisos del usuario, porque el selector es
  // una herramienta operativa independiente sobre la sucursal solicitante del pedido.
  useEffect(() => {
    if (branchFilter === "all" || branches.length === 0) return;

    const branchStillExists = branches.some((branch: any) => branch.id === branchFilter);
    if (!branchStillExists) {
      setBranchFilter(defaultBranch);
    }
  }, [branchFilter, branches, defaultBranch]);

  // Persistencia
  useEffect(() => {
    saveFilters(user?.id ?? null, { tab, branch: branchFilter, status: statusFilter });
  }, [user?.id, tab, branchFilter, statusFilter]);

  // (Las 4 tabs se muestran siempre; mios/otros funcionan también con isAllBranches
  //  usando el branchFilter explícito como contexto de "mi sucursal".)

  const [createOpen, setCreateOpen] = useState(false);
  const [adminRepoOpen, setAdminRepoOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fromConsultation = searchParams.get("from_consultation");
  const detailParam = searchParams.get("detail");
  const actionParam = searchParams.get("action");
  const [activeConsultationId, setActiveConsultationId] = useState<string | null>(null);

  useEffect(() => {
    if (detailParam) {
      setSelectedId(detailParam);
      setSearchParams({}, { replace: true });
    } else if (actionParam === "new") {
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    } else if (fromConsultation) {
      setActiveConsultationId(fromConsultation);
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [detailParam, actionParam, fromConsultation]);

  const queryClient = useQueryClient();

  // Debounce búsqueda
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Búsqueda inteligente padre↔hijo:
   * Cuando el término es numérico (#N), pre-resolvemos el conjunto de IDs
   * relacionados (el propio + padre + hermanos + hijos). Esto permite que
   * buscar un padre traiga sus hijos, y buscar un hijo traiga al padre,
   * incluso si el padre normalmente está oculto en la bandeja operativa.
   * RLS sigue aplicando en la query principal.
   */
  const numericSearchTerm = useMemo(() => {
    if (!debouncedSearch) return null;
    const t = debouncedSearch.replace(/^#/, "");
    return /^\d+$/.test(t) ? t : null;
  }, [debouncedSearch]);

  const { data: relatedSearchIds } = useQuery<string[] | null>({
    queryKey: ["request-related-ids", numericSearchTerm],
    enabled: !!numericSearchTerm,
    staleTime: 30_000,
    queryFn: async () => {
      if (!numericSearchTerm) return null;
      // 1) Match exacto por número
      const { data: match } = await supabase
        .from("branch_requests")
        .select("id, parent_request_id")
        .eq("request_number", Number(numericSearchTerm))
        .maybeSingle();
      if (!match) return [];
      const ids = new Set<string>([match.id]);
      // 2) Si tiene padre, traerlo + hermanos
      if (match.parent_request_id) {
        ids.add(match.parent_request_id);
        const { data: siblings } = await supabase
          .from("branch_requests")
          .select("id")
          .eq("parent_request_id", match.parent_request_id);
        (siblings ?? []).forEach((s: any) => ids.add(s.id));
      }
      // 3) Si es padre, traer hijos
      const { data: children } = await supabase
        .from("branch_requests")
        .select("id")
        .eq("parent_request_id", match.id);
      (children ?? []).forEach((c: any) => ids.add(c.id));
      return Array.from(ids);
    },
  });

  // Branch IDs efectivos para filtrado server-side
  const effectiveBranchIds: string[] | null = useMemo(() => {
    if (isAllBranches && branchFilter === "all") return null; // sin filtro
    if (branchFilter !== "all") return [branchFilter];
    return allowedBranchIds.length > 0 ? allowedBranchIds : null;
  }, [isAllBranches, branchFilter, allowedBranchIds]);

  /**
   * Construye condición OR de pertenencia según la tab.
   * - mios:   requesting_branch_id ∈ effectiveBranchIds
   * - otros:  source_branch_id ∈ effectiveBranchIds AND requesting_branch_id NOT IN effectiveBranchIds
   *           (otros me piden / impactan mi sucursal sin haberlo pedido yo)
   * - activos/cerrados: requesting OR source ∈ effectiveBranchIds
   */
  const {
    rows: requests,
    total,
    page,
    pageSize,
    totalPages,
    from,
    to,
    isLoading,
    isFetching,
    setPage,
    refetch,
  } = usePaginatedQuery<any>({
    queryKey: [
      "branch-requests",
      tab,
      statusFilter,
      debouncedSearch,
      isAllBranches,
      branchFilter,
      allowedBranchIds.join(","),
      // Incluimos los ids relacionados para refrescar correctamente cuando
      // se completa el pre-fetch de búsqueda numérica.
      numericSearchTerm ? (relatedSearchIds?.join(",") ?? "pending") : "",
      // Refrescar cuando cambia el set de padres (nuevo pedido multi-origen creado).
      parentIdsList.length,
    ],
    initialPageSize: 25,
    buildQuery: () => {
      let query: any = supabase
        .from("branch_requests")
        .select(
          `*,
           requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
           source_branch:branches!branch_requests_source_branch_id_fkey(name, code),
           parent:parent_request_id(id, request_number)`,
          { count: "exact" },
        )
        .order("created_at", { ascending: false });

      // ─── MODO BÚSQUEDA NUMÉRICA INTELIGENTE ──────────────────────
      // Si el usuario tipea #N, devolvemos el set padre↔hijos relacionados
      // ignorando filtros de tab/estado/sucursal y bypass del filtro de
      // padres ocultos. RLS sigue aplicando.
      if (numericSearchTerm) {
        if (relatedSearchIds === undefined) {
          // Aún cargando: forzamos resultado vacío seguro
          query = query.eq("id", "00000000-0000-0000-0000-000000000000");
          return query;
        }
        if (relatedSearchIds && relatedSearchIds.length > 0) {
          query = query.in("id", relatedSearchIds);
        } else {
          // Sin match: fallback al comportamiento estricto por número
          query = query.eq("request_number", Number(numericSearchTerm));
        }
        return query;
      }

      // ─── MODO NORMAL (sin búsqueda numérica) ─────────────────────
      // Ocultar padres multi-origen (contenedores de trazabilidad) de las bandejas operativas.
      // FIX ESTRUCTURAL: detección por FK (parent_request_id de los hijos) en lugar de
      // substring en `notes`. La regla anterior `NOT ILIKE` evaluaba NULL → NULL y
      // excluía pedidos sin notas (regresión #306/#307).
      if (parentIdsList.length > 0) {
        query = query.not("id", "in", `(${parentIdsList.join(",")})`);
      }

      // Tab: estados
      if (tab === "activos" || tab === "mios" || tab === "otros") {
        query = query.in("status", ACTIVE_STATUSES as any);
      } else if (tab === "cerrados") {
        query = query.in("status", CLOSED_STATUSES as any);
      }

      // Tab: pertenencia de sucursal
      const myIds = allowedBranchIds && allowedBranchIds.length > 0 ? allowedBranchIds : null;
      const specificBranch = branchFilter !== "all" ? branchFilter : null;
      const counterpartyId =
        specificBranch && (!myIds || !myIds.includes(specificBranch)) ? specificBranch : null;

      if (tab === "mios") {
        const anchor = isAllBranches && specificBranch ? [specificBranch] : myIds;
        if (anchor && anchor.length > 0) {
          query = query.in("requesting_branch_id", anchor);
          if (counterpartyId) query = query.eq("source_branch_id", counterpartyId);
        }
      } else if (tab === "otros") {
        const anchor = isAllBranches && specificBranch ? [specificBranch] : myIds;
        if (anchor && anchor.length > 0) {
          query = query
            .in("source_branch_id", anchor)
            .not("requesting_branch_id", "in", `(${anchor.join(",")})`);
          if (counterpartyId) query = query.eq("requesting_branch_id", counterpartyId);
        }
      } else if (effectiveBranchIds && effectiveBranchIds.length > 0) {
        query = query.or(
          `requesting_branch_id.in.(${effectiveBranchIds.join(",")}),source_branch_id.in.(${effectiveBranchIds.join(",")})`,
        );
      }

      // Estado refinado (dentro de la tab)
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as any);
      }

      // Búsqueda de texto libre (no numérica)
      if (debouncedSearch) {
        const term = debouncedSearch.replace(/^#/, "");
        query = query.or(
          `client_name.ilike.%${term}%,bims_invoice_number.ilike.%${term}%`,
        );
      }

      return query;
    },
  });

  // Conteos de tabs (queries livianas paralelas, head:true)
  const countsKey = ["branch-requests-counts", isAllBranches, branchFilter, allowedBranchIds.join(",")];
  const { data: tabCounts } = useQuery({
    queryKey: countsKey,
    staleTime: 30_000,
    queryFn: async () => {
      const ids = effectiveBranchIds;
      const myIds = allowedBranchIds && allowedBranchIds.length > 0 ? allowedBranchIds : null;
      const specificBranch = branchFilter !== "all" ? branchFilter : null;
      const counterpartyId =
        specificBranch && (!myIds || !myIds.includes(specificBranch)) ? specificBranch : null;
      // Anclaje para mios/otros: mis sucursales; si soy isAllBranches y elegí una, esa.
      const anchor: string[] | null =
        isAllBranches && specificBranch ? [specificBranch] : myIds;

      const buildBase = () =>
        supabase
          .from("branch_requests")
          .select("id", { count: "exact", head: true })
          .or("notes.is.null,notes.not.ilike.%[Pedido padre multi-origen]%");

      const applyAny = (q: any) => {
        if (!ids || ids.length === 0) return q;
        return q.or(
          `requesting_branch_id.in.(${ids.join(",")}),source_branch_id.in.(${ids.join(",")})`,
        );
      };

      const applyMios = (q: any) => {
        if (!anchor || anchor.length === 0) return null;
        let r = q.in("requesting_branch_id", anchor);
        if (counterpartyId) r = r.eq("source_branch_id", counterpartyId);
        return r;
      };

      const applyOtros = (q: any) => {
        if (!anchor || anchor.length === 0) return null;
        let r = q
          .in("source_branch_id", anchor)
          .not("requesting_branch_id", "in", `(${anchor.join(",")})`);
        if (counterpartyId) r = r.eq("requesting_branch_id", counterpartyId);
        return r;
      };

      const miosQ = applyMios(buildBase().in("status", ACTIVE_STATUSES as any));
      const otrosQ = applyOtros(buildBase().in("status", ACTIVE_STATUSES as any));

      const [activos, cerrados, mios, otros] = await Promise.all([
        applyAny(buildBase().in("status", ACTIVE_STATUSES as any)),
        applyAny(buildBase().in("status", CLOSED_STATUSES as any)),
        miosQ ?? Promise.resolve({ count: 0 }),
        otrosQ ?? Promise.resolve({ count: 0 }),
      ]);

      return {
        activos: (activos as any).count ?? 0,
        cerrados: (cerrados as any).count ?? 0,
        mios: (mios as any).count ?? 0,
        otros: (otros as any).count ?? 0,
      };
    },
  });

  /**
   * Etiqueta De/Para contextual según pestaña activa.
   * - mios   → solo "De: <origen>" (el destino es mi sucursal, sobreentendido).
   * - otros  → solo "Para: <destino>" (el origen es mi sucursal, sobreentendido).
   * - activos/cerrados → formato completo "De: X → Para: Y".
   * Caso especial: pedido interno (origen = destino) siempre muestra formato completo
   * para no perder contexto visual.
   */
  const buildRouteCell = (r: any) => {
    const srcName = r.source_branch?.name ?? "?";
    const reqName = r.requesting_branch?.name ?? "?";
    const isInternal = r.source_branch_id === r.requesting_branch_id;

    const full = (
      <>
        <span className="text-muted-foreground text-xs">De:</span>{" "}
        <span className="font-medium">{srcName}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className="text-muted-foreground text-xs">Para:</span>{" "}
        <span className="font-medium">{reqName}</span>
      </>
    );

    if (isInternal) return full;

    if (tab === "mios") {
      return (
        <>
          <span className="text-muted-foreground text-xs">De:</span>{" "}
          <span className="font-medium">{srcName}</span>
        </>
      );
    }
    if (tab === "otros") {
      return (
        <>
          <span className="text-muted-foreground text-xs">Para:</span>{" "}
          <span className="font-medium">{reqName}</span>
        </>
      );
    }
    return full;
  };

  /**
   * Indicador de dirección operativa como ÍCONO compacto + tooltip.
   *  - Interno: origen = destino (gris neutro).
   *  - Entrada: el destino es mi sucursal — entra mercadería (azul).
   *  - Salida:  el origen es mi sucursal — sale mercadería (ámbar).
   * Colores neutros respecto a estados (no rojo, no verde fuerte).
   */
  const getDirectionChip = (
    r: any,
  ): { kind: "entrada" | "salida" | "interno"; label: string; cls: string } | null => {
    // Contexto: si hay sucursal específica seleccionada, esa es "mi sucursal".
    // Si no, usamos las allowedBranchIds del usuario.
    const contextIds: string[] =
      branchFilter !== "all"
        ? [branchFilter]
        : isAllBranches
        ? []
        : allowedBranchIds;

    const isInternal = r.source_branch_id === r.requesting_branch_id;
    if (isInternal) {
      // Interno solo si pertenece al contexto (o no hay contexto y es interno absoluto)
      if (contextIds.length === 0 || contextIds.includes(r.source_branch_id)) {
        return { kind: "interno", label: "Interno", cls: "bg-muted text-muted-foreground border-border" };
      }
      return null;
    }
    if (contextIds.length === 0) return null;
    const isDest = contextIds.includes(r.requesting_branch_id);
    const isSource = contextIds.includes(r.source_branch_id);
    // Lectura administrativa del PEDIDO (no movimiento físico):
    //  - Soy quien SOLICITÓ (requesting_branch) → la solicitud SALIÓ de mí → Salida (ámbar).
    //  - Soy quien RECIBE la solicitud (source_branch, otro me pidió) → ENTRÓ hacia mí → Entrada (azul).
    if (isDest)
      return { kind: "salida", label: "Salida — pedido creado por mi sucursal", cls: "bg-warning/10 text-warning border-warning/20" };
    if (isSource)
      return { kind: "entrada", label: "Entrada — solicitud recibida de otra sucursal", cls: "bg-info/10 text-info border-info/20" };
    return null;
  };

  /** Renderiza el chip de dirección como ícono compacto con tooltip. */
  const renderDirectionIcon = (
    dir: { kind: "entrada" | "salida" | "interno"; label: string; cls: string } | null,
  ) => {
    if (!dir) return null;
    const Icon = dir.kind === "entrada" ? ArrowDownLeft : dir.kind === "salida" ? ArrowUpRight : Repeat;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-md border h-5 w-5 shrink-0",
              dir.cls,
            )}
            aria-label={dir.label}
          >
            <Icon className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{dir.label}</TooltipContent>
      </Tooltip>
    );
  };

  /** Color de antigüedad para pedidos activos. */
  const getAgeClass = (r: any): string => {
    if (CLOSED_STATUSES.includes(r.status)) return "text-muted-foreground";
    const created = new Date(r.created_at);
    const days = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 7) return "text-destructive font-medium";
    if (days >= 3) return "text-amber-600 dark:text-amber-500";
    return "text-muted-foreground";
  };

  // Las 4 tabs se muestran siempre. Para mios/otros sin contexto de sucursal
  // (isAllBranches + "Todas"), el conteo será 0 y el listado vacío con hint claro.
  const showMineOtros = true;

  // Empty state contextual
  const emptyMessage = useMemo(() => {
    if (debouncedSearch) return { title: "Sin resultados", hint: "Probá otra búsqueda o limpiá el filtro." };
    switch (tab) {
      case "activos":
        return { title: "No tenés pedidos activos.", hint: "Cuando haya pedidos en curso, van a aparecer acá." };
      case "mios":
        return { title: "No tenés pedidos creados desde tu sucursal.", hint: "Creá un pedido nuevo para empezar." };
      case "otros":
        return { title: "No tenés pedidos entrantes desde otras sucursales.", hint: "Acá vas a ver pedidos donde tu sucursal es origen." };
      case "cerrados":
        return { title: "Sin pedidos cerrados.", hint: "Los pedidos finalizados van a aparecer en este historial." };
    }
  }, [tab, debouncedSearch]);

  // El filtro de sucursal es una herramienta operativa de segmentación, NO un control de permisos.
  // Debe listar todas las sucursales activas para cualquier rol (incluido operador), permitiendo
  // analizar la bandeja según la sucursal vinculada al pedido. Los permisos reales siguen aplicados
  // por RLS en backend y por la lógica de tabs (Mis pedidos / Otros pedidos).
  const branchOptions = useMemo(() => {
    return branches;
  }, [branches, isAllBranches, allowedBranchIds]);

  // Filtro de sucursal: siempre visible cuando hay sucursales disponibles.
  // Útil para todos los roles (incl. operadores) para acotar bandeja por sucursal del pedido.
  const showBranchFilter = branchOptions.length > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div className="space-y-4 sm:space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Pedidos</h1>
            <p className="page-subtitle mt-1">Bandeja operativa entre sucursales, clientes y reposiciones</p>
          </div>
          {!isViewer && (
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              {(hasRole("admin") || isOwner) && (
                <Button variant="outline" onClick={() => setAdminRepoOpen(true)} className="w-full sm:w-auto">
                  <FileSpreadsheet className="h-4 w-4 mr-2" /> Reposición admin.
                </Button>
              )}
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
                  </Button>
                </DialogTrigger>
                <DialogContent
                  className="
                    p-0 gap-0 overflow-hidden
                    w-screen h-[100dvh] max-w-none rounded-none border-0
                    sm:w-[calc(100vw-2rem)] sm:max-w-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border
                    flex flex-col
                  "
                >
                  <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b bg-background sticky top-0 z-10 shrink-0 pr-12">
                    <DialogTitle className="text-base sm:text-lg">Crear Pedido</DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                    <SolicitudCreateForm
                      fromConsultationId={activeConsultationId}
                      onSuccess={() => { setCreateOpen(false); setActiveConsultationId(null); refetch(); }}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Filtros: Buscar / Sucursal / Estado */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar pedido, cliente o factura"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11 sm:h-10"
            />
          </div>
          {showBranchFilter && (
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full sm:w-[200px] h-11 sm:h-10">
                <Building2 className="h-4 w-4 mr-2 shrink-0" />
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las sucursales</SelectItem>
                {branchOptions.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[200px] h-11 sm:h-10">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {(tab === "cerrados" ? CLOSED_STATUSES : ACTIVE_STATUSES).map((s) => (
                <SelectItem key={s} value={s}>
                  {REQUEST_STATUS_CONFIG[s]?.label ?? s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tabs operativos */}
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1">
          {(showMineOtros
            ? (["activos", "mios", "otros", "cerrados"] as TabKey[])
            : (["activos", "cerrados"] as TabKey[])
          ).map((k) => {
            const count = tabCounts ? (tabCounts as any)[k] : null;
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => { setTab(k); setStatusFilter("all"); setPage(1); }}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground/80 border-border hover:bg-muted",
                )}
              >
                <span>{TAB_LABELS[k]}</span>
                {count !== null && (
                  <span
                    className={cn(
                      "text-[11px] rounded-full px-1.5 py-px min-w-[20px] text-center",
                      active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Listado */}
        <Card className="glass-card">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Cargando pedidos...</div>
            ) : !requests?.length ? (
              <div className="p-8">
                <div className="empty-state">
                  <ArrowRightLeft className="h-8 w-8 mb-2 opacity-50" />
                  <p className="font-medium">{emptyMessage.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{emptyMessage.hint}</p>
                </div>
              </div>
            ) : (
              <>
                {/* MOBILE */}
                <div className="lg:hidden divide-y divide-border/50">
                  {requests.map((r: any) => {
                    const dir = getDirectionChip(r);
                    const isParent = isParentMultiOrigin(r);
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedId(r.id)}
                        className={cn(
                          "w-full text-left p-3 transition-colors",
                          isParent
                            ? "bg-accent/5 hover:bg-accent/10 active:bg-accent/15 border-l-2 border-l-accent"
                            : "hover:bg-muted/40 active:bg-muted/60",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span className="font-mono font-semibold text-sm">#{r.request_number}</span>
                            {!isParent && renderDirectionIcon(dir)}
                            {isParent ? (
                              <Badge variant="outline" className="text-[10px] shrink-0 border-accent text-accent gap-1">
                                <Layers className="h-3 w-3" /> Padre
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                                {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                              </Badge>
                            )}
                            {!isParent && r.parent?.request_number && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] shrink-0 border-accent/50 text-accent gap-1 cursor-pointer hover:bg-accent/10"
                                    onClick={(e) => { e.stopPropagation(); setSelectedId(r.parent.id); }}
                                  >
                                    <Layers className="h-3 w-3" /> Parte de #{r.parent.request_number}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top">Pertenece a un pedido padre multi-origen. Tocar para abrir el padre.</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} className="shrink-0" />
                        </div>
                        <div className="text-xs text-foreground/80 mb-1 break-words">
                          {buildRouteCell(r)}
                        </div>
                        {r.client_name && (
                          <div className="text-[11px] text-muted-foreground truncate mb-1">
                            Cliente: <span className="text-foreground/80">{r.client_name}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate text-muted-foreground">
                            {DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"} · {SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={cn("shrink-0", getAgeClass(r))}>{formatAge(r.created_at)}</span>
                            </TooltipTrigger>
                            <TooltipContent side="left">{formatFullDate(r.created_at)}</TooltipContent>
                          </Tooltip>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* DESKTOP */}
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">#</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Tipo</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Ruta</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Entrega</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Estado</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">Antig.</th>
                        <th className="text-left px-3 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r: any) => {
                        const dir = getDirectionChip(r);
                        const isParent = isParentMultiOrigin(r);
                        return (
                          <tr
                            key={r.id}
                            className={cn(
                              "border-b border-border/40 transition-colors duration-150 cursor-pointer",
                              isParent
                                ? "bg-accent/5 hover:bg-accent/10 border-l-2 border-l-accent"
                                : "hover:bg-muted/40",
                            )}
                            onClick={() => setSelectedId(r.id)}
                          >
                            <td className="px-3 py-2.5 font-mono font-semibold whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                {!isParent && renderDirectionIcon(dir)}
                                <span>#{r.request_number}</span>
                                {isParent && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="text-[10px] border-accent text-accent gap-1">
                                        <Layers className="h-3 w-3" /> Padre
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>Pedido padre multi-origen (contenedor)</TooltipContent>
                                  </Tooltip>
                                )}
                                {!isParent && r.parent?.request_number && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] border-accent/50 text-accent gap-1 cursor-pointer hover:bg-accent/10"
                                        onClick={(e) => { e.stopPropagation(); setSelectedId(r.parent.id); }}
                                      >
                                        <Layers className="h-3 w-3" /> Parte de #{r.parent.request_number}
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>Pertenece a un pedido padre multi-origen. Click para abrir el padre.</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge variant="outline" className="text-xs capitalize font-normal">
                                {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 max-w-[280px]">
                              <div className="truncate">{buildRouteCell(r)}</div>
                              {r.client_name && (
                                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  {r.client_name}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                              <div>{DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"}</div>
                              <div className="text-muted-foreground text-[11px]">{SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}</div>
                            </td>
                            <td className="px-3 py-2.5">
                              <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
                            </td>
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className={getAgeClass(r)}>{formatAge(r.created_at)}</span>
                                </TooltipTrigger>
                                <TooltipContent side="top">{formatFullDate(r.created_at)}</TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>
                                Abrir
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!isLoading && total > 0 && (
              <PaginationBar
                page={page}
                pageSize={pageSize}
                total={total}
                totalPages={totalPages}
                from={from}
                to={to}
                onPageChange={setPage}
                isFetching={isFetching}
                itemLabel="pedidos"
              />
            )}
          </CardContent>
        </Card>

        {/* Detail Dialog */}
        <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent className="w-[calc(100vw-0.75rem)] max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-3 sm:p-6">
            <DialogHeader>
              <DialogTitle>Detalle del Pedido</DialogTitle>
            </DialogHeader>
            {selectedId && <SolicitudDetail requestId={selectedId} onUpdate={refetch} />}
          </DialogContent>
        </Dialog>

        {/* Admin Reposition Dialog */}
        <Dialog open={adminRepoOpen} onOpenChange={setAdminRepoOpen}>
          <DialogContent
            className="
              p-0 gap-0 overflow-hidden
              w-screen h-[100dvh] max-w-none rounded-none border-0
              sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:h-auto sm:max-h-[90vh] sm:rounded-lg sm:border
              flex flex-col
            "
          >
            <DialogHeader className="px-4 py-3 sm:px-6 sm:py-4 border-b bg-background shrink-0 pr-12">
              <DialogTitle className="text-base sm:text-lg">Reposición Administrativa</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
              <AdminReposicionForm onSuccess={() => { setAdminRepoOpen(false); refetch(); }} />
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>
    </TooltipProvider>
  );
}
