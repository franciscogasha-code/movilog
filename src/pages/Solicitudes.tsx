import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, Filter, ArrowRightLeft, Eye } from "lucide-react";
import { REQUEST_STATUS_CONFIG, SHIPPING_METHOD_LABELS, DELIVERY_TARGET_LABELS, REQUEST_TYPE_LABELS } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { SolicitudCreateForm } from "@/components/solicitudes/SolicitudCreateForm";
import { SolicitudDetail } from "@/components/solicitudes/SolicitudDetail";
import { useUserBranchFilter } from "@/hooks/use-user-access";

export default function Solicitudes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { isAllBranches, allowedBranchIds } = useUserBranchFilter();
  const fromConsultation = searchParams.get("from_consultation");

  useEffect(() => {
    if (fromConsultation) {
      setCreateOpen(true);
      // Clean the param so it doesn't re-trigger
      setSearchParams({}, { replace: true });
    }
  }, [fromConsultation]);

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
        query = query.eq("status", statusFilter as any);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const filtered = requests?.filter((r) => {
    if (!search) return true;
    const num = `#${r.request_number}`;
    const src = (r as any).source_branch?.name || "";
    const req = (r as any).requesting_branch?.name || "";
    const term = search.toLowerCase();
    return num.includes(term) || src.toLowerCase().includes(term) || req.toLowerCase().includes(term);
  });

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Pedidos</h1>
          <p className="text-muted-foreground mt-1">Gestión de pedidos entre sucursales, clientes y reposiciones</p>
        </div>
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
            <SolicitudCreateForm onSuccess={() => { setCreateOpen(false); refetch(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por # o sucursal..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
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
              <p>No hay pedidos {statusFilter !== "all" ? `con estado "${REQUEST_STATUS_CONFIG[statusFilter]?.label}"` : ""}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">#</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Origen → Solicitante</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Entrega</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Envío</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Estado</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Fecha</th>
                    <th className="text-left p-3 font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setSelectedId(r.id)}>
                      <td className="p-3 font-mono font-semibold">#{r.request_number}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs capitalize">
                          {REQUEST_TYPE_LABELS[r.request_type] || r.request_type}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{r.source_branch?.name}</span>
                        <span className="text-muted-foreground mx-1">→</span>
                        <span className="font-medium">{r.requesting_branch?.name}</span>
                      </td>
                      <td className="p-3 text-xs">{DELIVERY_TARGET_LABELS[r.delivery_target] || "A sucursal"}</td>
                      <td className="p-3 text-muted-foreground text-xs">{SHIPPING_METHOD_LABELS[r.shipping_method] || r.shipping_method}</td>
                      <td className="p-3">
                        <StatusBadge status={r.status} config={REQUEST_STATUS_CONFIG} />
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {new Date(r.created_at).toLocaleDateString("es-PY", { day: "2-digit", month: "short" })}
                      </td>
                      <td className="p-3">
                        <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
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
    </motion.div>
  );
}
