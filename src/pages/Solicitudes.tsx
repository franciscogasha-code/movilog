import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Plus, Search, Filter, ArrowRightLeft, FileSpreadsheet } from "lucide-react";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { SolicitudCreateForm } from "@/components/solicitudes/SolicitudCreateForm";
import { SolicitudDetail } from "@/components/solicitudes/SolicitudDetail";
import { AdminReposicionForm } from "@/components/solicitudes/AdminReposicionForm";
import { useUserBranchFilter } from "@/hooks/use-user-access";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";
import { PaginationBar } from "@/components/shared/PaginationBar";

// Status groups for visual grouping
const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "pending", label: "Pendientes", statuses: ["pending"] },
  { key: "preparation", label: "En preparación", statuses: ["accepted", "picking", "in_preparation", "ready_for_pickup", "ready_for_delivery"] },
  { key: "transit", label: "En tránsito / logística", statuses: ["in_consolidation", "assigned_to_trip", "in_transit", "delivered", "delivered_to_third_party"] },
  { key: "closed", label: "Cerrados", statuses: ["received", "logistic_closed", "closed", "rejected"] },
];

export default function Solicitudes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasRole, isOwner, user } = useAuth();
  const isViewer = hasRole("viewer") || hasRole("auditor");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [adminRepoOpen, setAdminRepoOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();
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

  // Debounce búsqueda para evitar query por cada tecla
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

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
    queryKey: ["branch-requests", statusFilter, debouncedSearch, isAllBranches, allowedBranchIds],
    initialPageSize: 25,
    buildQuery: () => {
      let query: any = supabase
        .from("branch_requests")
        .select(
          `*,
           requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
           source_branch:branches!branch_requests_source_branch_id_fkey(name, code)`,
          { count: "exact" },
        )
        .order("created_at", { ascending: false });

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(
          `requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`,
        );
      }

      if (statusFilter !== "all") {
        const group = STATUS_GROUPS.find((g) => g.key === statusFilter);
        if (group) query = query.in("status", group.statuses as any);
        else query = query.eq("status", statusFilter as any);
      }

      // Búsqueda server-side: por # exacto, cliente o factura BIMS.
      // Nota: la búsqueda por nombre de sucursal NO es server-side (FK join);
      // se mantiene como filtro de página visible si aplica abajo.
      if (debouncedSearch) {
        const term = debouncedSearch.replace(/^#/, "");
        const numeric = /^\d+$/.test(term);
        const ors: string[] = [
          `client_name.ilike.%${term}%`,
          `bims_invoice_number.ilike.%${term}%`,
        ];
        if (numeric) ors.unshift(`request_number.eq.${term}`);
        query = query.or(ors.join(","));
      }

      return query;
    },
  });

  const filtered = requests;

  /** Build De:/Para: label based on user's branch context */
  const buildRouteCell = (r: any) => {
    const srcName = r.source_branch?.name ?? "?";
    const reqName = r.requesting_branch?.name ?? "?";
    
    if (isAllBranches) {
      return (
        <>
          <span className="text-muted-foreground text-xs">De:</span>{" "}
          <span className="font-medium">{srcName}</span>
          <span className="text-muted-foreground mx-1">→</span>
          <span className="text-muted-foreground text-xs">Para:</span>{" "}
          <span className="font-medium">{reqName}</span>
        </>
      );
    }

    const isSource = allowedBranchIds.includes(r.source_branch_id);
    const isDest = allowedBranchIds.includes(r.requesting_branch_id);

    if (isSource && !isDest) {
      return (
        <>
          <span className="text-muted-foreground text-xs">Para:</span>{" "}
          <span className="font-medium">{reqName}</span>
        </>
      );
    }
    if (isDest && !isSource) {
      return (
        <>
          <span className="text-muted-foreground text-xs">De:</span>{" "}
          <span className="font-medium">{srcName}</span>
        </>
      );
    }
    return (
      <>
        <span className="text-muted-foreground text-xs">De:</span>{" "}
        <span className="font-medium">{srcName}</span>
        <span className="text-muted-foreground mx-1">→</span>
        <span className="text-muted-foreground text-xs">Para:</span>{" "}
        <span className="font-medium">{reqName}</span>
      </>
    );
  };

  return (
    <motion.div className="space-y-4 sm:space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="page-subtitle mt-1">Gestión de pedidos entre sucursales, clientes y reposiciones</p>
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

      {/* Filters — stack en mobile, fila en sm+ */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por #, cliente o factura..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 sm:h-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[220px] h-11 sm:h-10">
            <Filter className="h-4 w-4 mr-2 shrink-0" />
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {STATUS_GROUPS.map((g) => (
              <SelectItem key={g.key} value={g.key}>📁 {g.label}</SelectItem>
            ))}
            <SelectItem value="_sep" disabled>──────────</SelectItem>
            {Object.entries(REQUEST_STATUS_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Listado: cards en mobile, tabla en md+ */}
      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando pedidos...</div>
          ) : !filtered?.length ? (
            <div className="p-8">
              <div className="empty-state">
                <ArrowRightLeft className="h-8 w-8 mb-2 opacity-50" />
                <p className="font-medium">No hay pedidos {statusFilter !== "all" ? "con ese filtro" : ""}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {statusFilter !== "all" ? "Probá cambiar el filtro o crear uno nuevo." : "Creá tu primer pedido para empezar."}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* MOBILE: cards verticales */}
              <div className="md:hidden divide-y divide-border/50">
                {filtered.map((r: any) => {
                  const isInternal = r.source_branch_id === r.requesting_branch_id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left p-3 hover:bg-muted/40 active:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono font-semibold text-sm">#{r.request_number}</span>
                          <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                            {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                          </Badge>
                          {isInternal && (
                            <span className="chip bg-muted text-muted-foreground border border-border">Interno</span>
                          )}
                        </div>
                        <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} className="shrink-0" />
                      </div>
                      <div className="text-xs text-foreground/80 mb-1 break-words">
                        {buildRouteCell(r)}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"} · {SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}
                        </span>
                        <span className="shrink-0">
                          {new Date(r.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* DESKTOP: tabla */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">#</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Ruta</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Entrega</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Envío</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Fecha</th>
                      <th className="text-left p-3 font-medium text-muted-foreground"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/40 transition-all duration-150 cursor-pointer" onClick={() => setSelectedId(r.id)}>
                        <td className="px-3 py-2 font-mono font-semibold">#{r.request_number}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {buildRouteCell(r)}
                            {r.source_branch_id === r.requesting_branch_id && (
                              <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border shrink-0">
                                Interno
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">{DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">{SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-xs">
                          {new Date(r.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="sm" className="text-xs h-7">
                            {isViewer ? "Ver pedido" : "Gestionar"}
                          </Button>
                        </td>
                      </tr>
                    ))}
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
  );
}
