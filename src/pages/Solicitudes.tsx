import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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

// Status groups for visual grouping
const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: "pending", label: "Pendientes", statuses: ["pending"] },
  { key: "preparation", label: "En preparación", statuses: ["accepted", "picking", "in_preparation"] },
  { key: "transit", label: "En tránsito", statuses: ["in_transit", "delivered"] },
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

  const { data: requests, isLoading, refetch } = useQuery({
    queryKey: ["branch-requests", statusFilter, isAllBranches, allowedBranchIds],
    queryFn: async () => {
      let query = supabase
        .from("branch_requests")
        .select(`
          *,
          requesting_branch:branches!branch_requests_requesting_branch_id_fkey(name, code),
          source_branch:branches!branch_requests_source_branch_id_fkey(name, code)
        `)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!isAllBranches && allowedBranchIds.length > 0) {
        query = query.or(`requesting_branch_id.in.(${allowedBranchIds.join(",")}),source_branch_id.in.(${allowedBranchIds.join(",")})`);
      }

      if (statusFilter !== "all") {
        // Check if it's a group key
        const group = STATUS_GROUPS.find(g => g.key === statusFilter);
        if (group) {
          query = query.in("status", group.statuses as any);
        } else {
          query = query.eq("status", statusFilter as any);
        }
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const filtered = useMemo(() => {
    return requests?.filter((r) => {
      if (!search) return true;
      const num = `#${r.request_number}`;
      const src = (r as any).source_branch?.name || "";
      const req = (r as any).requesting_branch?.name || "";
      const term = search.toLowerCase();
      return num.includes(term) || src.toLowerCase().includes(term) || req.toLowerCase().includes(term);
    });
  }, [requests, search]);

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
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Pedidos</h1>
          <p className="text-muted-foreground mt-1">Gestión de pedidos entre sucursales, clientes y reposiciones</p>
        </div>
        {!isViewer && (
          <div className="flex flex-col sm:flex-row gap-2">
            {(hasRole("admin") || isOwner) && (
              <Button variant="outline" onClick={() => setAdminRepoOpen(true)}>
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Reposición admin.
              </Button>
            )}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Crear Pedido</DialogTitle>
                </DialogHeader>
                <SolicitudCreateForm
                  fromConsultationId={activeConsultationId}
                  onSuccess={() => { setCreateOpen(false); setActiveConsultationId(null); refetch(); }}
                />
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por # o sucursal..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <Filter className="h-4 w-4 mr-2" />
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

      {/* Table */}
      <Card className="glass-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Cargando pedidos...</div>
          ) : !filtered?.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay pedidos {statusFilter !== "all" ? "con ese filtro" : ""}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Pedido</DialogTitle>
          </DialogHeader>
          {selectedId && <SolicitudDetail requestId={selectedId} onUpdate={refetch} />}
        </DialogContent>
      </Dialog>
      {/* Admin Reposition Dialog */}
      <Dialog open={adminRepoOpen} onOpenChange={setAdminRepoOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reposición Administrativa</DialogTitle>
          </DialogHeader>
          <AdminReposicionForm onSuccess={() => { setAdminRepoOpen(false); refetch(); }} />
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
